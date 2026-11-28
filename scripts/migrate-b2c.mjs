// Migration B2C (28/11/2026) : produits particuliers = produits emballés, prix par zone (F CFA, €, $).
//
//   node scripts/migrate-b2c.mjs <adresse de la tour>            → liste des changements, rien n'est écrit
//   node scripts/migrate-b2c.mjs <adresse de la tour> --ecrire   → écrit, par les routes de la tour
//                                                                  (lignes scellées, journal de la tour)
//
// Idempotente : un produit déjà migré n'est plus touché. Rien n'est supprimé :
//  - rayons « séchés » et « transformés » → emballé ; prix au kilo / à la pièce gardé, plus publié ;
//  - autres produits (frais) → « Pour les particuliers » désactivé, prix gardés ;
//  - emballage : price → prices.EUR ; réglage par pays → nouvel emballage « <nom> <pays> », seulement
//    ces pays, prix dans la devise de leur zone (un prix ≥ 100 dans un pays du franc CFA = F CFA) ;
//  - emballage actif sans aucun prix → inactif (il n'était vendu nulle part).
import { currencyOf, XOF_COUNTRIES } from '../shared/zones.js';
import { countryName } from '../shared/catalog.js';

const [tower, flag] = process.argv.slice(2);
if (!tower) throw new Error('Adresse de la tour manquante.');
const write = flag === '--ecrire';
const PACKED = ['seches', 'transformes'];

const call = async (method, path, body) => {
  const r = await fetch(tower.replace(/\/$/, '') + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(data)}`);
  return data;
};

const money = (n, c) => (n === null || n === undefined ? '—' : c === 'XOF' ? `${n} F CFA` : c === 'USD' ? `${n} $` : `${n} €`);
const migratedPack = (k) => !!k.prices && !k.countryRules;

function convertPacks(packs, log) {
  const out = [];
  for (const k of packs) {
    if (migratedPack(k)) {
      out.push(k);
      continue;
    }
    const { countryRules, price, ...rest } = k;
    const base = { ...rest, prices: { XOF: null, EUR: price ?? null, USD: null }, countries: { mode: 'zone', list: [] }, is_default: false, preview_url: null };
    log.push(`  · « ${k.label} » : prix ${money(price, 'EUR')} → colonne € ${money(price, 'EUR')}`);
    if (base.available !== false && price == null) {
      base.available = false;
      log.push(`  · « ${k.label} » : aucun prix → rendu inactif (il n'était vendu nulle part)`);
    }
    out.push(base);
    for (const g of countryRules ?? []) {
      if (g.available === false || g.price == null) {
        log.push(`  · « ${k.label} » : réglage ${g.countries.join(', ')} sans prix propre → non repris (le pays suit les prix de l'emballage)`);
        continue;
      }
      const cur = g.currency === 'XOF' || (g.price >= 100 && g.countries.every((c) => XOF_COUNTRIES.includes(c))) ? 'XOF' : currencyOf(g.countries[0]);
      const label = `${k.label} ${g.countries.map(countryName).join(' ')}`.slice(0, 40);
      out.push({ ...base, id: '', label, prices: { XOF: null, EUR: null, USD: null, [cur]: g.price }, countries: { mode: 'pays', list: g.countries }, photo_url: g.photo_url || base.photo_url, available: true });
      log.push(`  + nouvel emballage « ${label} » : seulement ${g.countries.join(', ')}, prix ${money(g.price, cur)}`);
    }
  }
  return out;
}

const products = await call('GET', '/api/products');
const report = [];
let changes = 0;
for (const p of products) {
  const log = [];
  const packed = PACKED.includes(p.category);
  const retail = p.retail ?? null;
  const body = { id: p.id };
  if (retail && !retail.kind) {
    if (packed) {
      body.retail = { ...retail, kind: 'emballe', active: true };
      log.push(`  · type particuliers : Emballé (prix ${money(retail.price, 'EUR')} ${retail.unitLabel ?? ''} gardé, plus publié)`);
    } else {
      body.retail = { ...retail, kind: 'frais', active: false };
      log.push(`  · « Pour les particuliers » désactivé (prix ${money(retail.price, 'EUR')} ${retail.unitLabel ?? ''} gardé)`);
    }
  }
  const packs = p.packagings ?? [];
  if (packs.some((k) => !migratedPack(k))) body.packagings = convertPacks(packs, log);
  if (Object.keys(body).length === 1) continue;
  changes += 1;
  report.push(`${p.name} (${p.id})`, ...log);
  if (write) {
    await call('PUT', '/api/products', body);
    report.push('  ✓ écrit');
  }
}
console.log(report.join('\n'));
console.log(`\n${changes} produit(s) ${write ? 'migré(s)' : 'à migrer (rien n’est écrit sans --ecrire)'}.`);
