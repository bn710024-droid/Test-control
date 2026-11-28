/**
 * Fiche produit de l'espace PROFESSIONNELS (grossistes et importateurs) — source unique, partagée
 * par la tour (saisie, contrôle, catalogue publié) et décrite à l'identique dans l'application
 * (lib/pro.ts). Rangée dans la colonne `pro` (jsonb) d'un produit de l'espace 'b2b'.
 *
 * Prix : une ligne par mode (avion, bateau, standard), et dans chaque mode une grille par groupe
 * de pays, chacun dans SA devise (fixe) :
 *   Europe → € · Amérique du Nord → $ · Afrique (dont Maroc) → F CFA · Golfe et reste du monde → $
 * Un groupe non proposé : le mode n'est pas vendu dans ces pays. Un groupe proposé sans prix :
 * « Prix sur demande ». Exceptions : des pays précis avec leur propre prix (dans la devise de leur
 * groupe). La devise de l'acheteur est celle du groupe du pays de son COMPTE.
 */
import { EUR_COUNTRIES } from './zones.js';

export const PRO_GROUPS = [
  { id: 'eu', label: 'Europe', currency: 'EUR' },
  { id: 'na', label: 'Amérique du Nord', currency: 'USD' },
  { id: 'af', label: 'Afrique (dont Maroc)', currency: 'XOF' },
  { id: 'monde', label: 'Golfe et reste du monde', currency: 'USD' },
];
export const PRO_GROUP_IDS = PRO_GROUPS.map((g) => g.id);
export const PRO_SIGN = { EUR: '€', USD: '$', XOF: 'F CFA' };

/** Europe : la zone euro des particuliers, plus les autres pays européens hors Russie et Turquie. */
export const PRO_EUROPE = [...EUR_COUNTRIES, 'AL', 'BA', 'BY', 'MD', 'MK', 'RS', 'UA'];
export const PRO_NORTH_AMERICA = ['US', 'CA', 'MX'];
export const PRO_AFRICA = [
  'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CG', 'CD', 'CI', 'DJ', 'EG', 'GQ', 'ER',
  'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'MA', 'MZ',
  'NA', 'NE', 'NG', 'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'EH', 'ZM', 'ZW',
];

/** Groupe de prix d'un pays (code ISO). Pays inconnu : Golfe et reste du monde. */
export function proGroupOf(country) {
  const code = String(country ?? '').toUpperCase();
  if (PRO_EUROPE.includes(code)) return 'eu';
  if (PRO_NORTH_AMERICA.includes(code)) return 'na';
  if (PRO_AFRICA.includes(code)) return 'af';
  return 'monde';
}
export const proCurrencyOf = (country) => PRO_GROUPS.find((g) => g.id === proGroupOf(country)).currency;

export const PRO_MODES = ['avion', 'bateau', 'standard'];
export const PRO_MODE_LABEL = { avion: 'Avion', bateau: 'Bateau', standard: 'Standard' };
/** Unité des quantités d'un mode : le bateau se commande en conteneurs, le reste en kilos. */
export const proQtyUnit = (mode) => (mode === 'bateau' ? 'conteneur' : 'kg');

export const PRO_STATUSES = [
  { id: 'disponible', label: 'Disponible' },
  { id: 'bientot', label: 'Bientôt' },
  { id: 'programme', label: 'Sur programme' },
  { id: 'hors_saison', label: 'Hors saison' },
];
export const proStatusLabel = (id) => PRO_STATUSES.find((s) => s.id === id)?.label ?? 'Disponible';
export const PRO_VOLUME_UNITS = ['tonnes', 'conteneurs'];
export const PRO_COUNTRY_MODES = ['all', 'pays', 'sauf'];
export const PRO_LIMITS = { tags: 20, tag: 40, packaging: 120, quality: 120, place: 80, terms: 600, media: 24, caption: 80, exceptions: 10 };
export const PRO_PRICE_MAX = { EUR: 10000, USD: 10000, XOF: 10000000 };

const str = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HTTPS = /^https:\/\/[^\s]+$/;

const emptyGroup = () => ({ offered: false, EXW: null, FOB: null });
export function emptyGroups() {
  return Object.fromEntries(PRO_GROUP_IDS.map((g) => [g, emptyGroup()]));
}

/** Fiche pro vide (création d'un produit dans l'espace Pros). */
export function emptyPro(defaults = {}) {
  return {
    status: 'disponible',
    campaign: { start: null, end: null },
    volume: null,
    varieties: [],
    calibres: [],
    packaging: '',
    quality: '',
    offers: [],
    countries: { mode: 'all', list: [] },
    logistics: { port: str(defaults.port), airport: str(defaults.airport), station: str(defaults.station) },
    terms: str(defaults.terms),
    globalgap: false,
    media: [],
    programmes: true,
  };
}

function tags(raw, path, errors, label) {
  const list = (Array.isArray(raw) ? raw : []).map((t) => str(t).trim()).filter(Boolean);
  const out = [...new Set(list)];
  if (out.length > PRO_LIMITS.tags) errors[path] = `${label} : ${PRO_LIMITS.tags} au plus.`;
  const long = out.find((t) => t.length > PRO_LIMITS.tag);
  if (long) errors[path] = `${label} : « ${long.slice(0, 20)}… » est trop long (${PRO_LIMITS.tag} caractères au plus).`;
  return out.slice(0, PRO_LIMITS.tags);
}

function text(raw, max, path, errors, label) {
  const v = str(raw).trim();
  if (v.length > max) errors[path] = `${label} : ${max} caractères au plus.`;
  return v.slice(0, max);
}

function price(raw, currency, path, errors) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = num(raw);
  if (n === null || n <= 0) {
    errors[path] = 'Prix : un nombre positif, ou laissez vide pour « Prix sur demande ».';
    return null;
  }
  if (n > PRO_PRICE_MAX[currency]) {
    errors[path] = `Prix trop élevé (${PRO_PRICE_MAX[currency]} ${PRO_SIGN[currency]} au plus par kg).`;
    return null;
  }
  if (currency === 'XOF' && !Number.isInteger(n)) {
    errors[path] = 'Franc CFA : un nombre entier, sans centimes.';
    return Math.round(n);
  }
  return Math.round(n * 100) / 100;
}

function qty(raw, path, errors, label) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = num(raw);
  if (n === null || n <= 0) {
    errors[path] = `${label} : un nombre positif.`;
    return null;
  }
  return Math.round(n * 1000) / 1000;
}

function countryList(raw) {
  return [...new Set((Array.isArray(raw) ? raw : []).map((c) => str(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
}

function validateOffer(raw, i, errors) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = `offers.${i}`;
  const mode = PRO_MODES.includes(src.mode) ? src.mode : null;
  if (!mode) errors[`${base}.mode`] = 'Mode : avion, bateau ou standard.';
  const unitLabel = mode === 'bateau' ? 'conteneurs' : 'kg';
  const min = qty(src.min, `${base}.min`, errors, `Minimum (${unitLabel})`);
  const step = qty(src.step, `${base}.step`, errors, `Palier (${unitLabel})`);
  const max = qty(src.max, `${base}.max`, errors, `Maximum (${unitLabel})`);
  if (min !== null && max !== null && max < min) errors[`${base}.max`] = 'Le maximum doit être au moins égal au minimum.';
  const groups = {};
  for (const g of PRO_GROUPS) {
    const gs = src.groups?.[g.id] ?? {};
    groups[g.id] = {
      offered: gs.offered === true,
      EXW: price(gs.EXW, g.currency, `${base}.groups.${g.id}.EXW`, errors),
      FOB: price(gs.FOB, g.currency, `${base}.groups.${g.id}.FOB`, errors),
    };
  }
  const taken = new Set();
  const exceptions = (Array.isArray(src.exceptions) ? src.exceptions : []).slice(0, PRO_LIMITS.exceptions).map((x, j) => {
    const at = `${base}.exceptions.${j}`;
    const countries = countryList(x?.countries);
    if (countries.length === 0) errors[`${at}.countries`] = 'Exception : choisissez au moins un pays.';
    const twice = countries.find((c) => taken.has(c));
    if (twice) errors[`${at}.countries`] = `Le pays ${twice} figure dans deux exceptions de ce mode.`;
    countries.forEach((c) => taken.add(c));
    const groupIds = [...new Set(countries.map(proGroupOf))];
    if (groupIds.length > 1) errors[`${at}.countries`] = 'Une exception ne mélange pas des pays de devises différentes : faites-en deux.';
    const currency = PRO_GROUPS.find((g) => g.id === (groupIds[0] ?? 'eu')).currency;
    return {
      countries,
      offered: x?.offered !== false,
      EXW: price(x?.EXW, currency, `${at}.EXW`, errors),
      FOB: price(x?.FOB, currency, `${at}.FOB`, errors),
    };
  });
  return { mode, active: src.active !== false, min, step, max, groups, exceptions };
}

/** Contrôle d'une fiche pro. Renvoie `{ errors, warnings, value }` (clés d'erreur `pro.<chemin>`). */
export function validatePro(input) {
  const src = input && typeof input === 'object' ? input : {};
  const errors = {};
  const warnings = [];
  const status = PRO_STATUSES.some((s) => s.id === src.status) ? src.status : 'disponible';
  const start = DATE.test(str(src.campaign?.start)) ? src.campaign.start : null;
  const end = DATE.test(str(src.campaign?.end)) ? src.campaign.end : null;
  if (start && end && end < start) errors['campaign.end'] = 'La fin de campagne doit suivre son début.';
  if (status === 'bientot' && !start) warnings.push('Statut « Bientôt » sans date de début : l’application n’affichera pas de compte à rebours.');
  let volume = null;
  if (src.volume && src.volume.amount !== null && src.volume.amount !== undefined && src.volume.amount !== '') {
    const amount = num(src.volume.amount);
    if (amount === null || amount <= 0) errors['volume'] = 'Volume annoncé : un nombre positif, ou laissez vide.';
    else volume = { amount: Math.round(amount * 1000) / 1000, unit: PRO_VOLUME_UNITS.includes(src.volume.unit) ? src.volume.unit : 'tonnes' };
  }
  const offersIn = Array.isArray(src.offers) ? src.offers : [];
  const offers = [];
  const seen = new Set();
  offersIn.slice(0, 3).forEach((o, i) => {
    const offer = validateOffer(o, i, errors);
    if (offer.mode && seen.has(offer.mode)) errors[`offers.${i}.mode`] = `Deux lignes « ${PRO_MODE_LABEL[offer.mode]} » : gardez-en une.`;
    if (offer.mode) seen.add(offer.mode);
    offers.push(offer);
  });
  const mode = PRO_COUNTRY_MODES.includes(src.countries?.mode) ? src.countries.mode : 'all';
  const list = mode === 'all' ? [] : countryList(src.countries?.list);
  if (mode !== 'all' && list.length === 0) errors['countries'] = mode === 'pays' ? 'Choisissez au moins un pays de vente.' : 'Choisissez au moins un pays exclu, ou « Monde entier ».';
  const media = (Array.isArray(src.media) ? src.media : []).slice(0, PRO_LIMITS.media).map((m, i) => {
    const url = str(m?.url).trim();
    if (!HTTPS.test(url)) errors[`media.${i}`] = 'Média : adresse https attendue.';
    const poster = str(m?.poster).trim();
    return {
      kind: m?.kind === 'video' ? 'video' : 'photo',
      url,
      ...(poster && HTTPS.test(poster) ? { poster } : null),
      caption: text(m?.caption, PRO_LIMITS.caption, `media.${i}.caption`, errors, 'Légende'),
      ...(num(m?.ratio) ? { ratio: Math.round(num(m.ratio) * 1000) / 1000 } : null),
    };
  });
  const value = {
    status,
    campaign: { start, end },
    volume,
    varieties: tags(src.varieties, 'varieties', errors, 'Variétés'),
    calibres: tags(src.calibres, 'calibres', errors, 'Calibres'),
    packaging: text(src.packaging, PRO_LIMITS.packaging, 'packaging', errors, 'Conditionnement export'),
    quality: text(src.quality, PRO_LIMITS.quality, 'quality', errors, 'Mention qualité'),
    offers,
    countries: { mode, list },
    logistics: {
      port: text(src.logistics?.port, PRO_LIMITS.place, 'logistics.port', errors, 'Port'),
      airport: text(src.logistics?.airport, PRO_LIMITS.place, 'logistics.airport', errors, 'Aéroport'),
      station: text(src.logistics?.station, PRO_LIMITS.place, 'logistics.station', errors, 'Station de conditionnement'),
    },
    terms: text(src.terms, PRO_LIMITS.terms, 'terms', errors, 'Conditions de paiement'),
    globalgap: src.globalgap === true,
    media,
    programmes: src.programmes !== false,
  };
  return { errors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [`pro.${k}`, v])), warnings, value };
}

/** Vendu dans ce pays (pays de vente du produit). */
export function proSoldIn(pro, country) {
  const code = String(country ?? '').toUpperCase();
  const list = pro?.countries?.list ?? [];
  if (pro?.countries?.mode === 'pays') return list.includes(code);
  if (pro?.countries?.mode === 'sauf') return !list.includes(code);
  return true;
}

/**
 * Offre d'un mode vue depuis un pays : `null` si le mode n'y est pas proposé ; sinon les prix EXW /
 * FOB dans la devise du groupe du pays (`null` = « Prix sur demande »).
 */
export function proOfferFor(offer, country) {
  if (!offer || offer.active === false) return null;
  const code = String(country ?? '').toUpperCase();
  const group = proGroupOf(code);
  const currency = PRO_GROUPS.find((g) => g.id === group).currency;
  const own = (offer.exceptions ?? []).find((x) => (x.countries ?? []).includes(code));
  const line = own ?? offer.groups?.[group];
  if (!line || (own ? own.offered === false : line.offered !== true)) return null;
  return { mode: offer.mode, currency, EXW: line.EXW ?? null, FOB: line.FOB ?? null, min: offer.min, step: offer.step, max: offer.max, unit: proQtyUnit(offer.mode) };
}

/** Offres proposées dans ce pays (vide : le produit n'y est pas proposé). */
export const proOffersFor = (pro, country) => (proSoldIn(pro, country) ? (pro?.offers ?? []).map((o) => proOfferFor(o, country)).filter(Boolean) : []);

/** Fiche pro publiée dans le catalogue de l'application (sans rien de propre à la tour). */
export function proToDoc(pro) {
  const p = pro && typeof pro === 'object' ? pro : emptyPro();
  return {
    status: p.status,
    campaign: p.campaign,
    volume: p.volume,
    varieties: p.varieties,
    calibres: p.calibres,
    packaging: p.packaging,
    quality: p.quality,
    offers: (p.offers ?? [])
      .filter((o) => o.active !== false && o.mode)
      .map((o) => ({
        mode: o.mode,
        unit: proQtyUnit(o.mode),
        min: o.min,
        step: o.step,
        max: o.max,
        // Seuls les groupes proposés sont publiés, chacun avec sa devise.
        groups: Object.fromEntries(
          PRO_GROUPS.filter((g) => o.groups?.[g.id]?.offered).map((g) => [g.id, { currency: g.currency, EXW: o.groups[g.id].EXW, FOB: o.groups[g.id].FOB }]),
        ),
        exceptions: (o.exceptions ?? []).map((x) => ({ ...x, currency: PRO_GROUPS.find((g) => g.id === proGroupOf(x.countries[0])).currency })),
      })),
    countries: p.countries,
    logistics: p.logistics,
    terms: p.terms,
    globalgap: p.globalgap === true,
    media: p.media,
    programmes: p.programmes !== false,
  };
}

/** Texte d'un prix pro (« 1,35 € », « 950 F CFA », « Prix sur demande »). */
export function proPriceText(n, currency) {
  if (n === null || n === undefined) return 'Prix sur demande';
  if (currency === 'XOF') return `${Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ')} F CFA`;
  return `${n.toFixed(2).replace('.', ',')} ${PRO_SIGN[currency]}`;
}
