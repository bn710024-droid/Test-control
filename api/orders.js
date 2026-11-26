import crypto from 'node:crypto';
import supabase from './db-client.js';
import { preflight, requireAdmin, optionalAdmin, readBody, log, serverError } from './_lib.js';
import { tooMany } from './_limit.js';
import { vaultSeal, vaultOpen } from './_seal.js';
import { resolveOffer, parseRules } from '../shared/catalog.js';
import { isRequestStatus, requestKey, requestStatusLabel } from '../shared/requests.js';
import { clientNotice, isSenegal, PRO_STAGES, isProStage, proStageOf, proStageFromStatus, proStageLabel, statusOfProStage } from '../shared/orders.js';

/**
 * Espace commandes.
 *
 *  GET    : les commandes. Compte autorisé → toutes. Sans compte (mode visite) → uniquement les
 *           commandes d'exemple, fictives : aucune donnée d'un vrai client ne sort sans connexion.
 *  POST   : • réception d'une commande envoyée par l'application d'achat (`type: 'commande'` ou
 *             `'demande_professionnelle'`, format de lib/transmission.ts) — sans connexion ;
 *           • `{ action: 'examples' }` : crée des commandes d'exemple (responsables).
 *           `?compte=<identifiant du compte>[&suivi=<référence>]` : suivi public, pour l'application
 *           du client — uniquement la référence, le statut et ses dates, aucune donnée personnelle.
 *  PUT    : suivi d'une commande (équipe) — paiement reçu, étape, livreur, aéroport, message au GP ;
 *           ou réglages de livraison `{ logistics }` (responsables) : le GP et nos livreurs.
 *
 * Règles de l'activité, appliquées ici et pas seulement à l'écran :
 *  - particuliers (B2C) : pas de crédit — le paiement reçu confirme la commande, et rien n'avance
 *    sans paiement ;
 *  - grossistes et importateurs (B2B) : rien n'est payé dans l'application. Le client envoie son
 *    intérêt, l'équipe le contacte et fait avancer la demande d'étape en étape (`PRO_STAGES`)
 *    jusqu'au contrat et à la livraison ;
 *  - aucune commande n'est attribuée automatiquement : c'est l'équipe qui choisit le livreur ;
 *  - moyens de paiement : Orange Money, Wave, virement bancaire, carte bancaire.
 *  DELETE : une commande, ou toutes les commandes d'exemple (responsables).
 *
 * Produits introuvables — un client a cherché un produit absent du catalogue et nous le demande :
 *  POST   `{ type: 'produit_introuvable', product, details?, customer, country }` : réception, sans
 *         connexion, comme une commande ;
 *  GET    `?vue=introuvables` : les demandes (équipe uniquement — elles portent un nom et un contact) ;
 *  PUT    `{ request: { id, status?, note? } }` : suivi par l'équipe ;
 *  DELETE `{ requestId }` : suppression définitive (responsables).
 *
 * Les commandes contiennent des données personnelles : chaque ligne est chiffrée (AES-256-GCM)
 * avant d'être enregistrée. La table ne contient que du texte illisible sans la clé du serveur.
 */
const STATUSES = ['attente', 'confirmee', 'preparation', 'expediee', 'livree', 'annulee'];
const STATUS_LABEL = {
  attente: 'en attente',
  confirmee: 'confirmée',
  preparation: 'en préparation',
  expediee: 'expédiée',
  livree: 'livrée',
  annulee: 'annulée',
};

/** Moyens par lesquels un paiement peut être reçu. */
const METHODS = ['orange_money', 'wave', 'virement', 'carte'];
const METHOD_LABEL = { orange_money: 'Orange Money', wave: 'Wave', virement: 'virement bancaire', carte: 'carte bancaire' };
/** Moyens qu'un client peut avoir choisis dans l'application (« mobile » : ancien libellé). */
const CHOICES = [...METHODS, 'mobile'];
const PAID_STEPS = ['confirmee', 'preparation', 'expediee', 'livree'];
/** L'application envoie le libellé du moyen choisi (« Carte bancaire »), ou son identifiant. */
const choiceOf = (v) => {
  const t = String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
  const known = { carte_bancaire: 'carte', virement_bancaire: 'virement', mobile_money: 'mobile' };
  const id = known[t] ?? t;
  return CHOICES.includes(id) ? id : null;
};

const round2 = (n) => Math.round(n * 100) / 100;
const clip = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

async function loadAll() {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  // Une ligne illisible (écrite hors du serveur) est ignorée.
  return data
    .map((row) => {
      const order = vaultOpen(row.id, row.enc);
      return order ? { ...order, id: row.id, received_at: row.received_at } : null;
    })
    .filter(Boolean);
}

async function save(id, order, receivedAt) {
  const { id: _id, received_at: _r, ...content } = order;
  const row = { id, enc: vaultSeal(id, content) };
  if (receivedAt) row.received_at = receivedAt;
  const { error } = await supabase.from('orders').upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

// ───────────── Livraison : le GP (transit international) et nos livreurs

const LOGISTICS_REF = 'settings:logistics';
const digits = (v) => String(v ?? '').replace(/\D/g, '').replace(/^00/, '');

async function loadLogistics() {
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'logistics').maybeSingle();
  if (error) throw error;
  const v = data?.value?.enc ? vaultOpen(LOGISTICS_REF, data.value.enc) : null;
  return {
    gp: { name: v?.gp?.name ?? '', whatsapp: v?.gp?.whatsapp ?? '' },
    // International : jusqu'où le GP livre par défaut. Chaque commande peut en décider autrement.
    gpDelivery: v?.gpDelivery === 'domicile' ? 'domicile' : 'aeroport',
    couriers: Array.isArray(v?.couriers) ? v.couriers : [],
  };
}

function validateLogistics(src) {
  const errors = {};
  const rawWa = clip(src?.gp?.whatsapp, 40);
  const wa = digits(rawWa);
  if (rawWa && !/^(\+|00)/.test(rawWa)) {
    errors['gp.whatsapp'] = 'Numéro WhatsApp du GP : commencez par l’indicatif du pays, par exemple +221 77 000 00 00.';
  } else if (rawWa && (wa.length < 8 || wa.length > 15)) {
    errors['gp.whatsapp'] = 'Numéro WhatsApp du GP : numéro incomplet.';
  }
  const couriers = [];
  (Array.isArray(src?.couriers) ? src.couriers : []).slice(0, 40).forEach((c, i) => {
    const name = clip(c?.name, 60);
    const phone = clip(c?.phone, 30);
    if (!name) {
      errors[`couriers.${i}.name`] = 'Indiquez le nom du livreur.';
      return;
    }
    if (phone && digits(phone).length < 7) errors[`couriers.${i}.phone`] = `Téléphone de ${name} : numéro incomplet.`;
    couriers.push({
      id: typeof c?.id === 'string' && /^l-[a-f0-9]{10}$/.test(c.id) ? c.id : `l-${crypto.randomBytes(5).toString('hex')}`,
      name,
      phone,
    });
  });
  return { errors, value: { gp: { name: clip(src?.gp?.name, 60), whatsapp: wa ? `+${wa}` : '' }, gpDelivery: src?.gpDelivery === 'domicile' ? 'domicile' : 'aeroport', couriers } };
}

// ───────────── Réception depuis l'application d'achat

function linesOf(raw) {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, 60)
    .map((l) => {
      const qty = num(l?.quantity);
      if (!qty) return null;
      const price = num(l.unitPrice);
      const unitPrice = price && price > 0 ? round2(price) : null;
      const noun = Array.isArray(l.unitNoun) && l.unitNoun.length === 2 ? [clip(l.unitNoun[0], 24), clip(l.unitNoun[1], 24)] : null;
      return {
        product_id: clip(l.productId, 60),
        name: clip(l.product, 80) || clip(l.productId, 60) || 'Produit',
        mode: l.mode === 'avion' || l.mode === 'bateau' ? l.mode : null,
        qty,
        unit: l.unit === 'conteneur' ? 'conteneur' : l.unit === 'unit' ? 'unit' : 'kg',
        noun,
        kg: num(l.quantityKg),
        unit_price: unitPrice,
        // Le total est recalculé ici : celui envoyé par l'appareil n'est pas repris tel quel.
        total: unitPrice === null ? null : round2(unitPrice * qty),
      };
    })
    .filter(Boolean);
}

/**
 * Jusqu'où nous livrons une commande : au Sénégal, toujours au domicile (nos livreurs à moto) ;
 * ailleurs, selon le choix fait sur la commande, sinon selon le réglage général du GP.
 */
function deliveryMode(o, gpDefault) {
  const abroad = !isSenegal(o.country, o.address) && !!(o.country || o.address);
  if (!abroad) return 'domicile';
  return o.delivery === 'domicile' || o.delivery === 'aeroport' ? o.delivery : gpDefault === 'domicile' ? 'domicile' : 'aeroport';
}

// ───────────── Position du client
// Au Sénégal, le livreur se rend là où se trouve le téléphone : l'application envoie la position
// avec la commande (si le client l'autorise), puis la rafraîchit tant que la commande est en cours.
function positionOf(raw, at) {
  if (raw?.lat === null || raw?.lat === undefined || raw?.lng === null || raw?.lng === undefined) return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null; // position « vide » de certains téléphones
  const accuracy = Number(raw.accuracy);
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    accuracy: raw.accuracy !== null && raw.accuracy !== undefined && Number.isFinite(accuracy) && accuracy >= 0 ? Math.min(Math.round(accuracy), 100000) : null,
    at: at || new Date().toISOString(),
  };
}

/** Mise à jour de la position par l'application du client, pour une commande en cours. */
async function trackPosition(req, body, res) {
  if (await tooMany(req, res, 'position', 30, 60)) return;
  const account = clip(String(body.compte ?? ''), 80);
  const reference = clip(String(body.reference ?? ''), 60);
  const spot = positionOf(body);
  if (account.length < 6 || !reference) return res.status(400).json({ error: 'Compte ou référence manquant.' });
  if (!spot) return res.status(400).json({ error: 'Position illisible.' });
  const order = (await loadAll()).find((o) => o.customer.account_id === account && o.number === reference);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
  // Une commande reçue ou annulée n'est plus suivie : la position n'est plus enregistrée.
  if (order.status === 'livree' || order.status === 'annulee') return res.status(200).json({ ok: true, tracking: false });
  // Au plus une écriture toutes les quinze secondes par commande.
  const last = order.location?.at ? new Date(order.location.at).getTime() : 0;
  if (Date.now() - last >= 15000) await save(order.id, { ...order, location: spot });
  return res.status(200).json({ ok: true, tracking: true });
}

function fromPayload(body) {
  const pro = body.type === 'demande_professionnelle';
  const lines = linesOf(body.lines);
  if (lines.length === 0) return { error: 'La commande ne contient aucune ligne lisible.' };
  const c = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const customer = {
    account_id: clip(c.accountId, 60),
    name: clip(pro ? c.contact : c.name, 80),
    company: clip(c.company, 80),
    activity: clip(c.activity, 30),
    email: clip(c.email, 120).toLowerCase(),
    phone: clip(c.phone, 40),
    whatsapp: clip(c.whatsapp, 40),
  };
  if (!customer.name && !customer.email && !customer.phone) {
    return { error: 'La commande ne dit pas qui commande (nom, e-mail ou téléphone).' };
  }
  const sent = new Date(body.createdAt).getTime();
  const now = Date.now();
  const createdAt = new Date(Number.isFinite(sent) && sent <= now + 86400000 ? sent : now).toISOString();
  const subtotal = round2(lines.reduce((sum, l) => sum + (l.total ?? 0), 0));
  const transport = pro ? 0 : round2(num(body.transportCost) ?? 0);
  return {
    order: {
      type: pro ? 'pro' : 'particulier',
      number: clip(body.reference, 40) || 'Sans numéro',
      created_at: createdAt,
      is_example: false,
      customer,
      address: clip(pro ? body.destination : body.address, 300),
      country: clip(body.country, 60),
      lines,
      incoterm: pro ? (body.incoterm === 'FOB' ? 'FOB' : 'EXW') : null,
      subtotal,
      transport_cost: transport,
      total: round2(subtotal + transport),
      unpriced: lines.filter((l) => l.total === null).length,
      // Moyen choisi par le client. Le paiement lui-même n'est jamais cru sur parole : aucun
      // prestataire n'est relié, c'est l'équipe qui pointe l'argent reçu.
      payment: pro ? null : choiceOf(body.payment),
      note: clip(body.note, 600),
      status: 'attente',
      status_at: new Date().toISOString(),
      // Chaque passage de statut est daté : c'est l'historique que suit le client.
      history: [{ status: 'attente', ...(pro ? { stage: 'interet' } : null), at: new Date().toISOString() }],
      // B2B : la demande entre au premier contact, « intérêt reçu ».
      ...(pro ? { stage: 'interet' } : null),
      paid_at: null,
      paid_via: null,
      // Jamais d'attribution automatique : le livreur est choisi par l'équipe.
      courier: null,
      airport: '',
      gp_at: null,
      // Position du téléphone au moment de la commande, si le client l'a autorisée.
      location: pro ? null : positionOf(body.location),
    },
  };
}

async function receive(req, body, res) {
  const { order, error: reason } = fromPayload(body);
  if (!order) return res.status(400).json({ error: reason });

  // Par visiteur : cinq envois par minute, trente par heure.
  if (await tooMany(req, res, 'commande', 5, 60)) return;
  if (await tooMany(req, res, 'commande-h', 30, 3600)) return;

  // Frein simple contre un envoi en rafale : vingt commandes par minute au plus.
  const since = new Date(Date.now() - 60000).toISOString();
  const { count, error: countError } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .gt('received_at', since);
  if (countError) throw countError;
  if ((count ?? 0) >= 20) return res.status(429).json({ error: 'Trop de commandes en une minute. Réessayez dans un instant.' });

  // L'application renvoie une demande tant qu'elle n'a pas reçu de réponse : même commande, même ligne.
  const fingerprint = [order.type, order.number, order.created_at, order.customer.account_id, order.customer.email].join('|');
  const id = `app-${crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 28)}`;
  const { data: existing, error: findError } = await supabase.from('orders').select('id').eq('id', id).maybeSingle();
  if (findError) throw findError;
  if (existing) return res.status(200).json({ ok: true, reference: order.number, duplicate: true });

  await save(id, order);
  return res.status(201).json({ ok: true, reference: order.number });
}

// ───────────── Commandes d'exemple : fictives, signalées comme telles, bâties sur le vrai catalogue

const person = (n, name, city, country) => ({
  account_id: `exemple-${n}`,
  name,
  company: '',
  activity: '',
  email: `${name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.')}@exemple.test`,
  // Numéros fictifs, à l'indicatif du pays du client.
  phone: country === 'Sénégal' ? `+221 77 000 00 0${n}` : `+33 6 00 00 00 0${n}`,
  whatsapp: '',
  _address: `${10 + n} rue de l’Exemple, ${city}`,
  _country: country,
});
const firm = (n, company, contact, activity, city) => ({
  account_id: `exemple-pro-${n}`,
  name: contact,
  company: `${company} (exemple)`,
  activity,
  email: `contact${n}@exemple.test`,
  phone: `+33 1 00 00 00 0${n}`,
  whatsapp: `+33 6 00 00 01 0${n}`,
  _address: `${city}, France`,
  _country: 'France',
});

async function seedExamples() {
  const [products, settings] = await Promise.all([
    supabase.from('products').select('*').eq('archived', false),
    supabase.from('settings').select('value').eq('key', 'rules').maybeSingle(),
  ]);
  if (products.error) throw products.error;
  const rules = parseRules(settings.data?.value);
  const byId = new Map(products.data.map((p) => [p.id, p]));

  const retail = (id, qty) => {
    const p = byId.get(id);
    if (!p?.retail || typeof p.retail.price !== 'number') return null;
    return {
      product_id: id, name: p.name, mode: null, qty,
      unit: p.retail.unit === 'kg' ? 'kg' : 'unit',
      noun: p.retail.unit === 'kg' ? null : p.retail.noun,
      kg: null, unit_price: p.retail.price, total: round2(p.retail.price * qty),
    };
  };
  const wholesale = (id, mode, incoterm, qty) => {
    const p = byId.get(id);
    const offer = (p?.wholesale ?? []).find((o) => (o.mode ?? null) === mode);
    if (!offer) return null;
    const o = resolveOffer(offer, rules, incoterm);
    return {
      product_id: id, name: p.name, mode, qty,
      unit: o.unit === 'kg' ? 'kg' : 'conteneur', noun: null,
      kg: o.unit === 'kg' ? qty : o.containerKg ? qty * o.containerKg : null,
      unit_price: o.noPrice ? null : o.price,
      total: o.noPrice ? null : round2(o.price * qty),
    };
  };

  const awa = person(1, 'Awa Diop', 'Dakar', 'Sénégal');
  const julien = person(2, 'Julien Martin', '75011 Paris', 'France');
  const elise = person(3, 'Élise Moreau', '69003 Lyon', 'France');
  const karim = person(4, 'Karim Benali', '1000 Bruxelles', 'Belgique');
  const fatou = person(5, 'Fatou Sarr', 'Thiès', 'Sénégal');
  const moussa = person(6, 'Moussa Ba', '13001 Marseille', 'France');
  const nord = firm(1, 'Nord Import', 'Claire Dubois', 'importateur', 'Port de Dunkerque');
  const halles = firm(2, 'Halles Lyonnaises', 'Marc Petit', 'grossiste', 'Lyon');
  const port = firm(3, 'Primeurs du Port', 'Sophie Garnier', 'grossiste', 'Marseille');

  // [heures écoulées, client, lignes, statut, moyen du paiement reçu (ou null), moyen choisi, incoterm, suivi]
  // Toute commande confirmée ou plus avancée est payée : il n'y a pas de crédit.
  const cdg = { airport: 'Paris-Charles-de-Gaulle (CDG)' };
  const local = { courier: { id: 'exemple', name: 'Livreur d’exemple' } };
  const plan = [
    [0.3, awa, [retail('mangue', 4), retail('citronvert', 6), retail('banane', 1.5)], 'attente', null, 'wave', null, { spot: [14.69278, -17.44672, 18] }],
    [2, julien, [retail('pomme', 2), retail('poire', 1), retail('kiwi', 6)], 'confirmee', 'carte', 'carte', null, cdg],
    [5, nord, [wholesale('mangue', 'avion', 'FOB', 1000), wholesale('ananas', 'bateau', 'FOB', 1)], 'attente', null, null, 'FOB', { stage: 'interet' }],
    [7, elise, [retail('tomate', 1.5), retail('carotte', 2), retail('brocoli', 1), retail('basilic', 1)], 'preparation', 'virement', 'virement', null, { airport: 'Lyon-Saint-Exupéry (LYS)' }],
    [26, karim, [retail('orange', 3), retail('citron', 1), retail('gingembre', 0.3)], 'expediee', 'carte', 'carte', null, { airport: 'Bruxelles (BRU)', gp: true }],
    [30, halles, [wholesale('banane', null, 'EXW', 2000), wholesale('orange', null, 'EXW', 1500)], 'confirmee', 'virement', null, 'EXW', { stage: 'contrat' }],
    [50, fatou, [retail('ananas', 2), retail('avocat', 4), retail('grenade', 2)], 'livree', 'orange_money', 'orange_money', null, { ...local, spot: [14.79103, -16.92586, 35] }],
    [75, moussa, [retail('kaki', 6), retail('raisin', 1), retail('figue', 1)], 'annulee', null, 'carte', null, {}],
    [100, julien, [retail('pomme', 3), retail('oignon', 1), retail('ail', 2)], 'livree', 'carte', 'carte', null, { ...cdg, gp: true }],
    [130, port, [wholesale('mangue', 'bateau', 'EXW', 1), wholesale('avocat', null, 'EXW', 800)], 'attente', null, null, 'EXW', { stage: 'discussion' }],
    [216, awa, [retail('mangue', 6), retail('melon', 2)], 'livree', 'wave', 'wave', null, local],
    [290, elise, [retail('fraise', 2), retail('framboise', 1), retail('myrtille', 1)], 'livree', 'virement', 'virement', null, { airport: 'Lyon-Saint-Exupéry (LYS)', gp: true }],
  ];

  const now = Date.now();
  let made = 0;
  for (let i = 0; i < plan.length; i++) {
    const [hours, who, rawLines, status, paidVia, payment, incoterm, extra] = plan[i];
    const lines = rawLines.filter(Boolean);
    if (lines.length === 0) continue;
    const at = new Date(now - hours * 3600000).toISOString();
    const { _address, _country, ...customer } = who;
    // Historique fictif : les étapes déjà franchies, réparties entre la commande et maintenant.
    const pro = !!incoterm;
    // B2B : le chemin suit les étapes du parcours professionnel, pas le paiement.
    const stage = pro ? (extra.stage ?? proStageFromStatus(status)) : null;
    const flow = PRO_STAGES.map((x) => x.id);
    const path = pro
      ? flow.slice(0, flow.indexOf(stage) + 1)
      : status === 'annulee'
        ? ['attente', 'annulee']
        : STATUSES.slice(0, STATUSES.indexOf(status) + 1);
    const span = hours * 3600000;
    // Client déjà prévenu à chaque étape, sauf la dernière de l'exemple n° 5 (« à prévenir »).
    const history = path.map((step, k) => {
      const stamp = new Date(now - span + (span * k) / (path.length + 1)).toISOString();
      const told = k > 0 && !(i === 4 && k === path.length - 1);
      const entry = pro ? { status: statusOfProStage(step), stage: step, at: stamp } : { status: step, at: stamp };
      return told ? { ...entry, notified_at: stamp, notified_via: 'whatsapp' } : entry;
    });
    const subtotal = round2(lines.reduce((sum, l) => sum + (l.total ?? 0), 0));
    await save(
      `ex-${i + 1}`,
      {
        type: pro ? 'pro' : 'particulier',
        number: `${pro ? 'DEM' : 'CMD'}-EX-${String(i + 1).padStart(3, '0')}`,
        created_at: at,
        is_example: true,
        customer,
        address: _address,
        country: _country,
        lines,
        incoterm: incoterm ?? null,
        subtotal,
        transport_cost: 0,
        total: subtotal,
        unpriced: lines.filter((l) => l.total === null).length,
        payment: payment ?? null,
        note: '',
        status: pro ? statusOfProStage(stage) : status,
        ...(pro ? { stage } : null),
        status_at: history[history.length - 1].at,
        history,
        paid_at: paidVia ? at : null,
        paid_via: paidVia,
        courier: extra.courier ?? null,
        airport: extra.airport ?? '',
        gp_at: extra.gp ? at : null,
        location: extra.spot ? { lat: extra.spot[0], lng: extra.spot[1], accuracy: extra.spot[2], at } : null,
      },
      at,
    );
    made++;
  }
  return made;
}

// ───────────── Produits introuvables : ce que les clients cherchent sans le trouver

const REQUESTS = 'product_requests';

/** Les demandes, de la plus récente à la plus ancienne. Comme les commandes, elles sont chiffrées en base. */
async function loadRequests() {
  const { data, error } = await supabase.from(REQUESTS).select('*').order('received_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return data
    .map((row) => {
      const request = vaultOpen(row.id, row.enc);
      return request ? { ...request, id: row.id, received_at: row.received_at } : null;
    })
    .filter(Boolean);
}

async function saveRequest(id, request) {
  const { id: _id, received_at: _r, ...content } = request;
  const { error } = await supabase.from(REQUESTS).upsert({ id, enc: vaultSeal(id, content) }, { onConflict: 'id' });
  if (error) throw error;
}

async function receiveRequest(req, body, res) {
  if (await tooMany(req, res, 'demande', 5, 60)) return;
  const product = clip(body.product, 80).replace(/\s+/g, ' ');
  if (product.length < 2) return res.status(400).json({ error: 'Dites-nous quel produit vous recherchez.' });
  const c = body.customer && typeof body.customer === 'object' ? body.customer : {};
  const customer = {
    account_id: clip(c.accountId, 60),
    name: clip(c.name, 80),
    type: c.type === 'pro' ? 'pro' : 'particulier',
    company: clip(c.company, 80),
    email: clip(c.email, 120).toLowerCase(),
    phone: clip(c.phone, 40),
    whatsapp: clip(c.whatsapp, 40),
  };
  // « Nous reviendrons vers vous » : il faut savoir où.
  if (!customer.email && !customer.phone && !customer.whatsapp) {
    return res.status(400).json({ error: 'Indiquez un e-mail ou un numéro de téléphone : sans cela, nous ne pourrons pas revenir vers vous.' });
  }

  // Frein simple contre un envoi en rafale : trente demandes par minute au plus.
  const since = new Date(Date.now() - 60000).toISOString();
  const { count, error: countError } = await supabase.from(REQUESTS).select('id', { count: 'exact', head: true }).gt('received_at', since);
  if (countError) throw countError;
  if ((count ?? 0) >= 30) return res.status(429).json({ error: 'Trop de demandes en une minute. Réessayez dans un instant.' });

  // La même personne qui redemande le même produit : une seule ligne, pas un doublon.
  const who = customer.account_id || customer.email || customer.phone || customer.whatsapp;
  const id = `rech-${crypto.createHash('sha256').update(`${who}|${requestKey(product)}`).digest('hex').slice(0, 28)}`;
  const { data: existing, error: findError } = await supabase.from(REQUESTS).select('id').eq('id', id).maybeSingle();
  if (findError) throw findError;
  if (existing) return res.status(200).json({ ok: true, duplicate: true });

  const sent = new Date(body.createdAt).getTime();
  const now = Date.now();
  const at = new Date(now).toISOString();
  await saveRequest(id, {
    product,
    details: clip(body.details, 300),
    customer,
    country: clip(body.country, 60),
    created_at: new Date(Number.isFinite(sent) && sent <= now + 86400000 ? sent : now).toISOString(),
    status: 'nouvelle',
    status_at: at,
    note: '',
    history: [{ status: 'nouvelle', at }],
  });
  return res.status(201).json({ ok: true });
}

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    if (req.method === 'GET') {
      // Demandes de produits introuvables : réservées à l'équipe, elles portent un nom et un contact.
      if (req.query?.vue === 'introuvables') {
        const admin = await optionalAdmin(req);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(admin ? { requests: await loadRequests(), scope: 'all' } : { requests: [], scope: 'none' });
      }
      // Suivi pour l'application du client : elle présente l'identifiant de son compte et reçoit
      // le statut de ses commandes, tel que l'équipe l'a réglé. Rien d'autre ne sort.
      if (req.query?.compte !== undefined || req.query?.suivi !== undefined) {
        const account = clip(String(req.query.compte ?? ''), 80);
        const reference = clip(String(req.query.suivi ?? ''), 60);
        if (account.length < 6) return res.status(400).json({ error: 'Identifiant de compte manquant.' });
        const mine = (await loadAll()).filter((o) => o.customer.account_id === account && (!reference || o.number === reference));
        const gpDefault = mine.length > 0 ? (await loadLogistics()).gpDelivery : 'aeroport';
        return res.status(200).json({
          orders: mine.map((o) => {
            const steps = Array.isArray(o.history) && o.history.length > 0 ? o.history : [{ status: o.status, at: o.status_at }];
            const abroad = !isSenegal(o.country, o.address) && !!(o.country || o.address);
            const delivery = deliveryMode(o, gpDefault);
            const about = { reference: o.number, type: o.type, abroad, door: delivery === 'domicile', located: !!o.location, airport: o.airport || undefined };
            return {
              reference: o.number,
              type: o.type === 'pro' ? 'demande_professionnelle' : 'commande',
              status: o.status,
              statusAt: o.status_at,
              // Jusqu'où nous livrons : « domicile » (Sénégal, ou GP porte à porte) ou « aeroport ».
              delivery,
              // Vrai tant qu'une commande livrée au Sénégal est en cours : l'application peut continuer d'envoyer la position.
              tracking: o.type !== 'pro' && !abroad && o.status !== 'livree' && o.status !== 'annulee',
              // Demande professionnelle : l'étape du parcours, en clair (« Contacté », « Contrat conclu »…).
              ...(o.type === 'pro' ? { stage: proStageOf(o), stageLabel: proStageLabel(proStageOf(o)) } : null),
              history: steps.map((h) => ({ status: h.status, ...(o.type === 'pro' ? { stage: proStageOf(h) } : null), at: h.at })),
              // Une notification par changement de statut, prête à être affichée par l'application.
              notifications: steps.map((h) => ({ status: h.status, at: h.at, ...clientNotice(about, h.status, o.type === 'pro' ? proStageOf(h) : null) })),
            };
          }),
        });
      }
      const admin = await optionalAdmin(req);
      const [all, logistics] = await Promise.all([loadAll(), loadLogistics()]);
      return res.status(200).json({
        orders: (admin ? all : all.filter((o) => o.is_example === true)).map((o) => ({ ...o, delivery_mode: deliveryMode(o, logistics.gpDelivery) })),
        scope: admin ? 'all' : 'examples',
        // Numéros du GP et des livreurs : réservés aux comptes autorisés.
        logistics: admin ? logistics : null,
      });
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      if (body.type === 'commande' || body.type === 'demande_professionnelle') return receive(req, body, res);
      if (body.type === 'produit_introuvable') return receiveRequest(req, body, res);
      if (body.action === 'position') return trackPosition(req, body, res);
      if (body.action === 'examples') {
        const admin = await requireAdmin(req, res, { owner: true });
        if (!admin) return;
        const made = await seedExamples();
        await log(admin, 'create', 'order', null, `${made} commandes d’exemple ajoutées à l’espace commandes`);
        return res.status(201).json({ ok: true, made });
      }
      return res.status(400).json({ error: 'Envoi non reconnu.' });
    }

    if (req.method === 'PUT') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const body = readBody(req);

      // Suivi d'une demande de produit introuvable : son étape, et la note interne de l'équipe.
      if (body.request && typeof body.request === 'object') {
        const { data: row, error } = await supabase.from(REQUESTS).select('*').eq('id', String(body.request.id ?? '')).maybeSingle();
        if (error) throw error;
        const current = row ? vaultOpen(row.id, row.enc) : null;
        if (!current) return res.status(404).json({ error: 'Demande introuvable : elle a peut-être été supprimée.' });
        const next = { ...current };
        if (body.request.status !== undefined) {
          if (!isRequestStatus(body.request.status)) return res.status(400).json({ error: 'Étape inconnue.' });
          if (body.request.status !== current.status) {
            const at = new Date().toISOString();
            next.status = body.request.status;
            next.status_at = at;
            next.history = [...(Array.isArray(current.history) ? current.history : []), { status: next.status, at }].slice(-30);
          }
        }
        if (body.request.note !== undefined) {
          if (typeof body.request.note !== 'string' || body.request.note.trim().length > 600) return res.status(400).json({ error: 'Note interne : 600 caractères au plus.', fields: { note: 'Note interne : 600 caractères au plus.' } });
          next.note = body.request.note.trim();
        }
        await saveRequest(row.id, next);
        if (next.status !== current.status) await log(admin, 'update', 'request', row.id, `Produit introuvable « ${current.product} » : ${requestStatusLabel(next.status).toLowerCase()}`);
        return res.status(200).json({ ...next, id: row.id, received_at: row.received_at });
      }

      if (body.logistics !== undefined) {
        if (admin.role !== 'owner') return res.status(403).json({ error: 'Le GP et la liste des livreurs se modifient par un responsable.' });
        const { errors, value } = validateLogistics(body.logistics);
        if (Object.keys(errors).length > 0) return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
        const { error: saveError } = await supabase
          .from('settings')
          .upsert({ key: 'logistics', value: { enc: vaultSeal(LOGISTICS_REF, value) }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
        if (saveError) throw saveError;
        await log(admin, 'update', 'order', null, 'Livraison : GP et livreurs mis à jour');
        return res.status(200).json(value);
      }

      const { data: row, error } = await supabase.from('orders').select('*').eq('id', body.id ?? '').maybeSingle();
      if (error) throw error;
      const current = row ? vaultOpen(row.id, row.enc) : null;
      if (!current) return res.status(404).json({ error: 'Commande introuvable : elle a peut-être été supprimée.' });

      const next = { ...current };
      const changes = [];
      const now = new Date().toISOString();
      const before = current.status;
      const refuse = (message) => res.status(400).json({ error: message });

      const pro = current.type === 'pro';
      const stageBefore = pro ? proStageOf(current) : null;
      let stage = stageBefore;

      if (pro) {
        // B2B : rien n'est payé dans l'application. Le paiement se règle par contrat ; il peut être
        // pointé ici pour mémoire, sans jamais bloquer ni faire avancer la demande.
        if (typeof body.paid === 'boolean' && body.paid !== !!current.paid_at) {
          if (body.paid) {
            if (!(current.total > 0)) return refuse('Aucun montant à pointer : le prix de cette demande reste à convenir.');
            if (!METHODS.includes(body.via)) return refuse('Indiquez le moyen du paiement reçu : Orange Money, Wave, virement ou carte bancaire.');
            next.paid_at = now;
            next.paid_via = body.via;
            changes.push(`paiement reçu par ${METHOD_LABEL[body.via]}`);
          } else {
            next.paid_at = null;
            next.paid_via = null;
            changes.push('paiement retiré');
          }
        }
        let wanted = body.stage;
        if (wanted === undefined && body.status !== undefined) {
          if (!STATUSES.includes(body.status)) return refuse('Statut inconnu.');
          // Rouvrir une demande classée sans suite : elle reprend à l'étape où elle s'était arrêtée.
          const last = [...(current.history ?? [])].reverse().find((h) => isProStage(h.stage) && h.stage !== 'annulee');
          wanted = body.status === 'attente' ? (last?.stage ?? 'interet') : proStageFromStatus(body.status);
        }
        if (wanted !== undefined) {
          if (!isProStage(wanted)) return refuse('Étape inconnue.');
          if (wanted !== stageBefore) {
            stage = wanted;
            next.stage = stage;
            next.status = statusOfProStage(stage);
            next.status_at = now;
            changes.push(proStageLabel(stage).toLowerCase());
          }
        }
      } else {
        // Paiement reçu = commande confirmée. Il n'y a pas de crédit.
        if (typeof body.paid === 'boolean' && body.paid !== !!current.paid_at) {
          if (body.paid) {
            if (current.status === 'annulee') return refuse('Commande annulée : rétablissez-la avant d’y pointer un paiement.');
            if (!(current.total > 0)) return refuse('Aucun montant à encaisser : le prix de cette commande n’est pas encore fixé.');
            if (!METHODS.includes(body.via)) return refuse('Indiquez le moyen du paiement reçu : Orange Money, Wave, virement ou carte bancaire.');
            next.paid_at = now;
            next.paid_via = body.via;
            if (next.status === 'attente') {
              next.status = 'confirmee';
              next.status_at = now;
            }
            changes.push(`paiement reçu par ${METHOD_LABEL[body.via]}, commande confirmée`);
          } else {
            if (!['attente', 'confirmee', 'annulee'].includes(current.status)) {
              return refuse('Cette commande est déjà en préparation ou partie : le paiement ne peut plus être retiré. Annulez-la si besoin.');
            }
            next.paid_at = null;
            next.paid_via = null;
            if (next.status === 'confirmee') {
              next.status = 'attente';
              next.status_at = now;
            }
            changes.push('paiement retiré, commande remise en attente de paiement');
          }
        }

        if (body.status !== undefined) {
          if (!STATUSES.includes(body.status)) return refuse('Statut inconnu.');
          // Une commande payée que l'on rétablit redevient « confirmée », pas « en attente ».
          const wanted = body.status === 'attente' && next.paid_at ? 'confirmee' : body.status;
          if (PAID_STEPS.includes(wanted) && !next.paid_at) {
            return refuse('Pas de commande sans paiement : pointez d’abord le paiement reçu.');
          }
          if (wanted !== next.status) {
            next.status = wanted;
            next.status_at = now;
            changes.push(STATUS_LABEL[wanted]);
          }
        }
      }

      // Chaque changement de statut (ou d'étape) est daté dans l'historique de la commande.
      if (pro ? stage !== stageBefore : next.status !== before) {
        const past = Array.isArray(current.history) && current.history.length > 0 ? current.history : [{ status: before, ...(pro ? { stage: stageBefore } : null), at: current.status_at }];
        next.history = [...past, { status: next.status, ...(pro ? { stage } : null), at: now }].slice(-40);
      }

      // Client prévenu du statut en cours : le message a été ouvert depuis la fiche (WhatsApp ou
      // e-mail). L'envoi lui-même reste un geste de l'équipe ; on note qu'il a été lancé.
      if (body.notified_via !== undefined) {
        if (!['whatsapp', 'email'].includes(body.notified_via)) return refuse('Moyen de notification inconnu.');
        const steps = Array.isArray(next.history) && next.history.length > 0 ? [...next.history] : [{ status: next.status, at: next.status_at }];
        steps[steps.length - 1] = { ...steps[steps.length - 1], notified_at: now, notified_via: body.notified_via };
        next.history = steps;
        changes.push(`client prévenu (${pro ? proStageLabel(stage).toLowerCase() : STATUS_LABEL[next.status]}) par ${body.notified_via === 'email' ? 'e-mail' : 'WhatsApp'}`);
      }

      // Livreur : choisi par l'équipe, parmi nos livreurs. Rien n'est attribué tout seul.
      if ('courier_id' in body) {
        if (!body.courier_id) {
          if (current.courier) changes.push('livreur retiré');
          next.courier = null;
        } else {
          const courier = (await loadLogistics()).couriers.find((c) => c.id === body.courier_id);
          if (!courier) return refuse('Ce livreur n’est plus dans la liste. Rechargez la page.');
          if (current.courier?.id !== courier.id) changes.push(`attribuée à ${courier.name}`);
          next.courier = { id: courier.id, name: courier.name };
        }
      }
      // International : aéroport d'arrivée, ou porte à porte quand le GP le propose.
      if ((body.delivery === 'aeroport' || body.delivery === 'domicile') && body.delivery !== current.delivery) {
        next.delivery = body.delivery;
        changes.push(body.delivery === 'domicile' ? 'livraison par le GP jusqu’au domicile' : 'livraison par le GP jusqu’à l’aéroport d’arrivée');
      }
      if (typeof body.airport === 'string' && clip(body.airport, 80) !== (current.airport ?? '')) {
        next.airport = clip(body.airport, 80);
        changes.push(next.airport ? `aéroport d’arrivée : ${next.airport}` : 'aéroport d’arrivée effacé');
      }
      if (typeof body.gp_notified === 'boolean' && body.gp_notified !== !!current.gp_at) {
        next.gp_at = body.gp_notified ? now : null;
        changes.push(body.gp_notified ? 'message WhatsApp au GP ouvert' : 'envoi au GP remis à faire');
      }

      if (changes.length > 0) {
        await save(row.id, next);
        await log(admin, 'update', 'order', row.id, `Commande ${current.number} : ${changes.join(', ')}`);
      }
      return res.status(200).json({ ...next, id: row.id, received_at: row.received_at, delivery_mode: deliveryMode(next, (await loadLogistics()).gpDelivery) });
    }

    if (req.method === 'DELETE') {
      const admin = await requireAdmin(req, res, { owner: true });
      if (!admin) return;
      const body = readBody(req);
      if (body.requestId !== undefined) {
        const { data: row, error } = await supabase.from(REQUESTS).select('*').eq('id', String(body.requestId)).maybeSingle();
        if (error) throw error;
        if (!row) return res.status(404).json({ error: 'Demande introuvable : elle a peut-être déjà été supprimée.' });
        const gone = vaultOpen(row.id, row.enc);
        const { error: removeError } = await supabase.from(REQUESTS).delete().eq('id', row.id);
        if (removeError) throw removeError;
        await log(admin, 'delete', 'request', row.id, `Produit introuvable « ${gone?.product ?? ''} » : demande supprimée définitivement`);
        return res.status(200).json({ ok: true });
      }
      if (body.examples === true) {
        const ids = (await loadAll()).filter((o) => o.is_example === true).map((o) => o.id);
        if (ids.length > 0) {
          const { error } = await supabase.from('orders').delete().in('id', ids);
          if (error) throw error;
          await log(admin, 'delete', 'order', null, `${ids.length} commandes d’exemple retirées`);
        }
        return res.status(200).json({ ok: true, removed: ids.length });
      }
      const { data: row, error } = await supabase.from('orders').select('*').eq('id', body.id ?? '').maybeSingle();
      if (error) throw error;
      if (!row) return res.status(404).json({ error: 'Commande introuvable : elle a peut-être déjà été supprimée.' });
      const current = vaultOpen(row.id, row.enc);
      const { error: removeError } = await supabase.from('orders').delete().eq('id', row.id);
      if (removeError) throw removeError;
      await log(admin, 'delete', 'order', row.id, `Commande ${current?.number ?? ''} supprimée définitivement`);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}
