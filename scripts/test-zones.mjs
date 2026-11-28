// Zones et devises des particuliers ; emballages visibles par pays ; emballage par défaut.
import assert from 'node:assert/strict';
import { currencyOf, packVisibleIn, packsFor, priceAlerts } from '../shared/zones.js';
import { validatePackagings } from '../shared/catalog.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
};

test('devise par pays : F CFA, euro, dollar (pays inconnu = dollar)', () => {
  assert.deepEqual(['SN', 'CI', 'GW', 'FR', 'GB', 'XK', 'US', 'MA', 'NG', '', null].map(currencyOf), ['XOF', 'XOF', 'XOF', 'EUR', 'EUR', 'EUR', 'USD', 'USD', 'USD', 'USD', 'USD']);
});
const sachet = { label: 'Sachet', available: true, prices: { XOF: 2500, EUR: 3.9, USD: 4.5 }, countries: { mode: 'zone', list: [] } };
const senegal = { label: 'Sachet Sénégal', available: true, prices: { XOF: 2000, EUR: null, USD: null }, countries: { mode: 'pays', list: ['SN'] }, is_default: true };
const sansEuro = { label: 'Pot', available: true, prices: { XOF: 4000, EUR: null, USD: 6 }, countries: { mode: 'sauf', list: ['ML'] } };
test('emballage sans prix dans la zone : invisible (Pot sans € en France)', () => {
  assert.equal(packVisibleIn(sansEuro, 'FR'), false);
  assert.equal(packVisibleIn(sansEuro, 'US'), true);
});
test('« seulement ces pays » : vu au Sénégal, pas en Côte d’Ivoire', () => {
  assert.equal(packVisibleIn(senegal, 'SN'), true);
  assert.equal(packVisibleIn(senegal, 'CI'), false);
});
test('« sauf ces pays »', () => {
  assert.equal(packVisibleIn(sansEuro, 'ML'), false);
  assert.equal(packVisibleIn(sansEuro, 'SN'), true);
});
test('emballage par défaut en tête, sinon le premier visible', () => {
  assert.deepEqual(packsFor([sachet, senegal, sansEuro], 'SN').map((k) => k.label), ['Sachet Sénégal', 'Sachet', 'Pot']);
  assert.deepEqual(packsFor([sachet, senegal, sansEuro], 'FR').map((k) => k.label), ['Sachet']);
});
test('alerte devise probablement inversée', () => {
  assert.equal(priceAlerts({ XOF: 3.9 }).length, 1);
  assert.equal(priceAlerts({ EUR: 2500 }).length, 1);
  assert.equal(priceAlerts({ XOF: 2500, EUR: 3.9, USD: 4.5 }).length, 0);
});
test('validation : contenu et au moins un prix ; un seul « par défaut »', () => {
  const r = validatePackagings([
    { label: 'A', qty: 200, unit: 'g', prices: { XOF: null, EUR: null, USD: null } },
    { label: 'B', unit: 'g', prices: { EUR: 3 }, is_default: true },
    { label: 'C', qty: 1, unit: 'kg', prices: { USD: 5 }, is_default: true },
  ]);
  assert.ok(r.errors['packagings.0.prices']);
  assert.ok(r.errors['packagings.1.qty']);
  assert.deepEqual(r.value.map((k) => k.is_default), [false, true, false]);
});

console.log(`\n${passed}/${passed} tests réussis`);
