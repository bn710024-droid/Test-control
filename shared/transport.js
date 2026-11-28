/**
 * Forfait de transport au départ du Sénégal, par zone de destination (commande d'un particulier
 * « avec transport »). Réglé dans Réglages › Transport (réglage `transport`), publié dans le
 * catalogue (`transport.zones`). Sans réglage : le barème d'exemple ci-dessous, celui que
 * l'application avait en dur.
 *
 * Un forfait est en euros (nombre), ou en francs CFA (`{ fee, currency: 'XOF' }`) pour les zones
 * qui paient en francs CFA : un panier en francs CFA se paie alors avec son transport, sans
 * conversion ni addition de devises.
 */
export const TRANSPORT_ZONES = [
  { id: 'sn', label: 'Sénégal', fee: 6, currency: 'EUR' },
  { id: 'ao', label: 'Afrique de l’Ouest', fee: 24, currency: 'EUR' },
  { id: 'af', label: 'Afrique', fee: 36, currency: 'EUR' },
  { id: 'eu', label: 'Europe', fee: 48, currency: 'EUR' },
  { id: 'na', label: 'Amérique du Nord', fee: 62, currency: 'EUR' },
  { id: 'monde', label: 'Reste du monde', fee: 78, currency: 'EUR' },
];

/** Zones dont le forfait peut être en francs CFA. */
export const CFA_ZONES = ['sn', 'ao'];
export const TRANSPORT_FEE_MAX = 10000;
const MAX = { EUR: TRANSPORT_FEE_MAX, XOF: 10000000 };

/** Montant et devise d'une zone, tels que rangés (nombre = euros). */
function feeOf(v) {
  if (typeof v === 'number') return { fee: v, currency: 'EUR' };
  if (v && typeof v === 'object') return { fee: v.fee, currency: v.currency === 'XOF' ? 'XOF' : 'EUR' };
  return null;
}

/** Zones publiées : le montant réglé pour chacune (et sa devise), ou celui du barème d'exemple. */
export function transportZonesOf(value) {
  const src = value && typeof value === 'object' ? value : {};
  return TRANSPORT_ZONES.map((z) => {
    const f = feeOf(src[z.id]);
    const ok = f && typeof f.fee === 'number' && Number.isFinite(f.fee) && f.fee >= 0;
    return ok ? { ...z, fee: Math.round(f.fee * 100) / 100, currency: CFA_ZONES.includes(z.id) ? f.currency : 'EUR' } : { ...z };
  });
}

/**
 * Contrôle d'un réglage : pour chaque zone, un montant de 0 à 10 000 € — ou, au Sénégal et en
 * Afrique de l'Ouest, en francs CFA (nombre entier, jusqu'à 10 000 000 F CFA).
 */
export function validateTransport(value) {
  const src = value && typeof value === 'object' ? value : {};
  const errors = {};
  const out = {};
  for (const z of TRANSPORT_ZONES) {
    const f = feeOf(src[z.id]);
    const currency = f && CFA_ZONES.includes(z.id) ? f.currency : 'EUR';
    const unit = currency === 'XOF' ? 'F CFA' : '€';
    if (!f || typeof f.fee !== 'number' || !Number.isFinite(f.fee)) errors[z.id] = `${z.label} : indiquez un montant (0 pour offert).`;
    else if (f.fee < 0 || f.fee > MAX[currency]) errors[z.id] = `${z.label} : entre 0 et ${MAX[currency]} ${unit}.`;
    else if (currency === 'XOF' && !Number.isInteger(f.fee)) errors[z.id] = `${z.label} : en francs CFA, un nombre entier, sans centimes.`;
    else out[z.id] = currency === 'EUR' ? Math.round(f.fee * 100) / 100 : { fee: f.fee, currency };
  }
  return { errors, value: out };
}
