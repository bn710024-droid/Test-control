/**
 * Moyens de paiement réglables : `node scripts/test-payments.mjs`.
 */
import assert from 'node:assert/strict';
import { PAYMENT_METHODS, paymentStates, publishedPayments, validatePayments } from '../shared/payments.js';

assert.equal(PAYMENT_METHODS.length, 4);
assert.deepEqual(publishedPayments(null).map((m) => m.id), ['orange_money', 'wave', 'virement', 'carte'], 'jamais réglé : les quatre');
assert.deepEqual(publishedPayments({ virement: false }).map((m) => m.id), ['orange_money', 'wave', 'carte']);
assert.deepEqual(paymentStates({ wave: false }), { orange_money: true, wave: false, virement: true, carte: true });
assert.ok(validatePayments({ orange_money: false, wave: false, virement: false, carte: false }).errors.payments, 'tout désactiver est refusé');
assert.deepEqual(validatePayments({ carte: false }).errors, {});
console.log('6 vérifications, 0 échec');
