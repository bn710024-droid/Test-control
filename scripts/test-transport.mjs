// Forfait transport des particuliers : contrôle du réglage et zones publiées dans le catalogue.
import assert from 'node:assert/strict';
import { TRANSPORT_ZONES, transportZonesOf, validateTransport } from '../shared/transport.js';
import { toAppDocument } from '../shared/catalog-v2.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
};

const full = { sn: 5, ao: 20, af: 30, eu: 45.5, na: 60, monde: 0 };

test('six zones, celles de l’application (sn, ao, af, eu, na, monde)', () => {
  assert.deepEqual(TRANSPORT_ZONES.map((z) => z.id), ['sn', 'ao', 'af', 'eu', 'na', 'monde']);
});

test('réglage complet accepté, 0 € accepté (offert)', () => {
  const { errors, value } = validateTransport(full);
  assert.deepEqual(errors, {});
  assert.deepEqual(value, full);
});

test('montant manquant, négatif ou trop grand refusé', () => {
  assert.ok(validateTransport({ ...full, eu: null }).errors.eu);
  assert.ok(validateTransport({ ...full, eu: -1 }).errors.eu);
  assert.ok(validateTransport({ ...full, eu: 10001 }).errors.eu);
  assert.ok(validateTransport({ ...full, eu: '48' }).errors.eu);
});

test('arrondi au centime', () => {
  assert.equal(validateTransport({ ...full, sn: 6.456 }).value.sn, 6.46);
});

test('sans réglage : barème de l’application', () => {
  assert.deepEqual(transportZonesOf(null).map((z) => z.fee), [6, 24, 36, 48, 62, 78]);
});

test('réglage : montants publiés zone par zone', () => {
  assert.deepEqual(transportZonesOf(full).map((z) => z.fee), [5, 20, 30, 45.5, 60, 0]);
});

const base = { updatedAt: '2026-11-27T00:00:00Z', products: [], banners: [], payments: [] };

test('catalogue ?v=2 : transport repris tel quel quand il est publié', () => {
  const transport = { currency: 'EUR', zones: transportZonesOf(full).map(({ id, label, fee }) => ({ id, label, fee })) };
  assert.deepEqual(toAppDocument({ ...base, transport }, { demoIds: new Set(), gp: [] }).transport, transport);
});

test('catalogue ?v=2 : rien publié sans réglage', () => {
  assert.equal('transport' in toAppDocument(base, { demoIds: new Set(), gp: [] }), false);
});

test('Sénégal en francs CFA : accepté (entier), publié avec sa devise', () => {
  const { errors, value } = validateTransport({ ...full, sn: { fee: 2500, currency: 'XOF' } });
  assert.deepEqual(errors, {});
  assert.deepEqual(value.sn, { fee: 2500, currency: 'XOF' });
  const sn = transportZonesOf(value).find((z) => z.id === 'sn');
  assert.deepEqual([sn.fee, sn.currency], [2500, 'XOF']);
});

test('francs CFA : centimes refusés ; hors zone CFA, la devise reste l’euro', () => {
  assert.ok(validateTransport({ ...full, ao: { fee: 12.5, currency: 'XOF' } }).errors.ao);
  assert.equal(transportZonesOf({ ...full, eu: { fee: 40, currency: 'XOF' } }).find((z) => z.id === 'eu').currency, 'EUR');
});

console.log(`\n${passed}/${passed} tests réussis`);
