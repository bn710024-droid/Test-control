/**
 * Zones et devises des particuliers — source unique, publiée dans le catalogue (`zones`) pour
 * l'application. La devise d'un client découle du pays de son COMPTE, jamais d'un choix :
 *  - franc CFA (XOF) : Afrique de l'Ouest — SN, CI, ML, BF, NE, BJ, TG, GW ;
 *  - euro (EUR) : Union européenne + GB, CH, NO, IS, LI, MC, AD, SM, VA, ME, XK ;
 *  - dollar (USD) : tous les autres pays, et un pays inconnu.
 */
export const XOF_COUNTRIES = ['SN', 'CI', 'ML', 'BF', 'NE', 'BJ', 'TG', 'GW'];
export const EUR_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'GB', 'CH', 'NO', 'IS', 'LI', 'MC', 'AD', 'SM', 'VA', 'ME', 'XK',
];
export const CURRENCIES = ['XOF', 'EUR', 'USD'];
export const ZONE_LABEL = { XOF: 'Afrique de l’Ouest', EUR: 'Europe', USD: 'Amérique et reste du monde' };
export const CURRENCY_SIGN = { XOF: 'F CFA', EUR: '€', USD: '$' };

/** Devise d'un pays (code ISO à deux lettres). Pays inconnu : dollar. */
export function currencyOf(country) {
  const code = String(country ?? '').toUpperCase();
  if (XOF_COUNTRIES.includes(code)) return 'XOF';
  if (EUR_COUNTRIES.includes(code)) return 'EUR';
  return 'USD';
}

/** Prix d'un emballage dans une devise : un nombre positif, sinon `null` (pas vendu dans cette zone). */
export function packPrice(pack, currency) {
  const v = pack?.prices?.[currency];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Emballage proposé à un client de ce pays : actif, avec un prix dans la devise du pays, et permis
 * par son réglage de pays (« toutes les zones avec un prix », « seulement ces pays », « sauf ces pays »).
 */
export function packVisibleIn(pack, country) {
  if (!pack || pack.available === false) return false;
  const code = String(country ?? '').toUpperCase();
  if (packPrice(pack, currencyOf(code)) === null) return false;
  const list = Array.isArray(pack.countries?.list) ? pack.countries.list : [];
  if (pack.countries?.mode === 'pays') return list.includes(code);
  if (pack.countries?.mode === 'sauf') return !list.includes(code);
  return true;
}

/** Emballages proposés dans ce pays, dans l'ordre ; le premier est celui « par défaut ». */
export function packsFor(packs, country) {
  const visible = (Array.isArray(packs) ? packs : []).filter((k) => packVisibleIn(k, country));
  const def = visible.find((k) => k.is_default);
  return def ? [def, ...visible.filter((k) => k !== def)] : visible;
}

/** Alerte (non bloquante) : un prix qui semble saisi dans la mauvaise devise. */
export function priceAlerts(prices) {
  const out = [];
  const xof = prices?.XOF;
  if (typeof xof === 'number' && xof > 0 && xof < 50) out.push('Le prix en F CFA semble très bas : ne serait-ce pas un prix en euros ?');
  for (const cur of ['EUR', 'USD']) {
    const v = prices?.[cur];
    if (typeof v === 'number' && v > 1000) out.push(`Le prix en ${CURRENCY_SIGN[cur]} semble très élevé : ne serait-ce pas un prix en F CFA ?`);
  }
  return out;
}
