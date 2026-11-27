/**
 * Forfait de transport au départ du Sénégal, par zone de destination (commande d'un particulier
 * « avec transport »). Réglé dans Réglages › Transport (réglage `transport` : `{ [zone]: montant }`),
 * publié dans le catalogue (`transport.zones`). Sans réglage : le barème d'exemple ci-dessous, celui
 * que l'application avait en dur.
 */
export const TRANSPORT_ZONES = [
  { id: 'sn', label: 'Sénégal', fee: 6 },
  { id: 'ao', label: 'Afrique de l’Ouest', fee: 24 },
  { id: 'af', label: 'Afrique', fee: 36 },
  { id: 'eu', label: 'Europe', fee: 48 },
  { id: 'na', label: 'Amérique du Nord', fee: 62 },
  { id: 'monde', label: 'Reste du monde', fee: 78 },
];

export const TRANSPORT_FEE_MAX = 10000;

/** Zones publiées : le montant réglé pour chacune, ou celui du barème d'exemple. */
export function transportZonesOf(value) {
  const src = value && typeof value === 'object' ? value : {};
  return TRANSPORT_ZONES.map((z) => {
    const fee = src[z.id];
    return { ...z, fee: typeof fee === 'number' && Number.isFinite(fee) && fee >= 0 ? Math.round(fee * 100) / 100 : z.fee };
  });
}

/** Contrôle d'un réglage : un montant en euros, de 0 à 10 000 €, pour chaque zone. */
export function validateTransport(value) {
  const src = value && typeof value === 'object' ? value : {};
  const errors = {};
  const out = {};
  for (const z of TRANSPORT_ZONES) {
    const fee = src[z.id];
    if (typeof fee !== 'number' || !Number.isFinite(fee)) errors[z.id] = `${z.label} : indiquez un montant en euros (0 pour offert).`;
    else if (fee < 0 || fee > TRANSPORT_FEE_MAX) errors[z.id] = `${z.label} : entre 0 et ${TRANSPORT_FEE_MAX} €.`;
    else out[z.id] = Math.round(fee * 100) / 100;
  }
  return { errors, value: out };
}
