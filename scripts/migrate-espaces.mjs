// Migration « deux espaces » (28/11/2026) : Particuliers (b2c) et Professionnels (b2b) séparés.
//
//   node scripts/migrate-espaces.mjs <adresse de la tour>            → liste des changements, rien n'est écrit
//   node scripts/migrate-espaces.mjs <adresse de la tour> --ecrire   → écrit, par les routes de la tour (idempotent)
//
// Rien n'est supprimé :
//  - les 42 produits restent dans l'espace Particuliers avec leurs données B2C (l'offre pro y est
//    gardée telle quelle, mais n'est plus publiée côté particuliers) ;
//  - chaque produit qui a une offre pro reçoit une COPIE indépendante dans l'espace Pros
//    (identifiant « <id>-pro ») : identité, photo, teinte, mois, offres ; pays = monde entier ;
//    prix existants → groupe Europe (€) ; minimum / palier / maximum repris des règles pros ;
//  - rayons copiés dans l'espace Pros (« <id>-pro »), publications aussi (s'il y en a) ;
//  - réglages : paiement et transport restent aux particuliers ; règles avion / bateau / standard
//    aux pros ; filtres de l'accueil et message « introuvable » copiés dans les deux espaces.
const [tower, flag] = process.argv.slice(2);
const write = flag === '--ecrire';
if (!tower) throw new Error('Adresse de la tour manquante.');

const call = async (path, method = 'GET', body) => {
  const r = await fetch(tower.replace(/\/$/, '') + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(data)}`);
  return data;
};

const MODE = { avion: 'Avion', bateau: 'Bateau', standard: 'Standard', null: 'Standard' };
const eur = (n) => (n === null || n === undefined ? 'prix sur demande' : `${String(n).replace('.', ',')} €`);
const months = (m) => (m.length === 12 ? 'toute l’année' : m.map((x) => ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'][x - 1]).join(' '));

const [products, categories, publications, settings] = await Promise.all([
  call('/api/products'),
  call('/api/categories'),
  call('/api/publications'),
  call('/api/settings'),
]);
const rules = settings.rules ?? {};
const qty = (mode) => {
  const r = rules[mode ?? 'standard'] ?? {};
  return mode === 'bateau'
    ? `min ${r.minContainers ?? '—'} conteneur(s), palier ${r.stepContainers ?? '—'}, max ${r.maxContainers ?? '—'}`
    : `min ${r.minKg ?? '—'} kg, palier ${r.stepKg ?? '—'} kg, max ${r.maxKg ?? '—'} kg`;
};

const out = [];
const pros = products.filter((p) => (p.wholesale ?? []).length > 0);
const b2cOn = products.filter((p) => p.retail?.kind === 'emballe' && p.retail?.active !== false);

out.push(`ESPACE PARTICULIERS — ${products.length} produits, inchangés (marqués « particuliers »)`);
out.push(`  · ${b2cOn.length} emballés actifs : ${b2cOn.map((p) => p.name).join(', ')}`);
out.push(`  · ${products.length - b2cOn.length} frais ou inactifs : « Pour les particuliers » reste désactivé`);
out.push(`  · leur offre pro est gardée en base mais n’est plus publiée aux particuliers`);
out.push('');
out.push(`ESPACE PROS — ${pros.length} copies indépendantes (pays de vente : monde entier)`);
for (const p of pros) {
  out.push(`  + ${p.name} → « ${p.id}-pro », rayon « ${p.category}-pro », ${months(p.months)}, statut ${p.available ? 'Disponible' : 'Hors saison'}`);
  if (p.zone && p.zone.mode !== 'all') out.push(`      (côté particuliers : vendu ${p.zone.mode === 'sn' ? 'au Sénégal seulement' : 'sauf ' + p.zone.except.join(', ')} — côté pros : monde entier)`);
  for (const o of p.wholesale) {
    out.push(`      ${MODE[o.mode]} ${o.available ? '' : '(inactif) '}: Europe EXW ${eur(o.prices?.EXW)} · FOB ${eur(o.prices?.FOB)} — ${qty(o.mode)} ; autres groupes vides`);
  }
}
out.push(`  Sans copie pro (aucune offre pro) : ${products.filter((p) => !(p.wholesale ?? []).length).length} produits`);
out.push('');
out.push(`RAYONS — ${categories.length} copiés dans l’espace Pros, puis indépendants :`);
const proIds = new Set(pros.map((p) => p.id));
for (const c of categories) {
  const ill = c.illustration_product && proIds.has(c.illustration_product) ? `${c.illustration_product}-pro` : null;
  out.push(`  + ${c.label} → « ${c.id}-pro », photo du rayon : ${c.image_url ? 'reprise' : ill ? `produit ${ill}` : `aucune (« ${c.illustration_product} » n’a pas de copie pro)`}`);
}
out.push('');
out.push(`PUBLICATIONS — ${publications.length} : ${publications.length ? 'copiées dans les deux espaces' : 'aucune à copier'}`);
out.push('');
out.push('RÉGLAGES');
out.push('  · Particuliers : moyens de paiement, transport (3 devises), message « introuvable », filtres de l’accueil');
out.push('  · Pros : règles avion / bateau / standard (reprises), message « introuvable » et filtres (copiés)');
out.push('  · Pros, nouveaux et VIDES (rien d’inventé) : conditions de paiement, port, aéroport, station de conditionnement');
out.push('');
out.push('COMMANDES — rien ne bouge : commandes et paniers → Particuliers ; demandes pros → Pros ; introuvables rangés selon le type du compte.');
console.log(out.join('\n'));

if (!write) process.exit(0);

// ───────────── Écriture (idempotente : ce qui existe déjà dans l'espace Pros n'est pas recopié)
const proCats = await call('/api/categories?espace=b2b');
const proProducts = await call('/api/products?espace=b2b');
const has = (list, id) => list.some((x) => x.id === id);
const done = [];

// 1. Rayons (sans illustration : les produits pros n'existent pas encore)
for (const c of categories) {
  const id = `${c.id}-pro`;
  if (has(proCats, id)) continue;
  await call('/api/categories?espace=b2b', 'POST', { id, label: c.label, illustration_product: null, image_url: c.image_url ?? null, image_ratio: c.image_ratio ?? 1, pro_visible: true });
  done.push(`rayon ${id}`);
}

// 2. Produits : copie indépendante, offres → groupe Europe (€)
const num = (n) => (typeof n === 'number' && n > 0 ? n : null);
const rulesQty = (mode) => {
  const r = rules[mode] ?? {};
  return mode === 'bateau' ? { min: num(r.minContainers), step: num(r.stepContainers), max: num(r.maxContainers) } : { min: num(r.minKg), step: num(r.stepKg), max: num(r.maxKg) };
};
const empty = () => ({ offered: false, EXW: null, FOB: null });
for (const p of pros) {
  const id = `${p.id}-pro`;
  if (has(proProducts, id)) continue;
  const offers = p.wholesale.map((o) => {
    const mode = o.mode === 'avion' || o.mode === 'bateau' ? o.mode : 'standard';
    const q = rulesQty(mode);
    return {
      mode,
      active: o.available !== false,
      min: num(o.minQty) ?? q.min,
      step: num(o.stepQty) ?? q.step,
      max: num(o.maxQty) ?? q.max,
      groups: { eu: { offered: true, EXW: num(o.prices?.EXW), FOB: num(o.prices?.FOB) }, na: empty(), af: empty(), monde: empty() },
      exceptions: [],
    };
  });
  await call('/api/products?espace=b2b', 'POST', {
    id,
    name: p.name,
    variety: p.variety ?? '',
    category: `${p.category}-pro`,
    origin: p.origin ?? '',
    description: p.description ?? '',
    photo_asset: p.photo_asset ?? null,
    photo_url: p.photo_url ?? null,
    photo_ratio: p.photo_ratio ?? 1,
    tint: p.tint,
    months: p.months,
    available: p.available === true,
    bio: false,
    is_example: p.is_example === true,
    pro: {
      status: p.available ? 'disponible' : 'hors_saison',
      campaign: { start: null, end: null },
      volume: null,
      varieties: [],
      calibres: [],
      packaging: '',
      quality: '',
      offers,
      countries: { mode: 'all', list: [] },
      logistics: { port: '', airport: '', station: '' },
      terms: '',
      globalgap: false,
      media: [],
      programmes: true,
    },
  });
  done.push(`produit ${id}`);
}

// 3. Illustrations des rayons pros (produit illustrant copié, s'il existe)
const nowCats = await call('/api/categories?espace=b2b');
for (const c of categories) {
  const id = `${c.id}-pro`;
  const ill = c.illustration_product && proIds.has(c.illustration_product) ? `${c.illustration_product}-pro` : null;
  const cur = nowCats.find((x) => x.id === id);
  if (!cur || !ill || cur.illustration_product === ill) continue;
  await call('/api/categories?espace=b2b', 'PUT', { id, illustration_product: ill });
  done.push(`illustration ${id}`);
}

// 4. Réglages copiés : filtres de l'accueil et message « introuvable »
const proSettings = await call('/api/settings?espace=b2b');
for (const key of ['filters', 'missing']) {
  if (proSettings[key] || !settings[key]) continue;
  await call('/api/settings?espace=b2b', 'PUT', { key, value: settings[key] });
  done.push(`réglage pro.${key}`);
}
console.log(`
Écrit : ${done.length ? done.join(', ') : 'rien (déjà migré)'}`);
