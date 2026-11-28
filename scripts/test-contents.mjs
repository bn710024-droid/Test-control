/**
 * Format des contenus d'emballage dans la tour et dans `?v=2` : ≥ 1 000 g → « X kg » (deux
 * décimales au plus, zéros inutiles retirés, virgule), < 1 000 g → « X g ».
 *
 *     node scripts/test-contents.mjs
 */
import assert from 'node:assert/strict';
import { packContent, packTotal } from '../shared/catalog.js';
import { formatOf } from '../shared/catalog-v2.js';

const pack = (qty, unit, extra = {}) => ({ id: 'p', label: 'Cagette', qty, unit, price: null, ...extra });

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log('PASS', name);
};

test('kg ≥ 1 kg : « 5 kg », « 1,5 kg »', () => {
  assert.equal(packContent(pack(5, 'kg')), '5 kg');
  assert.equal(packContent(pack(1.5, 'kg')), '1,5 kg');
  assert.equal(packContent(pack(1, 'kg')), '1 kg');
});

test('kg < 1 kg : en grammes (« 500 g »)', () => {
  assert.equal(packContent(pack(0.5, 'kg')), '500 g');
  assert.equal(packContent(pack(0.25, 'kg')), '250 g');
});

test('g ≥ 1 000 g : en kilos (« 5 kg », jamais « 5000 g »)', () => {
  assert.equal(packContent(pack(5000, 'g')), '5 kg');
  assert.equal(packContent(pack(1500, 'g')), '1,5 kg');
  assert.equal(packContent(pack(999, 'g')), '999 g');
});

test('deux décimales au plus, zéros inutiles retirés', () => {
  assert.equal(packContent(pack(1.25, 'kg')), '1,25 kg');
  assert.equal(packContent(pack(1240, 'g')), '1,24 kg');
  assert.equal(packContent(pack(2.75, 'kg')), '2,75 kg');
  assert.equal(packContent(pack(1.255, 'kg')), '1,26 kg');
  assert.equal(packContent(pack(1.5, 'kg')), '1,5 kg');
  assert.equal(packContent(pack(1100, 'g')), '1,1 kg');
});

test('total de plusieurs emballages', () => {
  assert.equal(packTotal(pack(500, 'g'), 3), '1,5 kg');
  assert.equal(packTotal(pack(0.25, 'kg'), 2), '500 g');
  assert.equal(packTotal(pack(5, 'kg'), 4), '20 kg');
  assert.equal(packTotal(pack(5, 'kg'), 400), '2\u202F000 kg');
});

test('pièces inchangées, contenu absent : vide', () => {
  assert.equal(packContent(pack(6, 'piece')), '6 pièces');
  assert.equal(packContent(pack(1, 'piece')), '1 pièce');
  assert.equal(packContent(pack(null, 'kg')), '');
});

test('?v=2 : libellé d’unité au bon format', () => {
  assert.equal(formatOf(pack(5000, 'g')).unitLabel, 'par cagette de 5 kg');
  assert.equal(formatOf(pack(0.5, 'kg', { label: 'Sachet' })).unitLabel, 'par sachet de 500 g');
  assert.equal(formatOf(pack(1.5, 'kg')).grams, 1500);
});

test('jamais plus de deux décimales, ni zéro final, ni « ≥ 1000 g »', () => {
  for (let g = 1; g <= 20000; g += 7) {
    const text = packContent(pack(g, 'g'));
    if (g >= 1000) assert.match(text, /^\d+(,\d?[1-9])? kg$/, `${g} g → ${text}`);
    else assert.equal(text, `${g} g`);
  }
});

console.log(`${passed} vérifications, 0 échec`);
