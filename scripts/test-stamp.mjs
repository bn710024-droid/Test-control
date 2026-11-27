// Écritures concurrentes d'une commande : empreinte du bloc chiffré et comparaison hors position.
import assert from 'node:assert/strict';
import { stampOf, sameButLocation } from '../shared/stamp.js';

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
};

test('empreinte : v1.iv.étiquette, sans les données', () => {
  assert.equal(stampOf('v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB==.Q0NDQ0ND'), 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB==');
});

test('empreinte : aucun caractère joker du LIKE (base64 standard)', () => {
  const stamp = stampOf('v1.ab+/cd==.ef+/gh==.data');
  assert.ok(!/[%_*]/.test(stamp), stamp);
});

test('empreinte : valeur vide ou absente', () => {
  assert.equal(stampOf(''), '');
  assert.equal(stampOf(null), '');
});

const order = { number: 'TA-1', status: 'confirmee', history: [{ status: 'attente' }, { status: 'confirmee' }], customer: { name: 'A' } };

test('seule la position a changé → même commande', () => {
  assert.ok(sameButLocation(order, { ...order, location: { lat: 14.7, lng: -17.4 } }));
  assert.ok(sameButLocation({ ...order, location: { lat: 1, lng: 1 } }, { ...order, location: { lat: 2, lng: 2 } }));
});

test('ordre des clés indifférent', () => {
  const { number, ...rest } = order;
  assert.ok(sameButLocation(order, { ...rest, number }));
});

test('statut changé par l’équipe → commande différente', () => {
  assert.ok(!sameButLocation(order, { ...order, status: 'preparation' }));
  assert.ok(!sameButLocation(order, { ...order, history: [...order.history, { status: 'preparation' }] }));
});

test('champ ajouté (livreur) → commande différente', () => {
  assert.ok(!sameButLocation(order, { ...order, courier: { id: 'l-1', name: 'Moussa' } }));
});

console.log(`\n${passed}/${passed} tests réussis`);
