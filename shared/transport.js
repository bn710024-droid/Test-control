/**
 * Forfait de transport au départ du Sénégal, par zone de DESTINATION (commande d'un particulier
 * « avec transport »). Chaque zone a jusqu'à trois montants, un par devise de client (F CFA, €, $) :
 * le client paie dans la devise de son compte (shared/zones.js). Réglé dans Réglages › Transport
 * (réglage `transport`), publié dans le catalogue (`transport.zones[].fees`). Montant vide : tarif à
 * confirmer pour les clients de cette devise.
 *
 * Valeurs d'avant, reprises telles quelles : un nombre = un montant en euros ; `{ fee, currency }`.
 */
import { CURRENCIES } from './zones.js';

export const TRANSPORT_ZONES = [
  { id: 'sn', label: 'Sénégal', fee: 6 },
  { id: 'ao', label: 'Afrique de l’Ouest', fee: 24 },
  { id: 'af', label: 'Afrique', fee: 36 },
  { id: 'eu', label: 'Europe', fee: 48 },
  { id: 'na', label: 'Amérique du Nord', fee: 62 },
  { id: 'monde', label: 'Reste du monde', fee: 78 },
];

export const TRANSPORT_FEE_MAX = 10000;
const MAX = { EUR: TRANSPORT_FEE_MAX, USD: TRANSPORT_FEE_MAX, XOF: 10000000 };
const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Montants d'une zone tels que rangés → `{ XOF, EUR, USD }` (null = non réglé). */
export function feesOf(v) {
  const out = { XOF: null, EUR: null, USD: null };
  if (typeof v === 'number') out.EUR = ok(v) ? v : null;
  else if (v && typeof v === 'object' && 'fee' in v) out[v.currency === 'XOF' ? 'XOF' : 'EUR'] = ok(v.fee) ? v.fee : null;
  else if (v && typeof v === 'object') for (const c of CURRENCIES) out[c] = ok(v[c]) ? v[c] : null;
  return out;
}

/** Zones publiées : les montants réglés, ou (sans réglage) le barème d'exemple en euros. */
export function transportZonesOf(value) {
  const src = value && typeof value === 'object' ? value : null;
  return TRANSPORT_ZONES.map((z) => ({
    id: z.id,
    label: z.label,
    fees: src ? feesOf(src[z.id]) : { XOF: null, EUR: z.fee, USD: null },
  }));
}

/** Contrôle : pour chaque zone, des montants de 0 à 10 000 (€, $) ou 10 000 000 F CFA entiers ; vides permis. */
export function validateTransport(value) {
  const src = value && typeof value === 'object' ? value : {};
  const errors = {};
  const out = {};
  for (const z of TRANSPORT_ZONES) {
    const raw = src[z.id] && typeof src[z.id] === 'object' && !('fee' in src[z.id]) ? src[z.id] : feesOf(src[z.id]);
    const fees = {};
    for (const c of CURRENCIES) {
      const v = raw[c];
      const key = `${z.id}.${c}`;
      if (v === null || v === undefined || v === '') fees[c] = null;
      else if (typeof v !== 'number' || !Number.isFinite(v)) errors[key] = `${z.label} : montant illisible.`;
      else if (v < 0 || v > MAX[c]) errors[key] = `${z.label} : entre 0 et ${MAX[c]}.`;
      else if (c === 'XOF' && !Number.isInteger(v)) errors[key] = `${z.label} : en F CFA, un nombre entier.`;
      else fees[c] = Math.round(v * 100) / 100;
    }
    out[z.id] = fees;
  }
  return { errors, value: out };
}
