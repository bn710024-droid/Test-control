// Paniers en cours : contrôle de l'envoi, prix recalculés d'après le catalogue, totaux par devise,
// statuts, liens de relance.
import assert from 'node:assert/strict';
import { validateCart, priceCart, cartStatus, cartExpired, cartContent, cartMessage, cartContactLinks, CART_ACTIVE_MS } from '../shared/carts.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
};

const NOW = Date.parse('2026-11-28T12:00:00Z');
const SECRET = 'a'.repeat(32);
const RULES = { avion: { minKg: 500, stepKg: 500, maxKg: 100000 }, bateau: { minContainers: 1, stepContainers: 1, maxContainers: 50, containerKg: 22000, containerLabel: 'Europe' }, standard: { minKg: 100, stepKg: 50, maxKg: 100000 } };
const world = { mode: 'monde', countries: [] };
const DOC = {
  rules: RULES,
  products: [
    {
      id: 'pomme', name: 'Pomme', available: true, visibility: world,
      retail: { price: 3.2, unit: 'kg', noun: ['kg', 'kg'], countryPrices: [{ countries: ['SN'], price: 4.4 }] },
      wholesale: [{ mode: 'avion', available: true, prices: { EXW: 1.5, FOB: 1.8 }, priceUnit: 'kg' }],
      formats: [],
    },
    {
      id: 'mangue', name: 'Mangue séchée', available: true, visibility: world,
      retail: { price: 12, unit: 'kg', noun: ['kg', 'kg'] },
      wholesale: [
        { mode: 'avion', available: true, prices: { EXW: 6.4, FOB: 7 }, priceUnit: 'kg', countryPrices: [{ countries: ['FR'], prices: { EXW: 6.9, FOB: null } }] },
        { mode: 'bateau', available: true, prices: { EXW: 0.7, FOB: 0.8 }, priceUnit: 'kg' },
      ],
      formats: [
        { id: 'sachet', label: 'Sachet', price: 3.2, currency: 'EUR', noun: ['sachet', 'sachets'], available: true, visibility: world, settings: [{ mode: 'pays', countries: ['SN'], price: 2500, currency: 'XOF', available: true }] },
        { id: 'pot', label: 'Pot', price: null, currency: 'EUR', noun: ['pot', 'pots'], available: true, visibility: world },
        { id: 'carton', label: 'Carton', price: 30, currency: 'EUR', noun: ['carton', 'cartons'], available: true, visibility: world, settings: [{ mode: 'pays', countries: ['FR'], available: false }] },
      ],
    },
    { id: 'kaki', name: 'Kaki', available: true, visibility: { mode: 'pays', countries: ['SN'] }, retail: { price: 0.95, unit: 'unit', noun: ['pièce', 'pièces'] }, wholesale: [], formats: [] },
  ],
};

const body = (over = {}) => ({
  type: 'panier',
  version: 1,
  account: { id: 'cmabc123def', secret: SECRET, name: 'Awa Diop', type: 'particulier', company: '', phone: '+221 77 000 00 21', email: 'awa@exemple.test', whatsapp: '', country: 'SN' },
  country: 'SN',
  lines: [
    { lineId: 'pomme', productId: 'pomme', product: 'Pomme', quantity: 2, unitPrice: 999, currency: 'EUR', addedAt: '2026-11-28T11:00:00Z', updatedAt: '2026-11-28T11:05:00Z' },
    { lineId: 'mangue:sachet', productId: 'mangue', product: 'Mangue séchée', formatLabel: 'Sachet', quantity: 3, unitPrice: 1, currency: 'EUR', addedAt: '2026-11-28T11:10:00Z', updatedAt: '2026-11-28T11:10:00Z' },
  ],
  updatedAt: '2026-11-28T11:10:00Z',
  ...over,
});

test('envoi sans secret valide : refusé (401)', () => {
  assert.equal(validateCart(body({ account: { ...body().account, secret: '' } }), NOW).status, 401);
  assert.equal(validateCart(body({ account: { ...body().account, secret: 'court' } }), NOW).status, 401);
});

test('identifiant de compte illisible : refusé (400)', () => {
  assert.equal(validateCart(body({ account: { ...body().account, id: 'x' } }), NOW).status, 400);
});

test('lignes contrôlées : quantité nulle, doublon et ligne vide écartés ; dates ramenées à maintenant', () => {
  const { value } = validateCart(body({ lines: [...body().lines, { lineId: 'pomme', quantity: 5 }, { lineId: 'kaki', quantity: 0 }, { quantity: 2 }, { lineId: 'kaki', quantity: 1, addedAt: '2099-01-01T00:00:00Z' }] }), NOW);
  assert.deepEqual(value.lines.map((l) => l.line_id), ['pomme', 'mangue:sachet', 'kaki']);
  assert.equal(value.lines[2].added_at, new Date(NOW).toISOString());
});

test('prix recalculés d’après le catalogue, jamais ceux de l’appareil ; prix du pays (SN)', () => {
  const { value } = validateCart(body(), NOW);
  const r = priceCart(DOC, value.lines, { country: 'SN', pro: false, modes: false, incoterm: 'EXW' });
  assert.equal(r.lines[0].unit_price, 4.4);
  assert.equal(r.lines[0].total, 8.8);
});

test('emballage au prix du Sénégal en F CFA : total en F CFA, jamais additionné aux euros', () => {
  const { value } = validateCart(body(), NOW);
  const r = priceCart(DOC, value.lines, { country: 'SN', pro: false, modes: false, incoterm: 'EXW' });
  assert.deepEqual(r.lines[1].currency, 'XOF');
  assert.deepEqual(r.totals, [{ currency: 'EUR', amount: 8.8 }, { currency: 'XOF', amount: 7500 }]);
});

test('hors Sénégal : prix d’origine en euros ; emballage non proposé dans le pays → hors total', () => {
  const lines = [
    { line_id: 'mangue:sachet', qty: 2, name: '' },
    { line_id: 'mangue:carton', qty: 1, name: 'Mangue séchée' },
    { line_id: 'kaki', qty: 1, name: 'Kaki' },
  ];
  const r = priceCart(DOC, lines, { country: 'FR', pro: false, modes: false, incoterm: 'EXW' });
  assert.deepEqual(r.totals, [{ currency: 'EUR', amount: 6.4 }]);
  assert.equal(r.lines[1].known, false);
  assert.equal(r.lines[2].known, false);
  assert.equal(r.unpriced, 2);
});

test('prix null (« Prix à confirmer ») : hors total', () => {
  const r = priceCart(DOC, [{ line_id: 'mangue:pot', qty: 2, name: '' }], { country: 'SN', pro: false, modes: false, incoterm: 'EXW' });
  assert.equal(r.lines[0].unit_price, null);
  assert.deepEqual(r.totals, []);
  assert.equal(r.unpriced, 1);
});

test('professionnel : avion au kilo (prix du pays), bateau au conteneur (prix au kilo × poids)', () => {
  const who = { country: 'FR', pro: true, modes: true, incoterm: 'EXW' };
  const r = priceCart(DOC, [{ line_id: 'mangue:avion', qty: 1000, name: '' }, { line_id: 'mangue:bateau', qty: 2, name: '' }], who);
  assert.equal(r.lines[0].unit_price, 6.9);
  assert.equal(r.lines[1].unit_price, 15400);
  assert.equal(r.lines[1].unit, 'conteneur');
  assert.deepEqual(r.totals, [{ currency: 'EUR', amount: 37700 }]);
});

test('statuts : actif, abandonné (24 h), commandé (commande reçue après), vide', () => {
  const cart = { lines: [{}], updated_at: new Date(NOW - 3600e3).toISOString(), changed_at: new Date(NOW - 3600e3).toISOString() };
  assert.equal(cartStatus(cart, [], NOW).status, 'actif');
  assert.equal(cartStatus({ ...cart, updated_at: new Date(NOW - CART_ACTIVE_MS).toISOString() }, [], NOW).status, 'abandonne');
  const orders = [{ id: 'o1', number: 'PR-1', received_at: new Date(NOW - 7200e3).toISOString() }, { id: 'o2', number: 'PR-2', received_at: new Date(NOW - 60e3).toISOString() }];
  assert.deepEqual(cartStatus(cart, orders, NOW), { status: 'commande', order: { id: 'o2', number: 'PR-2', received_at: orders[1].received_at } });
  assert.equal(cartStatus({ ...cart, lines: [] }, [], NOW).status, 'vide');
  assert.equal(cartStatus({ ...cart, lines: [], status: 'commande', order: { id: 'o2', number: 'PR-2' } }, [], NOW).status, 'commande');
});

test('suppression au fil de l’eau : vide, ou 30 jours sans modification', () => {
  assert.equal(cartExpired({ lines: [], updated_at: new Date(NOW).toISOString() }, NOW), true);
  assert.equal(cartExpired({ lines: [{}], updated_at: new Date(NOW - 31 * 86400e3).toISOString() }, NOW), true);
  assert.equal(cartExpired({ lines: [{}], updated_at: new Date(NOW - 86400e3).toISOString() }, NOW), false);
});

test('même état renvoyé : contenu identique (rien ne change)', () => {
  assert.equal(cartContent(validateCart(body(), NOW).value), cartContent(validateCart(body(), NOW).value));
  assert.notEqual(cartContent(validateCart(body(), NOW).value), cartContent(validateCart(body({ lines: [body().lines[0]] }), NOW).value));
});

test('relance : message pré-rempli, liens WhatsApp, appel et e-mail', () => {
  assert.equal(cartMessage('Awa Diop', 3), 'Bonjour Awa, nous avons vu votre panier (3 articles). Pouvons-nous vous aider à finaliser votre commande ?');
  assert.equal(cartMessage('', 1), 'Bonjour, nous avons vu votre panier (1 article). Pouvons-nous vous aider à finaliser votre commande ?');
  const links = cartContactLinks({ name: 'Awa Diop', phone: '+221 77 000 00 21', email: 'awa@exemple.test', whatsapp: '' }, 2);
  assert.equal(links.whatsapp, `https://wa.me/221770000021?text=${encodeURIComponent(cartMessage('Awa Diop', 2))}`);
  assert.equal(links.call, 'tel:+221770000021');
  assert.ok(links.email.startsWith('mailto:awa@exemple.test?subject='));
  assert.ok(links.email.includes(encodeURIComponent('nous avons vu votre panier (2 articles)')));
  assert.equal(cartContactLinks({ name: 'X', phone: '77 000 00 21' }, 1).whatsapp, null);
});

console.log(`\n${passed}/${passed} tests réussis`);
