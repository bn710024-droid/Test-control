// Forfait transport des particuliers : un montant par zone de destination et par devise de client.
import assert from 'node:assert/strict';
import { TRANSPORT_ZONES, transportZonesOf, validateTransport, feesOf } from '../shared/transport.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
};

test('six zones de destination', () => {
  assert.deepEqual(TRANSPORT_ZONES.map((z) => z.id), ['sn', 'ao', 'af', 'eu', 'na', 'monde']);
});
test('sans réglage : barème d’exemple en euros seulement', () => {
  assert.deepEqual(transportZonesOf(null)[3].fees, { XOF: null, EUR: 48, USD: null });
});
test('anciennes valeurs reprises : nombre = euros ; { fee, currency }', () => {
  assert.deepEqual(feesOf(6), { XOF: null, EUR: 6, USD: null });
  assert.deepEqual(feesOf({ fee: 2500, currency: 'XOF' }), { XOF: 2500, EUR: null, USD: null });
});
test('trois montants par zone, cases vides permises', () => {
  const { errors, value } = validateTransport({ sn: { XOF: 2000, EUR: 3, USD: null }, eu: { EUR: 9.5 } });
  assert.deepEqual(errors, {});
  assert.deepEqual(value.sn, { XOF: 2000, EUR: 3, USD: null });
  assert.deepEqual(value.monde, { XOF: null, EUR: null, USD: null });
});
test('F CFA entier ; montant négatif ou trop grand refusé', () => {
  assert.ok(validateTransport({ sn: { XOF: 12.5 } }).errors['sn.XOF']);
  assert.ok(validateTransport({ eu: { EUR: -1 } }).errors['eu.EUR']);
  assert.ok(validateTransport({ na: { USD: 20000 } }).errors['na.USD']);
});
test('zones publiées avec leurs montants', () => {
  const z = transportZonesOf({ sn: { XOF: 2000, EUR: null, USD: null } });
  assert.deepEqual(z[0], { id: 'sn', label: 'Sénégal', fees: { XOF: 2000, EUR: null, USD: null } });
});

console.log(`\n${passed}/${passed} tests réussis`);
