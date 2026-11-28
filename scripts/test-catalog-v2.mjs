/**
 * Test de contrat — `GET /api/catalog?v=2` publie le format de l'application d'achat
 * (lib/catalog/schema.ts du dépôt de l'application). `node scripts/test-catalog-v2.mjs`.
 * Fonction pure testée sur un document v1 construit par `buildDocument`, sans base.
 */
import assert from 'node:assert/strict';
import { buildDocument, DEFAULT_RULES } from '../shared/catalog.js';
import { toAppDocument, formatOf, visibilityOfZone, nounOf, campaignsOf, categoriesOf } from '../shared/catalog-v2.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log('PASS', name);
};

const product = (id, extra = {}) => ({
  id,
  name: id,
  variety: '',
  category: 'fruits',
  origin: 'Sénégal',
  description: '',
  photo_asset: id,
  photo_url: null,
  tint: '#E89A2B',
  months: [1, 2],
  available: true,
  archived: false,
  bio: false,
  rating: 0,
  reviews: 0,
  retail: { price: 3.2, unit: 'kg', unitLabel: 'le kg', noun: ['kg', 'kg'], step: 0.5, countryPrices: [{ countries: ['SN'], price: 2 }] },
  wholesale: [{ mode: 'avion', available: true, prices: { EXW: 6, FOB: 7 }, priceUnit: 'kg', countryPrices: [{ countries: ['FR'], prices: { EXW: 5, FOB: null } }] }],
  is_example: true,
  sort_order: 0,
  ...extra,
});

const packs = {
  mangue: [
    { id: 'sachet', label: 'Sachet', qty: 500, unit: 'g', price: 3.2, step: 1, min: null, max: 10, audience: 'tous', available: true, photo_url: 'https://x/s.webp', description: 'Refermable' },
    { id: 'carton', label: 'Carton', qty: 4, unit: 'kg', price: null, step: 2, min: 2, max: null, audience: 'particuliers', available: true, photo_url: null, description: '',
      countryRules: [{ countries: ['SN'], available: true, price: 2500, photo_url: null }, { countries: ['FR'], available: false, price: null, photo_url: null }, { countries: ['BE'], available: true, price: null, photo_url: 'https://x/be.webp' }] },
    { id: 'box', label: 'Box', qty: 6, unit: 'piece', price: 9, step: 1, min: null, max: null, audience: 'tous', available: true, photo_url: null, description: '' },
    { id: 'palette', label: 'Palette', qty: 500, unit: 'kg', price: 900, step: 1, min: null, max: null, audience: 'pros', available: true, photo_url: null, description: '' },
    { id: 'off', label: 'Pot', qty: 250, unit: 'g', price: 4, step: 1, min: null, max: null, audience: 'tous', available: false, photo_url: null, description: '' },
  ],
};
const zones = { mangue: { mode: 'sn', except: [] }, ananas: { mode: 'except', except: ['FR', 'BE'] } };
const v1 = buildDocument({
  products: [product('mangue'), product('ananas', { is_example: false, retail: null })],
  categories: [{ id: 'fruits', label: 'Fruits', illustration_product: 'mangue', image_url: null, sort_order: 0 }],
  rules: DEFAULT_RULES,
  packagings: packs,
  zones,
  updatedAt: '2026-11-27T00:00:00.000Z',
});
v1.banners = [
  { key: 'a1', id: 'mangue', accent: 'du Sénégal', body: 'Kent', startsAt: null, endsAt: null, imageUrl: null, link: 'button', buttonLabel: null },
  { key: 'a2', id: null, accent: '', body: '', startsAt: null, endsAt: null, imageUrl: 'https://x/a.webp', link: 'none', buttonLabel: null },
  { key: 'a3', id: 'ananas', accent: '', body: '', startsAt: '2026-11-01T00:00:00.000Z', endsAt: null, imageUrl: 'https://x/b.webp', link: 'button', buttonLabel: 'Voir' },
];
v1.payments = [{ id: 'wave', title: 'Wave', detail: 'Sénégal', icon: 'phone-portrait-outline' }];
v1.productRequest = { enabled: true, title: 'T', body: 'B', placeholder: 'P', button: 'Envoyer', thanks: 'Merci' };
const doc = toAppDocument(v1, { demoIds: new Set(['mangue']) });
const mangue = doc.products.find((p) => p.id === 'mangue');
const ananas = doc.products.find((p) => p.id === 'ananas');

test('en-tête schema 2, clés attendues', () => {
  assert.equal(doc.schema, 2);
  for (const k of ['updatedAt', 'example', 'rules', 'products', 'campaigns', 'delivery', 'categories', 'filters', 'payments', 'productRequest']) assert.ok(k in doc, k);
  assert.deepEqual(doc.delivery, { gp: [] });
});
test('produit : clés de la tour retirées, visibilité convertie, démo', () => {
  assert.equal('packagings' in mangue, false);
  assert.equal('countries' in mangue, false);
  assert.deepEqual(mangue.visibility, { mode: 'pays', countries: ['SN'] });
  assert.deepEqual(ananas.visibility, { mode: 'monde_sauf', countries: ['BE', 'FR'] });
  assert.equal(mangue.demo, true);
  assert.equal(ananas.demo, false);
  assert.equal(ananas.retail, null);
});
test('prix par pays conservés (particuliers et pros)', () => {
  assert.deepEqual(mangue.retail.countryPrices, [{ countries: ['SN'], price: 2 }]);
  assert.deepEqual(mangue.wholesale[0].countryPrices, [{ countries: ['FR'], prices: { EXW: 5, FOB: null } }]);
});
test('formats : désactivé non publié par la tour, pros exclus', () => {
  assert.deepEqual(mangue.formats.map((f) => f.id), ['sachet', 'carton', 'box']);
});
test('format : grammes, prix entier, devise, nom, règles', () => {
  const s = mangue.formats[0];
  assert.equal(s.grams, 500);
  assert.equal(s.price, 3.2);
  assert.equal(s.currency, 'EUR');
  assert.deepEqual(s.noun, ['sachet', 'sachets']);
  assert.equal(s.unitLabel.replace(/\s/g, ' '), 'par sachet de 500 g');
  assert.deepEqual([s.step, s.min, s.max], [1, 1, 10]);
  assert.deepEqual(s.photo, { url: 'https://x/s.webp' });
  assert.equal(s.description, 'Refermable');
  assert.deepEqual(s.visibility, { mode: 'monde', countries: [] });
});
test('format : prix null conservé (« à compléter »), kg → grammes, max absent', () => {
  const c = mangue.formats[1];
  assert.equal(c.price, null);
  assert.equal(c.grams, 4000);
  assert.equal(c.unitLabel.replace(/\s/g, ' '), 'par carton de 4 kg');
  assert.equal('max' in c, false);
  // Sans photo envoyée : la photo embarquée dans l'application est désignée.
  assert.deepEqual(c.photo, { asset: 'format:mangue:carton' });
  assert.deepEqual(c.preview, { asset: 'preview:mangue:carton' });
  assert.deepEqual([c.step, c.min], [2, 2]);
});
test('réglages par pays : prix propre avec devise, prix d’origine SANS clé price, indisponible', () => {
  const [sn, fr, be] = mangue.formats[1].settings;
  assert.deepEqual(sn, { mode: 'pays', countries: ['SN'], available: true, price: 2500, currency: 'EUR' });
  assert.deepEqual(fr, { mode: 'pays', countries: ['FR'], available: false });
  assert.equal('price' in be, false);
  assert.deepEqual(be.photo, { url: 'https://x/be.webp' });
});
test('format en pièces : unit, détail, pas de grammes', () => {
  const b = mangue.formats[2];
  assert.equal(b.unit, 'unit');
  assert.equal(b.grams, null);
  assert.equal(b.detail, '6 pièces');
  assert.deepEqual(b.noun, ['box', 'box']);
});
test('annonces : image seule gardée sans produit, image et bouton', () => {
  assert.deepEqual(doc.campaigns.map((c) => c.id), ['mangue', null, 'ananas']);
  assert.equal(doc.campaigns[1].link, 'none');
  const b = doc.campaigns[2];
  assert.deepEqual(b.photo, { url: 'https://x/b.webp' });
  assert.equal(b.cta, 'Voir');
  assert.equal(b.enabled, true);
  assert.equal(b.startsAt, '2026-11-01T00:00:00.000Z');
  assert.equal('endsAt' in b, false);
});
test('rayons, filtres, paiements, introuvable', () => {
  assert.deepEqual(doc.categories, [{ id: 'fruits', label: 'Fruits', order: 0, image: { asset: 'mangue' }, pro: true }]);
  assert.deepEqual(doc.filters.all, { label: 'Tout', image: null });
  assert.equal(doc.payments[0].enabled, true);
  assert.equal(doc.productRequest.button, 'Envoyer');
});
test('vu d’un pays : emballages résolus, sans réglages par pays', () => {
  const sn = toAppDocument(buildDocument({ products: [product('mangue')], categories: [], rules: DEFAULT_RULES, packagings: packs, zones, country: 'SN' }));
  const carton = sn.products[0].formats.find((f) => f.id === 'carton');
  assert.equal(carton.price, 2500);
  assert.equal('settings' in carton, false);
  assert.equal(sn.products[0].retail.price, 2);
  const fr = toAppDocument(buildDocument({ products: [product('mangue', { id: 'm2' })], categories: [], rules: DEFAULT_RULES, packagings: { m2: packs.mangue }, zones: {}, country: 'FR' }));
  assert.equal(fr.products[0].formats.some((f) => f.id === 'carton'), false);
});
test('utilitaires', () => {
  assert.deepEqual(visibilityOfZone({ mode: 'all' }), { mode: 'monde', countries: [] });
  assert.deepEqual(visibilityOfZone({ mode: 'except', except: [] }), { mode: 'monde', countries: [] });
  assert.deepEqual(nounOf('Carton de 4 kg'), ['carton', 'cartons']);
  assert.equal(formatOf({ id: 'x', label: 'X', qty: 1, unit: 'kg', price: 0, step: 1 }).price, null);
  assert.deepEqual(campaignsOf(undefined), []);
});
test('annonces : bouton, toucher l’image, image seule sans produit', () => {
  const [btn, tap, none, bad] = [
    { key: 'a1', id: 'mangue', accent: '', body: '', imageUrl: 'https://x/a.png', link: 'button', buttonLabel: 'Voir' },
    { key: 'a2', id: 'poire', accent: '', body: '', imageUrl: 'https://x/b.png', link: 'tap', buttonLabel: null },
    { key: 'a3', id: null, accent: '', body: '', imageUrl: 'https://x/c.png', link: 'none', buttonLabel: null },
    { key: 'a4', id: null, accent: 'x', body: 'y', imageUrl: null, link: 'button' },
  ];
  const out = campaignsOf([btn, tap, none, bad]);
  assert.equal(out.length, 3, 'le modèle sans produit est écarté, l’image seule est gardée');
  assert.deepEqual([out[0].link, out[0].cta], ['button', 'Voir']);
  assert.deepEqual([out[1].link, out[1].id, 'cta' in out[1]], ['tap', 'poire', false]);
  assert.deepEqual([out[2].link, out[2].id, out[2].photo], ['none', null, { url: 'https://x/c.png' }]);
});

test('nom d’unité d’un emballage : le nom, sans son contenu, accordé au pluriel', () => {
  assert.deepEqual(nounOf('Petit carton'), ['petit carton', 'petits cartons']);
  assert.deepEqual(nounOf('Pot en verre de 200 g'), ['pot en verre', 'pots en verre']);
  assert.deepEqual(nounOf('Carton de 4 kg'), ['carton', 'cartons']);
  assert.deepEqual(nounOf('Seau'), ['seau', 'seaux']);
  assert.deepEqual(nounOf(''), ['emballage', 'emballages']);
});
test('emballage au prix d’un pays en francs CFA (?pays=) : devise publiée', () => {
  assert.equal(formatOf({ id: 's', label: 'Sachet', qty: 500, unit: 'g', price: 2500, currency: 'XOF', step: 1, available: true }, 'm').currency, 'XOF');
  assert.equal(formatOf({ id: 's', label: 'Sachet', qty: 500, unit: 'g', price: 3, step: 1, available: true }, 'm').currency, 'EUR');
});
test('rayon illustré par un produit : sa photo envoyée, sinon sa photo embarquée', () => {
  const cats = categoriesOf([{ id: 'fruits', label: 'Fruits', illustration: { product: 'mangue' } }, { id: 'x', label: 'X', illustration: { product: 'pomme' } }],
    [{ id: 'mangue', photo: { url: 'https://x/m.webp' } }, { id: 'pomme', photo: { asset: 'pomme' } }]);
  assert.deepEqual(cats[0].image, { url: 'https://x/m.webp', product: 'mangue' });
  assert.deepEqual(cats[1].image, { asset: 'pomme' });
});

console.log(`\n${passed} vérifications, 0 échec.`);
