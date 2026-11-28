/**
 * Paniers en cours (application d'achat → tour). L'application envoie l'état COMPLET de son panier
 * (`type: 'panier'`, lib/cartSync.ts de l'application) ; renvoyer le même état ne change rien.
 *
 * Fonctions pures, partagées par le serveur (api/_carts.js) et la page « Paniers » :
 *  - contrôle de l'envoi ;
 *  - prix de chaque ligne recalculé d'après le catalogue publié (format de l'application, `?v=2`),
 *    avec les mêmes règles que l'application (prix par pays, emballages, offres avion / bateau) —
 *    jamais d'après les montants envoyés par l'appareil ;
 *  - totaux par devise, jamais additionnés entre devises ;
 *  - statut : actif, abandonné, commandé, vide ;
 *  - message de relance pré-rempli (WhatsApp, appel, e-mail).
 */

export const CART_ACTIVE_MS = 24 * 3600 * 1000;
export const CART_KEEP_MS = 30 * 24 * 3600 * 1000;
export const CART_LINES_MAX = 60;
export const CART_STATUSES = ['actif', 'abandonne', 'commande', 'vide'];
export const CART_STATUS_LABEL = { actif: 'Actif', abandonne: 'Abandonné', commande: 'Commandé', vide: 'Vide' };
export const CONTACT_WAYS = ['whatsapp', 'appel', 'email'];
export const CONTACT_LABEL = { whatsapp: 'WhatsApp', appel: 'téléphone', email: 'e-mail' };

const ACCOUNT_ID = /^[A-Za-z0-9_-]{6,80}$/;
const SECRET = /^[A-Za-z0-9_-]{32,128}$/;
const COUNTRY = /^[A-Z]{2}$/;
const round2 = (n) => Math.round(n * 100) / 100;
const clip = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Date ISO envoyée par l'appareil, ramenée entre « il y a 30 jours » et « maintenant ». */
function isoOf(v, now) {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(t)) return new Date(now).toISOString();
  return new Date(Math.min(Math.max(t, now - CART_KEEP_MS), now)).toISOString();
}

/**
 * Contrôle d'un envoi `type: 'panier'`. Renvoie `{ status, error }` (refus) ou `{ value }`.
 * Le secret du compte est exigé : sans lui, l'envoi est refusé (401).
 */
export function validateCart(body, now = Date.now()) {
  const a = body?.account && typeof body.account === 'object' ? body.account : {};
  const id = typeof a.id === 'string' ? a.id.trim() : '';
  if (!ACCOUNT_ID.test(id)) return { status: 400, error: 'Identifiant de compte manquant ou illisible.' };
  const secret = typeof a.secret === 'string' ? a.secret.trim() : '';
  if (!SECRET.test(secret)) return { status: 401, error: 'Secret de compte manquant ou illisible : envoi refusé.' };
  const raw = Array.isArray(body?.lines) ? body.lines : [];
  if (raw.length > CART_LINES_MAX) return { status: 400, error: `${CART_LINES_MAX} lignes au plus dans un panier.` };
  const seen = new Set();
  const lines = [];
  for (const l of raw) {
    const lineId = clip(l?.lineId, 120);
    const qty = Number(l?.quantity);
    if (!lineId || seen.has(lineId) || !Number.isFinite(qty) || qty <= 0 || qty > 1e7) continue;
    seen.add(lineId);
    lines.push({
      line_id: lineId,
      product_id: clip(l?.productId, 60) || lineId.split(':')[0],
      name: clip(l?.product, 80),
      format_label: clip(l?.formatLabel, 60) || null,
      qty: round2(qty),
      added_at: isoOf(l?.addedAt, now),
      updated_at: isoOf(l?.updatedAt ?? l?.addedAt, now),
    });
  }
  const country = String(body?.country ?? a.country ?? '').toUpperCase();
  return {
    value: {
      account_id: id,
      secret,
      account: {
        name: clip(a.name, 80),
        type: a.type === 'pro' ? 'pro' : 'particulier',
        activity: ['grossiste', 'importateur', 'autre'].includes(a.activity) ? a.activity : null,
        company: clip(a.company, 80),
        phone: clip(a.phone, 30),
        email: clip(a.email, 120),
        whatsapp: clip(a.whatsapp, 30),
        country: COUNTRY.test(String(a.country ?? '').toUpperCase()) ? String(a.country).toUpperCase() : '',
      },
      country: COUNTRY.test(country) ? country : '',
      incoterm: body?.incoterm === 'FOB' ? 'FOB' : 'EXW',
      lines,
      updated_at: isoOf(body?.updatedAt, now),
    },
  };
}

// ───────────── Prix, comme l'application (lib/catalog/rules.ts, schema.ts, build.ts)

const groupFor = (list, country) =>
  country ? ((Array.isArray(list) ? list : []).find((g) => Array.isArray(g?.countries) && g.countries.includes(country)) ?? null) : null;

/** Visibilité d'un produit ou d'un emballage dans un pays (pays inconnu : voir l'application). */
export function visibleIn(v, country) {
  const countries = Array.isArray(v?.countries) ? v.countries : [];
  if (v?.mode === 'pays') return !!country && countries.includes(country);
  if (v?.mode === 'monde_sauf') return !country || !countries.includes(country);
  return true;
}

/** Emballage proposé dans un pays, avec ses réglages (prix, devise) ; `null` s'il n'y est pas. */
export function formatForCountry(f, country) {
  if (!f || f.available === false) return null;
  if (!visibleIn(f.visibility ?? { mode: 'monde', countries: [] }, country)) return null;
  let out = f;
  for (const s of Array.isArray(f.settings) ? f.settings : []) {
    const list = Array.isArray(s?.countries) ? s.countries : [];
    const applies = s?.mode === 'monde' || (!!country && (s?.mode === 'pays' ? list.includes(country) : !list.includes(country)));
    if (!applies) continue;
    if (s.available === false) return null;
    out = { ...out, ...(s.price !== undefined ? { price: s.price } : null), ...(s.currency ? { currency: s.currency } : null) };
  }
  return out;
}

/** Offre professionnelle → prix d'une unité commandée (un kilo, ou un conteneur), pour un incoterm. */
export function offerPrice(offer, rules, incoterm) {
  const configured = offer?.prices?.[incoterm];
  const raw = typeof configured === 'number' && configured > 0 ? configured : null;
  if (offer?.mode === 'bateau') {
    const containerKg = offer.containerKg === undefined ? (rules?.bateau?.containerKg ?? null) : offer.containerKg;
    const price = raw === null ? null : offer.priceUnit === 'conteneur' ? raw : containerKg ? raw * containerKg : null;
    return { mode: 'bateau', unit: 'conteneur', noun: ['conteneur', 'conteneurs'], price: price === null ? null : round2(price) };
  }
  return { mode: offer?.mode ?? null, unit: 'kg', noun: ['kg', 'kg'], price: offer?.priceUnit === 'kg' ? raw : null };
}

/**
 * Prix d'une ligne de panier d'après le catalogue publié (document `?v=2`). `who` : profil du client
 * (`country`, `pro`, `modes` — grossiste ou importateur —, `incoterm`). `known: false` : la ligne ne
 * correspond plus à rien de commandable pour ce client ; elle n'entre dans aucun total.
 */
export function priceLine(doc, line, who) {
  const [pid, sub] = String(line.line_id).split(':');
  const country = who.country || null;
  const p = (Array.isArray(doc?.products) ? doc.products : []).find((x) => x.id === pid);
  const none = { known: false, name: line.name || pid, format_label: line.format_label ?? null, mode: null, unit: 'kg', noun: null, unit_price: null, currency: 'EUR' };
  if (!p || !p.available || !visibleIn(p.visibility, country)) return none;

  if (!who.pro) {
    if (!p.retail || p.retail.price === null) return none;
    if (sub) {
      const f = formatForCountry((p.formats ?? []).find((x) => x.id === sub), country);
      if (!f) return none;
      const price = typeof f.price === 'number' && f.price > 0 ? f.price : null;
      return { known: true, name: p.name, format_label: f.label, mode: null, unit: 'unit', noun: f.noun ?? null, unit_price: price, currency: f.currency || 'EUR' };
    }
    const own = groupFor(p.retail.countryPrices, country);
    const price = own && typeof own.price === 'number' ? own.price : p.retail.price;
    return { known: true, name: p.name, format_label: null, mode: null, unit: p.retail.unit === 'unit' ? 'unit' : 'kg', noun: p.retail.noun ?? null, unit_price: price > 0 ? price : null, currency: 'EUR' };
  }

  const offers = (Array.isArray(p.wholesale) ? p.wholesale : [])
    .filter((o) => o.available)
    .map((o) => {
      const g = groupFor(o.countryPrices, country);
      return g ? { ...o, prices: { EXW: g.prices?.EXW ?? o.prices?.EXW, FOB: g.prices?.FOB ?? o.prices?.FOB } } : o;
    });
  if (offers.length === 0) return none;
  let offer;
  if (!who.modes) {
    if (sub) return none;
    const source = offers.find((o) => o.priceUnit === 'kg' && o.prices?.[who.incoterm]) ?? offers[0];
    offer = { mode: null, available: true, prices: source.prices, priceUnit: source.priceUnit };
  } else {
    offer = offers.find((o) => String(o.mode ?? null) === String(sub ?? null));
    if (!offer) return none;
  }
  const o = offerPrice(offer, doc.rules, who.incoterm);
  return { known: true, name: p.name, format_label: null, mode: o.mode, unit: o.unit, noun: o.noun, unit_price: o.price, currency: 'EUR' };
}

/** Lignes chiffrées d'après le catalogue, et totaux par devise (jamais additionnés entre devises). */
export function priceCart(doc, lines, who) {
  const priced = lines.map((l) => {
    const p = priceLine(doc, l, who);
    return {
      ...l,
      name: p.name,
      format_label: p.format_label,
      mode: p.mode,
      unit: p.unit,
      noun: p.noun,
      unit_price: p.unit_price,
      currency: p.currency,
      total: p.unit_price === null ? null : round2(p.unit_price * l.qty),
      known: p.known,
    };
  });
  const byCur = {};
  for (const l of priced) {
    if (l.total === null) continue;
    byCur[l.currency] = round2((byCur[l.currency] ?? 0) + l.total);
  }
  return {
    lines: priced,
    totals: Object.entries(byCur).map(([currency, amount]) => ({ currency, amount })),
    unpriced: priced.filter((l) => l.total === null).length,
  };
}

// ───────────── Statut, conservation

const timeOf = (iso) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : 0;
};

/**
 * Statut d'un panier :
 *  - `commande` : une commande de ce compte a été reçue après la dernière modification du panier
 *    (ou le panier a été vidé par cette commande) — la commande liée est renvoyée ;
 *  - `vide` : plus aucune ligne ;
 *  - `actif` : modifié il y a moins de 24 h ; `abandonne` : 24 h et plus.
 * `orders` : commandes de ce compte, `{ id, number, received_at }`.
 */
export function cartStatus(cart, orders, now = Date.now()) {
  if (cart.status === 'commande' && cart.order) return { status: 'commande', order: cart.order };
  if (!Array.isArray(cart.lines) || cart.lines.length === 0) return { status: 'vide', order: null };
  const placed = latestOrderAfter(orders, cart.changed_at);
  if (placed) return { status: 'commande', order: placed };
  return { status: now - timeOf(cart.updated_at) < CART_ACTIVE_MS ? 'actif' : 'abandonne', order: null };
}

/** Dernière commande reçue après une date, `{ id, number, received_at }` ou `null`. */
export function latestOrderAfter(orders, since) {
  const from = timeOf(since);
  const after = (Array.isArray(orders) ? orders : []).filter((o) => timeOf(o.received_at) > from);
  after.sort((a, b) => timeOf(b.received_at) - timeOf(a.received_at));
  return after[0] ? { id: after[0].id, number: after[0].number, received_at: after[0].received_at } : null;
}

/** Panier à supprimer au fil de l'eau : vide, ou sans modification depuis 30 jours. */
export const cartExpired = (cart, now = Date.now()) => !cart.lines?.length || now - timeOf(cart.updated_at) >= CART_KEEP_MS;

/** Ce que l'appareil a envoyé, sans les prix : sert à reconnaître un envoi identique. */
export function cartContent(v) {
  return JSON.stringify({
    account: v.account,
    country: v.country,
    incoterm: v.incoterm,
    lines: v.lines.map((l) => [l.line_id, l.qty, l.added_at, l.updated_at]),
  });
}

// ───────────── Relance du client

/** « Bonjour Awa, nous avons vu votre panier (3 articles). Pouvons-nous vous aider… ? » */
export function cartMessage(name, count) {
  const first = String(name ?? '').trim().split(/\s+/)[0] || '';
  return `Bonjour${first ? ` ${first}` : ''}, nous avons vu votre panier (${count} ${count > 1 ? 'articles' : 'article'}). Pouvons-nous vous aider à finaliser votre commande ?`;
}

/** Liens pré-remplis pour relancer le client ; `null` quand le moyen n'est pas connu. */
export function cartContactLinks(account, count) {
  const text = cartMessage(account?.name, count);
  const wa = String(account?.whatsapp || account?.phone || '').trim();
  const phone = String(account?.phone || '').trim();
  const email = String(account?.email || '').trim();
  return {
    message: text,
    // WhatsApp exige l'indicatif du pays (+221…, 00221…).
    whatsapp: /^(\+|00)/.test(wa) && wa.replace(/\D/g, '').length >= 8 ? `https://wa.me/${wa.replace(/\D/g, '').replace(/^00/, '')}?text=${encodeURIComponent(text)}` : null,
    call: phone.replace(/[^+\d]/g, '').length >= 7 ? `tel:${phone.replace(/[^+\d]/g, '')}` : null,
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
      ? `mailto:${email}?subject=${encodeURIComponent('Votre panier Tropicaura')}&body=${encodeURIComponent(text)}`
      : null,
  };
}
