/**
 * Moyens de paiement proposés aux particuliers dans l'application. Aucun n'est encaissé par
 * l'application : l'équipe pointe le paiement reçu dans la tour. Chacun s'active ou se désactive
 * dans Réglages › Moyens de paiement (réglage `payments` : `{ [id]: boolean }`, absent = activé).
 */
export const PAYMENT_METHODS = [
  { id: 'orange_money', title: 'Orange Money', detail: 'Surtout au Sénégal', icon: 'phone-portrait-outline' },
  { id: 'wave', title: 'Wave', detail: 'Surtout au Sénégal', icon: 'phone-portrait-outline' },
  { id: 'virement', title: 'Virement bancaire', detail: 'Depuis l’étranger', icon: 'business-outline' },
  { id: 'carte', title: 'Carte bancaire', detail: 'Partout', icon: 'card-outline' },
];

/** État de chaque moyen : `{ orange_money: true, … }` ; un moyen absent du réglage reste activé. */
export function paymentStates(value) {
  const src = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(PAYMENT_METHODS.map((m) => [m.id, src[m.id] !== false]));
}

/** Moyens publiés dans le catalogue : seulement ceux activés, dans l'ordre de la liste. */
export function publishedPayments(value) {
  const on = paymentStates(value);
  return PAYMENT_METHODS.filter((m) => on[m.id]);
}

/** Contrôle d'un réglage : au moins un moyen doit rester proposé au client. */
export function validatePayments(value) {
  const states = paymentStates(value);
  const errors = {};
  if (!Object.values(states).some(Boolean)) {
    errors.payments = 'Gardez au moins un moyen de paiement : sans lui, le client ne peut pas commander.';
  }
  return { errors, value: states };
}
