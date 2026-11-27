/**
 * Règles communes à l'administration (navigateur) et à ses routes serveur.
 *
 * Ce fichier reprend, sans les modifier, le format et les calculs de l'application d'achat :
 *  - `lib/catalog/schema.ts`  → format du document, `parseCatalog`
 *  - `lib/catalog/rules.ts`   → `resolveOffer` (minimums, paliers, conteneurs, totaux)
 * Les contrôles de saisie (`validateProduct`, `validateCategory`, `validateRules`) sont exécutés
 * deux fois : dans le formulaire pour expliquer l'erreur, puis sur le serveur qui a le dernier mot.
 */

export const SCHEMA_VERSION = 1;
export const DEFAULT_TINT = '#7AAA2C';
export const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const INCOTERMS = ['EXW', 'FOB'];

/** Plafonds de saisie : ils servent à attraper une virgule oubliée, pas à fixer une politique. */
export const LIMITS = {
  retailPrice: 10000,
  kgPrice: 10000,
  containerPrice: 10000000,
  containerKg: 40000,
  qtyKg: 1000000,
  containers: 999,
};

export const DEFAULT_RULES = {
  standard: { minKg: 500, stepKg: 100, maxKg: 100000 },
  avion: { minKg: 500, stepKg: 500, maxKg: 100000 },
  bateau: {
    minContainers: 1,
    stepContainers: 1,
    maxContainers: 99,
    containerKg: 22000,
    containerLabel: 'Europe',
  },
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const str = (v) => (typeof v === 'string' ? v : '');
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => isNum(v) && Math.round(v) === v;
const empty = (v) => v === null || v === undefined || v === '';
const bySort = (a, b) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id).localeCompare(String(b.id));

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
const fr = (n) => {
  const [whole, rest] = String(Math.round(n * 100) / 100).split('.');
  return `${group(whole)}${rest ? `,${rest}` : ''}`;
};

export const MODE_LABEL = { avion: 'Avion', bateau: 'Bateau', standard: 'Standard' };
export const modeLabel = (mode) => MODE_LABEL[mode ?? 'standard'];

/** « Mangue séchée » → « mangue-sechee ». */
export function slugify(value) {
  return str(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/gi, 'oe')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

// ───────────── Lecture d'un document, à l'identique de lib/catalog/schema.ts

const text = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const numberOr = (v, fallback) => positive(v) ?? fallback;

export function parseRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_RULES;
  const kg = (src, base) => ({
    minKg: numberOr(src?.minKg, base.minKg),
    stepKg: numberOr(src?.stepKg, base.stepKg),
    maxKg: numberOr(src?.maxKg, base.maxKg),
  });
  return {
    standard: kg(r.standard, d.standard),
    avion: kg(r.avion, d.avion),
    bateau: {
      minContainers: Math.round(numberOr(r.bateau?.minContainers, d.bateau.minContainers)),
      stepContainers: Math.round(numberOr(r.bateau?.stepContainers, d.bateau.stepContainers)),
      maxContainers: Math.round(numberOr(r.bateau?.maxContainers, d.bateau.maxContainers)),
      containerKg:
        r.bateau && 'containerKg' in r.bateau
          ? positive(r.bateau.containerKg)
          : d.bateau.containerKg,
      containerLabel: text(r.bateau?.containerLabel, d.bateau.containerLabel),
    },
  };
}

function parseWholesale(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw;
  if (o.mode != null && o.mode !== 'avion' && o.mode !== 'bateau') return null;
  const mode = o.mode === 'avion' || o.mode === 'bateau' ? o.mode : null;
  const prices = o.prices && typeof o.prices === 'object' ? o.prices : {};
  const offer = {
    mode,
    available: o.available !== false,
    prices: { EXW: positive(prices.EXW), FOB: positive(prices.FOB) },
    priceUnit: o.priceUnit === 'conteneur' && mode === 'bateau' ? 'conteneur' : 'kg',
  };
  const min = positive(o.minQty);
  const step = positive(o.stepQty);
  const max = positive(o.maxQty);
  if (min) offer.minQty = min;
  if (step) offer.stepQty = step;
  if (max) offer.maxQty = max;
  if ('containerKg' in o) offer.containerKg = positive(o.containerKg);
  return offer;
}

function parseRetail(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw;
  const noun = Array.isArray(o.noun) && o.noun.length === 2 ? o.noun.map((n) => text(n)) : null;
  const unit = o.unit === 'unit' ? 'unit' : 'kg';
  const offer = {
    price: positive(o.price),
    unit,
    unitLabel: text(o.unitLabel, unit === 'kg' ? 'le kg' : 'la pièce'),
    noun: noun ? [noun[0], noun[1]] : unit === 'kg' ? ['kg', 'kg'] : ['pièce', 'pièces'],
    step: numberOr(o.step, unit === 'kg' ? 0.5 : 1),
  };
  const min = positive(o.min);
  const max = positive(o.max);
  if (min) offer.min = min;
  if (max) offer.max = max;
  return offer;
}

function parseProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw;
  if (typeof p.id !== 'string' || !p.id || p.id.includes(':') || typeof p.name !== 'string') {
    return null;
  }
  const photo = p.photo && typeof p.photo === 'object' ? p.photo : {};
  const months = (Array.isArray(p.months) ? p.months : []).filter(
    (m) => typeof m === 'number' && m >= 1 && m <= 12,
  );
  return {
    id: p.id,
    name: p.name,
    variety: text(p.variety),
    category: text(p.category, 'fruits'),
    origin: text(p.origin),
    description: text(p.description),
    photo:
      typeof photo.url === 'string' && photo.url
        ? { url: photo.url }
        : { asset: text(photo.asset, p.id) },
    tint: HEX.test(text(p.tint)) ? text(p.tint) : DEFAULT_TINT,
    months: months.length > 0 ? months : [...ALL_MONTHS],
    available: p.available !== false,
    bio: p.bio === true,
    rating: typeof p.rating === 'number' ? p.rating : 0,
    reviews: typeof p.reviews === 'number' ? p.reviews : 0,
    retail: parseRetail(p.retail),
    wholesale: (Array.isArray(p.wholesale) ? p.wholesale : []).map(parseWholesale).filter(Boolean),
  };
}

/**
 * Ce que l'application d'achat garderait d'un document reçu (copie de son `parseCatalog`).
 * Renvoie `null` quand elle le refuserait et conserverait son catalogue embarqué.
 */
export function parseCatalog(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw;
  if (d.schema !== SCHEMA_VERSION || !Array.isArray(d.products)) return null;
  const seen = new Set();
  const products = d.products
    .map(parseProduct)
    .filter((p) => !!p && !seen.has(p.id) && !!seen.add(p.id));
  if (products.length === 0) return null;
  return {
    schema: SCHEMA_VERSION,
    updatedAt: text(d.updatedAt, new Date().toISOString()),
    example: d.example === true,
    rules: parseRules(d.rules),
    products,
  };
}

// ───────────── Calculs d'une offre professionnelle, à l'identique de lib/catalog/rules.ts

const round2 = (n) => Math.round(n * 100) / 100;

/** Traduit une offre en règles applicables pour un incoterm. Aucun prix n'est inventé. */
export function resolveOffer(offer, rules, incoterm) {
  const configured = offer.prices?.[incoterm];
  const raw = typeof configured === 'number' && configured > 0 ? configured : null;

  if (offer.mode === 'bateau') {
    const r = rules.bateau;
    const containerKg = offer.containerKg === undefined ? r.containerKg : offer.containerKg;
    const perContainer = offer.priceUnit === 'conteneur';
    const price = raw === null ? null : perContainer ? raw : containerKg ? raw * containerKg : null;
    return {
      unit: 'unit',
      noun: ['conteneur', 'conteneurs'],
      step: Math.max(1, Math.round(offer.stepQty ?? r.stepContainers)),
      min: Math.max(1, Math.round(offer.minQty ?? r.minContainers)),
      max: Math.max(1, Math.round(offer.maxQty ?? r.maxContainers)),
      strictStep: true,
      mode: 'bateau',
      price: price === null ? 0 : round2(price),
      noPrice: price === null,
      missing: price !== null ? null : raw === null ? 'prix' : 'poids',
      shownPrice: raw,
      shownUnit: perContainer ? 'le conteneur' : 'le kg',
      containerKg: containerKg ?? null,
    };
  }

  const r = offer.mode === 'avion' ? rules.avion : rules.standard;
  const price = offer.priceUnit === 'kg' ? raw : null;
  return {
    unit: 'kg',
    noun: ['kg', 'kg'],
    step: offer.stepQty ?? r.stepKg,
    min: offer.minQty ?? r.minKg,
    max: offer.maxQty ?? r.maxKg,
    strictStep: offer.mode === 'avion',
    mode: offer.mode ?? null,
    price: price ?? 0,
    noPrice: price === null,
    missing: price === null ? 'prix' : null,
    shownPrice: price,
    shownUnit: 'le kg',
    containerKg: null,
  };
}

/** Total d'une ligne, ou `null` si le prix n'est pas défini. */
export function lineTotal(line, qty) {
  return line.noPrice ? null : round2(line.price * qty);
}

// ───────────── Des lignes de la base au document publié

function offerToDoc(o) {
  const mode = o.mode === 'avion' || o.mode === 'bateau' ? o.mode : null;
  const out = {
    mode,
    available: o.available !== false,
    prices: { EXW: positive(o.prices?.EXW), FOB: positive(o.prices?.FOB) },
    priceUnit: o.priceUnit === 'conteneur' && mode === 'bateau' ? 'conteneur' : 'kg',
  };
  if (positive(o.minQty)) out.minQty = o.minQty;
  if (positive(o.stepQty)) out.stepQty = o.stepQty;
  if (positive(o.maxQty)) out.maxQty = o.maxQty;
  if (mode === 'bateau' && 'containerKg' in o && o.containerKg !== undefined) {
    out.containerKg = positive(o.containerKg);
  }
  const byCountry = offerCountryPrices(o);
  if (byCountry.length > 0) out.countryPrices = byCountry;
  return out;
}

function retailToDoc(r) {
  if (!r || typeof r !== 'object') return null;
  const unit = r.unit === 'unit' ? 'unit' : 'kg';
  const out = {
    price: positive(r.price),
    unit,
    unitLabel: str(r.unitLabel) || (unit === 'kg' ? 'le kg' : 'la pièce'),
    noun:
      Array.isArray(r.noun) && r.noun.length === 2
        ? [str(r.noun[0]), str(r.noun[1])]
        : unit === 'kg'
          ? ['kg', 'kg']
          : ['pièce', 'pièces'],
    step: positive(r.step) ?? (unit === 'kg' ? 0.5 : 1),
  };
  if (positive(r.min)) out.min = r.min;
  if (positive(r.max)) out.max = r.max;
  const byCountry = retailCountryPrices(r);
  if (byCountry.length > 0) out.countryPrices = byCountry;
  return out;
}

export function productToDoc(row) {
  return {
    id: row.id,
    name: row.name,
    variety: str(row.variety),
    category: str(row.category),
    origin: str(row.origin),
    description: str(row.description),
    photo: row.photo_url ? { url: row.photo_url } : { asset: row.photo_asset || row.id },
    tint: HEX.test(str(row.tint)) ? row.tint : DEFAULT_TINT,
    months: (Array.isArray(row.months) ? row.months : []).filter((m) => isInt(m) && m >= 1 && m <= 12),
    available: row.available !== false,
    bio: row.bio === true,
    rating: Number(row.rating) || 0,
    reviews: Number(row.reviews) || 0,
    retail: retailToDoc(row.retail),
    wholesale: (Array.isArray(row.wholesale) ? row.wholesale : []).map(offerToDoc),
  };
}

/**
 * Document publié à l'application d'achat. Les produits archivés n'y figurent pas ; les produits
 * masqués y figurent avec `available: false`, comme le prévoit le format.
 * `categories` est une clé supplémentaire : l'application actuelle l'ignore (ses rayons sont dans
 * son code), une version future pourra la lire.
 */
export function buildDocument({ products, categories, rules, updatedAt, proHidden, packagings, zones, country }) {
  // `country` (code ISO) : document tel que le voit un client de ce pays — les produits réservés
  // à d'autres pays en sont retirés. Sans pays, tout est publié avec la zone de chaque produit.
  const rows = (products || [])
    .filter((p) => !p.archived)
    .filter((p) => !country || zoneAllows(zones?.[p.id], country))
    .sort(bySort);
  // Rayons masqués aux grossistes et importateurs : aucune offre professionnelle n'est publiée.
  const hidden = new Set(proHidden || []);
  return {
    schema: SCHEMA_VERSION,
    updatedAt: updatedAt || new Date().toISOString(),
    example: rows.some((p) => p.is_example === true),
    rules: parseRules(rules),
    // `packagings` : emballages proposés pour le produit (clé supplémentaire, ignorée par une
    // application qui ne la connaît pas). Dans un rayon masqué aux professionnels, les emballages
    // qui leur sont réservés ne sont pas publiés.
    products: rows.map((p) => {
      const packs = (packagings?.[p.id] ?? [])
        .filter((k) => k.available !== false && !(hidden.has(p.category) && k.audience === 'pros'))
        // Vu d'un pays : seuls les emballages proposés dans ce pays, chacun à son prix dans ce pays.
        .flatMap((k) => (country ? (packFor(k, country) ?? []) : [k]));
      const full = hidden.has(p.category) ? { ...productToDoc(p), wholesale: [] } : productToDoc(p);
      // Vu d'un pays : chaque prix est celui de ce pays, la liste des prix par pays n'est plus utile.
      const doc = country ? { ...full, retail: retailFor(full.retail, country), wholesale: full.wholesale.map((o) => offerFor(o, country)) } : full;
      // `countries` : où le produit s'affiche (« all », « sn », ou « except » avec les pays exclus).
      return { ...doc, packagings: packs.map(({ available: _a, ...k }) => ({ ...k, ...packRange(k) })), countries: zoneOf(zones?.[p.id]) };
    }),
    categories: [...(categories || [])].sort(bySort).map((c) => ({
      id: c.id,
      label: c.label,
      pro: !hidden.has(c.id),
      illustration: c.image_url
        ? { url: c.image_url }
        : c.illustration_product
          ? { product: c.illustration_product }
          : null,
    })),
  };
}

// ───────────── Contrôles de saisie

// ───────────── Prix par pays
// Le prix saisi sur une offre est le prix global : il vaut pour tous les pays, sauf ceux à qui
// l'on donne leur propre prix. Chaque groupe de pays porte son prix ; un pays ne figure que dans
// un seul groupe par offre. Cela vaut pour les particuliers comme pour les grossistes et
// importateurs, séparément.
export const COUNTRY_PRICE_LIMIT = 30;

const codesOf = (list) => [...new Set((Array.isArray(list) ? list : []).map((c) => String(c ?? '').toUpperCase()).filter((c) => COUNTRY_SET.has(c)))];

/** Prix par pays d'une offre particuliers, tels qu'enregistrés : `[{ countries, price }]`. */
export function retailCountryPrices(retail) {
  return (Array.isArray(retail?.countryPrices) ? retail.countryPrices : [])
    .map((g) => ({ countries: codesOf(g?.countries), price: positive(g?.price) }))
    .filter((g) => g.countries.length > 0 && g.price !== null);
}

/** Prix par pays d'une offre professionnelle : `[{ countries, prices: { EXW, FOB } }]`. */
export function offerCountryPrices(offer) {
  return (Array.isArray(offer?.countryPrices) ? offer.countryPrices : [])
    .map((g) => ({ countries: codesOf(g?.countries), prices: { EXW: positive(g?.prices?.EXW), FOB: positive(g?.prices?.FOB) } }))
    .filter((g) => g.countries.length > 0 && (g.prices.EXW !== null || g.prices.FOB !== null));
}

const groupOf = (list, country) => {
  const here = String(country ?? '').toUpperCase();
  return here ? (list.find((g) => g.countries.includes(here)) ?? null) : null;
};

/** Prix particulier appliqué dans un pays : le sien s'il en a un, sinon le prix global. */
export function retailPriceFor(retail, country) {
  if (!retail) return null;
  const own = groupOf(retailCountryPrices(retail), country);
  return own ? own.price : positive(retail.price);
}

/**
 * Prix professionnels appliqués dans un pays. Un incoterm laissé vide pour ce pays garde le prix
 * global de l'offre.
 */
export function offerPricesFor(offer, country) {
  const base = { EXW: positive(offer?.prices?.EXW), FOB: positive(offer?.prices?.FOB) };
  const own = groupOf(offerCountryPrices(offer), country);
  return own ? { EXW: own.prices.EXW ?? base.EXW, FOB: own.prices.FOB ?? base.FOB } : base;
}

/** L'offre particuliers telle que la voit un client de ce pays : un seul prix, le sien. */
export function retailFor(retail, country) {
  if (!retail) return null;
  const { countryPrices: _list, ...rest } = retail;
  return { ...rest, price: retailPriceFor(retail, country) };
}

/** L'offre professionnelle telle que la voit un client de ce pays. */
export function offerFor(offer, country) {
  const { countryPrices: _list, ...rest } = offer;
  return { ...rest, prices: offerPricesFor(offer, country) };
}

/** Pays qui ont leur propre prix, tous groupes confondus. */
export const pricedCountries = (list) => (Array.isArray(list) ? list : []).flatMap((g) => (Array.isArray(g?.countries) ? g.countries : []));

/** « tous les pays » ou « tous les pays sauf Sénégal et Mali » : là où vaut le prix global. */
export function globalScope(list) {
  const names = [...new Set(pricedCountries(list))].map(countryName);
  if (names.length === 0) return 'tous les pays';
  if (names.length > 4) return `tous les pays sauf ${names.length} pays`;
  return `tous les pays sauf ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`}`;
}

/** Contrôle la liste des pays d'un groupe. `taken` : pays déjà servis par un groupe précédent. */
function groupCountries(raw, at, errors, taken, noun = 'prix') {
  const asked = Array.isArray(raw) ? raw.map((c) => String(c ?? '').toUpperCase()) : [];
  const countries = [...new Set(asked.filter((c) => COUNTRY_SET.has(c)))];
  if (asked.some((c) => !COUNTRY_SET.has(c))) errors[`${at}.countries`] = 'Pays inconnu dans cette liste.';
  else if (countries.length === 0) errors[`${at}.countries`] = `Choisissez au moins un pays pour ce ${noun}.`;
  else {
    const twice = countries.find((c) => taken.has(c));
    if (twice) errors[`${at}.countries`] = `${countryName(twice)} a déjà son ${noun} plus haut : un pays ne peut avoir qu’un seul ${noun}.`;
  }
  countries.forEach((c) => taken.add(c));
  return countries;
}

function validateRetailCountryPrices(input, errors) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > COUNTRY_PRICE_LIMIT) errors['retail.countryPrices'] = `${COUNTRY_PRICE_LIMIT} prix par pays au plus.`;
  const taken = new Set();
  return list.slice(0, COUNTRY_PRICE_LIMIT).map((g, j) => {
    const at = `retail.countryPrices.${j}`;
    const countries = groupCountries(g?.countries, at, errors, taken);
    const price = money(g?.price, `${at}.price`, errors, 'Prix pour ces pays', LIMITS.retailPrice);
    if (price === null && !errors[`${at}.price`]) errors[`${at}.price`] = 'Indiquez le prix pour ces pays, ou retirez-les : ils garderont alors le prix global.';
    return { countries, price };
  });
}

function validateOfferCountryPrices(input, base, errors, general, priceMax, name) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > COUNTRY_PRICE_LIMIT) errors[`${base}.countryPrices`] = `${COUNTRY_PRICE_LIMIT} prix par pays au plus.`;
  const taken = new Set();
  return list.slice(0, COUNTRY_PRICE_LIMIT).map((g, j) => {
    const at = `${base}.countryPrices.${j}`;
    const countries = groupCountries(g?.countries, at, errors, taken);
    const prices = {
      EXW: money(g?.prices?.EXW, `${at}.prices.EXW`, errors, `Prix EXW ${name} pour ces pays`, priceMax),
      FOB: money(g?.prices?.FOB, `${at}.prices.FOB`, errors, `Prix FOB ${name} pour ces pays`, priceMax),
    };
    if (prices.EXW === null && prices.FOB === null && !errors[`${at}.prices.EXW`] && !errors[`${at}.prices.FOB`]) {
      errors[`${at}.prices.EXW`] = 'Indiquez au moins un prix pour ces pays, ou retirez-les : ils garderont alors le prix global.';
    }
    // Un incoterm laissé vide garde le prix global : la cohérence se juge sur ce qui sera appliqué.
    const exw = prices.EXW ?? general.EXW;
    const fob = prices.FOB ?? general.FOB;
    if (exw !== null && fob !== null && fob < exw && !errors[`${at}.prices.EXW`] && !errors[`${at}.prices.FOB`]) {
      errors[`${at}.prices.${prices.FOB !== null ? 'FOB' : 'EXW'}`] = `Prix incohérents pour ces pays : le FOB (${fr(fob)} €) serait inférieur à l’EXW (${fr(exw)} €).`;
    }
    return { countries, prices };
  });
}

// ───────────── Emballages par pays
// À ne pas confondre avec les pays où le PRODUIT s'affiche (rubrique « Pays ») : ici, on règle un
// emballage pour un pays — proposé ou non, au prix d'origine ou à un prix propre. Ces réglages
// s'enregistrent même pour un pays où le produit n'est pas affiché : ils y serviront le jour où
// il le sera. Tant qu'il ne l'est pas, le client de ce pays ne voit ni le produit ni l'emballage.

/**
 * Réglages par pays d'un emballage : `[{ countries, available, price, photo_url }]`.
 * `price: null` : prix d'origine. `photo_url: null` : même photo que l'emballage d'origine.
 */
export function packCountryRules(pack) {
  return (Array.isArray(pack?.countryRules) ? pack.countryRules : [])
    .map((g) => ({
      countries: codesOf(g?.countries),
      available: g?.available !== false,
      price: positive(g?.price),
      photo_url: typeof g?.photo_url === 'string' && g.photo_url ? g.photo_url : null,
    }))
    .filter((g) => g.countries.length > 0);
}

/**
 * L'emballage tel qu'il est proposé dans un pays : à son prix d'origine ou au prix de ce pays,
 * avec sa photo d'origine ou la photo propre à ce pays.
 * `null` : il n'y est pas proposé. Sans pays, ou pour un pays sans réglage : l'emballage d'origine.
 */
export function packFor(pack, country) {
  const { countryRules: _rules, ...rest } = pack;
  const own = groupOf(packCountryRules(pack), country);
  if (!own) return rest;
  if (!own.available) return null;
  return { ...rest, ...(own.price !== null ? { price: own.price } : null), ...(own.photo_url ? { photo_url: own.photo_url } : null) };
}

// ───────────── Emballages d'un produit (carton, barquette, sachet…)
// ───────────── Pays où un produit s'affiche
// Trois niveaux : le monde entier, le Sénégal uniquement, ou le monde entier sauf certains pays.
// Les pays sont désignés par leur code ISO 3166-1 à deux lettres, comme dans l'application.
export const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');
const COUNTRY_SET = new Set(COUNTRY_CODES);
export const HOME_COUNTRY = 'SN';
export const ZONE_MODES = ['all', 'sn', 'except'];
export const ZONE_EXCEPT_LIMIT = 80;
export const DEFAULT_ZONE = { mode: 'all', except: [] };

let regionNames = null;
/** Nom français d'un pays (« SN » → « Sénégal »). */
export function countryName(code) {
  const c = String(code ?? '').toUpperCase();
  try {
    regionNames = regionNames || new Intl.DisplayNames(['fr'], { type: 'region' });
    return regionNames.of(c) || c;
  } catch {
    return c;
  }
}
export const isCountryCode = (code) => COUNTRY_SET.has(String(code ?? '').toUpperCase());

/** Remet une zone en forme, quoi qu'on ait reçu : une valeur inconnue vaut « monde entier ». */
export function zoneOf(raw) {
  const mode = ZONE_MODES.includes(raw?.mode) ? raw.mode : 'all';
  const except =
    mode === 'except'
      ? [...new Set((Array.isArray(raw?.except) ? raw.except : []).map((c) => String(c ?? '').toUpperCase()).filter((c) => COUNTRY_SET.has(c)))].sort()
      : [];
  return { mode, except };
}

export function validateZone(input) {
  const errors = {};
  if (input !== undefined && input !== null && !ZONE_MODES.includes(input?.mode)) errors.zone = 'Choisissez où ce produit s’affiche.';
  const value = zoneOf(input);
  if (input?.mode === 'except') {
    const sent = Array.isArray(input.except) ? input.except : [];
    if (sent.some((c) => !COUNTRY_SET.has(String(c ?? '').toUpperCase()))) errors.zone = 'Un des pays choisis n’est pas reconnu.';
    else if (value.except.length === 0) errors.zone = 'Choisissez au moins un pays qui ne verra pas ce produit, ou repassez à « Monde entier ».';
    else if (value.except.length > ZONE_EXCEPT_LIMIT) errors.zone = `${ZONE_EXCEPT_LIMIT} pays exclus au plus.`;
  }
  return { errors, value };
}

/** Vrai si un client situé dans `country` (code ISO) voit le produit. Pays inconnu : seul « monde entier » s'affiche à coup sûr. */
export function zoneAllows(zone, country) {
  const z = zoneOf(zone);
  const c = String(country ?? '').toUpperCase();
  if (z.mode === 'all') return true;
  if (z.mode === 'sn') return c === HOME_COUNTRY;
  return !z.except.includes(c);
}

export function zoneLabel(zone, short) {
  const z = zoneOf(zone);
  if (z.mode === 'all') return 'Monde entier';
  if (z.mode === 'sn') return 'Sénégal uniquement';
  if (short) return z.except.length === 1 ? `Sauf ${countryName(z.except[0])}` : `Sauf ${z.except.length} pays`;
  return `Monde entier sauf ${z.except.map(countryName).join(', ')}`;
}

export const PACK_UNITS = ['kg', 'g', 'piece'];
export const PACK_AUDIENCES = ['tous', 'particuliers', 'pros'];
export const PACK_LIMIT = 12;
export const PACK_DESCRIPTION_MAX = 200;

const num3 = (n) => {
  const [whole, rest] = String(Math.round(n * 1000) / 1000).split('.');
  return `${group(whole)}${rest ? `,${rest}` : ''}`;
};
const hasQty = (p) => p?.qty !== null && p?.qty !== undefined && Number.isFinite(Number(p.qty)) && Number(p.qty) > 0;

/**
 * Un emballage se décrit en deux temps, à ne pas confondre :
 *  - son CONTENU (`qty` + `unit`) : ce qu'il y a dans UN emballage — 4 kg, 500 g, 6 pièces ;
 *  - le NOMBRE d'emballages qu'un client commande (`step`, `min`, `max`) : toujours des
 *    emballages entiers, jamais des kilos.
 */

/** Contenu d'un emballage : « 4 kg », « 500 g », « 6 pièces » — vide si la contenance manque. */
export function packContent(p) {
  return hasQty(p) ? packTotal(p, 1) : '';
}

/** Poids en grammes : ≥ 1 000 g → « 5 kg », « 1,5 kg » (une décimale au plus) ; sinon « 500 g ». */
function gramsText(grams) {
  const g = Math.round(grams);
  if (g < 1000) return `${g} g`;
  const [whole, tenth] = String(Math.round(g / 100) / 10).split('.');
  return `${group(whole)}${tenth ? `,${tenth}` : ''} kg`;
}

/** Contenu de `count` emballages : « 8 kg », « 1,5 kg », « 500 g », « 12 pièces » — vide si la contenance manque. */
export function packTotal(p, count) {
  if (!hasQty(p) || !Number.isFinite(count)) return '';
  const total = Number(p.qty) * count;
  if (p.unit === 'piece') return `${num3(total)} ${total > 1 ? 'pièces' : 'pièce'}`;
  return gramsText(p.unit === 'g' ? total : total * 1000);
}

/** Prix ramené au contenu : « 3,25 € le kg », « 0,50 € la pièce » — vide si prix ou contenance manquent. */
export function packUnitPrice(p) {
  if (!hasQty(p) || !isNum(p?.price) || p.price <= 0) return '';
  const qty = Number(p.qty);
  const per = p.unit === 'g' ? p.price / (qty / 1000) : p.price / qty;
  return `${per.toFixed(2).replace('.', ',')} € ${p.unit === 'piece' ? 'la pièce' : 'le kg'}`;
}

/**
 * Garde-fou : le prix au kilo ou à la pièce est le prix GLOBAL du produit ; celui d'un emballage
 * est le prix de l'emballage entier. Si un emballage de plusieurs kilos (ou pièces) coûte autant
 * ou moins qu'un seul kilo (ou une seule pièce) au prix global, c'est presque toujours le prix
 * unitaire saisi par erreur : on le signale, sans bloquer. Les emballages réservés aux
 * professionnels ne sont pas comparés au prix des particuliers.
 */
export function packPriceAlert(p, retail) {
  if (!hasQty(p) || !isNum(p?.price) || p.price <= 0 || p.audience === 'pros') return '';
  if (!retail || !isNum(retail.price) || retail.price <= 0) return '';
  const byKilo = retail.unit === 'kg' && (p.unit === 'kg' || p.unit === 'g');
  const byPiece = retail.unit === 'unit' && p.unit === 'piece';
  if (!byKilo && !byPiece) return '';
  const content = p.unit === 'g' ? Number(p.qty) / 1000 : Number(p.qty);
  if (content <= 1 || p.price > retail.price) return '';
  const money2 = (n) => `${n.toFixed(2).replace('.', ',')} €`;
  const one = byKilo ? 'un seul kilo' : 'une seule pièce';
  return `${money2(p.price)} pour ${packContent(p)}, c’est ${p.price === retail.price ? 'exactement le prix' : 'moins que le prix'} global d’${one} (${money2(retail.price)}). Saisissez ici le prix de l’emballage entier, soit ${money2(retail.price * content)} à ce tarif.`;
}

/**
 * Règle de quantité d'un emballage, en nombre d'emballages. Sans palier : 1. Sans minimum : un
 * palier. Sans maximum : `null`, aucun maximum n'est fixé (rien n'est supposé à la place).
 */
export function packRange(p) {
  const step = isInt(p?.step) && p.step > 0 ? p.step : 1;
  const min = isInt(p?.min) && p.min > 0 ? p.min : step;
  const max = isInt(p?.max) && p.max >= min ? p.max : null;
  return { step, min, max };
}

const countText = (n) => `${fr(n)} ${n > 1 ? 'emballages' : 'emballage'}`;

/** « De 2 à 10 emballages, par paliers de 2 », « À partir de 1 emballage ». */
export function packRuleText(p) {
  const { step, min, max } = packRange(p);
  const by = step > 1 ? `, par paliers de ${fr(step)}` : '';
  if (max === null) return `À partir de ${countText(min)}${by}`;
  if (max === min) return `${countText(min)}, ni plus ni moins`;
  return `De ${fr(min)} à ${countText(max)}${by}`;
}

export function validatePackagings(input) {
  const errors = {};
  const list = Array.isArray(input) ? input : [];
  if (list.length > PACK_LIMIT) errors.packagings = `${PACK_LIMIT} emballages au plus par produit.`;
  const names = new Set();
  const ids = new Set();
  const value = list.slice(0, PACK_LIMIT).map((raw, i) => {
    const p = raw && typeof raw === 'object' ? raw : {};
    const at = `packagings.${i}`;
    const label = String(p.label ?? '').trim().replace(/\s+/g, ' ');
    if (!label) errors[`${at}.label`] = 'Donnez un nom à cet emballage, par exemple « Carton de 4 kg ».';
    else if (label.length > 40) errors[`${at}.label`] = 'Nom de l’emballage : 40 caractères au plus.';
    else if (names.has(label.toLowerCase())) errors[`${at}.label`] = `Deux emballages portent le même nom : « ${label} ».`;
    names.add(label.toLowerCase());

    // Contenu d'UN emballage.
    const unit = PACK_UNITS.includes(p.unit) ? p.unit : 'kg';
    let qty = null;
    if (empty(p.qty)) {
      errors[`${at}.qty`] = 'Indiquez ce que contient cet emballage, par exemple 4 kg : sans contenu, son prix ne veut rien dire.';
    } else {
      if (!isNum(p.qty)) errors[`${at}.qty`] = 'Contenu : saisissez un nombre, par exemple 4.';
      else if (p.qty <= 0) errors[`${at}.qty`] = 'Contenu : un nombre supérieur à zéro.';
      else if (p.qty > 100000) errors[`${at}.qty`] = 'Contenu : valeur trop grande. Vérifiez la saisie.';
      else if (unit === 'piece' && !Number.isInteger(p.qty)) errors[`${at}.qty`] = 'Contenu en pièces : un nombre entier.';
      else qty = Math.round(p.qty * 1000) / 1000;
    }
    const price = money(p.price, `${at}.price`, errors, 'Prix d’un emballage', LIMITS.retailPrice);
    // Photo de l'emballage : celle de tous les pays, sauf ceux qui ont la leur.
    const photoOf = (v, path) => {
      if (empty(v)) return null;
      const url = str(v).trim();
      if (!/^https:\/\/\S+$/.test(url) || url.length > 500) {
        errors[path] = 'Photo invalide : choisissez-la depuis cette page.';
        return null;
      }
      return url;
    };
    const photo_url = photoOf(p.photo_url, `${at}.photo_url`);
    // Description de l'emballage : la phrase que le client lit quand il choisit ce format. Facultative.
    const description = String(p.description ?? '').trim().replace(/\s+/g, ' ');
    if (description.length > PACK_DESCRIPTION_MAX) errors[`${at}.description`] = `Description de l’emballage : ${PACK_DESCRIPTION_MAX} caractères au plus.`;

    // Réglages par pays : proposé ou non ; au prix d'origine, ou à un prix propre à ces pays.
    const ruleList = Array.isArray(p.countryRules) ? p.countryRules : [];
    if (ruleList.length > COUNTRY_PRICE_LIMIT) errors[`${at}.countryRules`] = `${COUNTRY_PRICE_LIMIT} réglages par pays au plus.`;
    const taken = new Set();
    const countryRules = ruleList.slice(0, COUNTRY_PRICE_LIMIT).map((g, j) => {
      const base = `${at}.countryRules.${j}`;
      const countries = groupCountries(g?.countries, base, errors, taken, 'réglage');
      const available = g?.available !== false;
      // `own` : « prix propre » choisi à l'écran — le prix est alors obligatoire. Sinon : prix d'origine.
      const own = available && (g?.own === true || (g?.own === undefined && !empty(g?.price)));
      const own_price = own ? money(g?.price, `${base}.price`, errors, 'Prix de l’emballage dans ces pays', LIMITS.retailPrice) : null;
      if (own && own_price === null && !errors[`${base}.price`]) {
        errors[`${base}.price`] = 'Indiquez le prix de cet emballage dans ces pays, ou choisissez « Prix d’origine ».';
      }
      // Photo : la même que l'emballage d'origine, ou une photo propre à ces pays (alors obligatoire).
      const ownPhoto = available && (g?.ownPhoto === true || (g?.ownPhoto === undefined && !empty(g?.photo_url)));
      const own_photo = ownPhoto ? photoOf(g?.photo_url, `${base}.photo_url`) : null;
      if (ownPhoto && own_photo === null && !errors[`${base}.photo_url`]) {
        errors[`${base}.photo_url`] = 'Ajoutez la photo de l’emballage pour ces pays, ou choisissez « Même photo ».';
      }
      return { countries, available, price: own_price, photo_url: own_photo };
    });

    // Nombre d'emballages commandés : des emballages entiers.
    const count = (v, key, name) => {
      if (empty(v)) return null;
      if (!isInt(v) || v < 1) {
        errors[`${at}.${key}`] = `${name} : un nombre entier d’emballages, 1 au moins. Il ne se compte pas en kilos.`;
        return null;
      }
      if (v > 100000) {
        errors[`${at}.${key}`] = `${name} : valeur trop grande. Vérifiez la saisie.`;
        return null;
      }
      return v;
    };
    const step = count(p.step, 'step', 'Palier') ?? 1;
    const min = count(p.min, 'min', 'Minimum');
    const max = count(p.max, 'max', 'Maximum');
    const clean = !errors[`${at}.step`] && !errors[`${at}.min`] && !errors[`${at}.max`];
    const low = min ?? step;
    if (clean && min !== null && min % step !== 0) {
      errors[`${at}.min`] = `Le minimum (${fr(min)}) doit être un multiple du palier (${fr(step)}) : sinon aucune quantité ne tombe juste.`;
    } else if (clean && max !== null && max < low) {
      errors[`${at}.max`] = `Le maximum (${fr(max)}) est inférieur au minimum (${fr(low)}).`;
    } else if (clean && max !== null && (max - low) % step !== 0) {
      const under = max - ((max - low) % step);
      errors[`${at}.max`] = `Avec un palier de ${fr(step)}, le maximum (${fr(max)}) ne tombe pas juste : choisissez ${fr(under)} ou ${fr(under + step)}.`;
    }

    let id = slugify(String(p.id || label)) || `emballage-${i + 1}`;
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    return {
      id,
      label,
      qty,
      unit,
      price,
      step,
      min,
      max,
      audience: PACK_AUDIENCES.includes(p.audience) ? p.audience : 'tous',
      available: p.available !== false,
      photo_url,
      description,
      // La clé n'existe que s'il y a des réglages par pays.
      ...(countryRules.length > 0 ? { countryRules } : null),
    };
  });
  return { errors, value };
}

// ───────────── Libellé de l'unité de vente
/** « le kg », « kg », « au kilo » : un libellé qui parle de kilos. */
export const isKiloLabel = (label) => /^(?:(?:le|au|par|du)\s+)?(?:kg|kilos?|kilogrammes?)\.?$/i.test(String(label ?? '').trim());
/** Libellé d'une vente à la pièce d'après le nom de l'unité : « la pièce », « par sachet ». */
export const pieceLabel = (noun) => {
  const n = String(noun ?? '').trim();
  return !n || /^pi[eè]ces?$/i.test(n) ? 'la pièce' : `par ${n}`;
};

function money(v, path, errors, label, max) {
  if (empty(v)) return null;
  if (!isNum(v)) {
    errors[path] = `${label} : saisissez un nombre, par exemple 3,50.`;
    return null;
  }
  if (v < 0) {
    errors[path] = `${label} : un prix ne peut pas être négatif.`;
    return null;
  }
  if (v === 0) {
    errors[path] = `${label} : 0 € n’est pas un prix. Laissez le champ vide tant que le prix n’est pas fixé.`;
    return null;
  }
  if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) {
    errors[path] = `${label} : deux décimales au plus (centimes).`;
    return null;
  }
  if (v > max) {
    errors[path] = `${label} : ${fr(v)} € dépasse le plafond de saisie (${fr(max)} €). Vérifiez la virgule.`;
    return null;
  }
  return round2(v);
}

/** Quantité entière strictement positive, facultative. */
function quantity(v, path, errors, label, max, unit) {
  if (empty(v)) return null;
  if (!isNum(v)) {
    errors[path] = `${label} : saisissez un nombre entier.`;
    return null;
  }
  if (v <= 0) {
    errors[path] = `${label} : la valeur doit être supérieure à zéro.`;
    return null;
  }
  if (!isInt(v)) {
    errors[path] =
      unit === 'conteneur'
        ? `${label} : un conteneur ne se divise pas, saisissez un nombre entier.`
        : `${label} : saisissez un nombre entier de kilos.`;
    return null;
  }
  if (v > max) {
    errors[path] = `${label} : ${fr(v)} dépasse le plafond de saisie (${fr(max)}).`;
    return null;
  }
  return v;
}

function validateRetail(input, errors) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object') {
    errors['retail.price'] = 'Offre particuliers illisible.';
    return null;
  }
  const unit = input.unit === 'unit' ? 'unit' : 'kg';
  const out = {
    price: money(input.price, 'retail.price', errors, 'Prix particulier', LIMITS.retailPrice),
    unit,
    unitLabel: str(input.unitLabel).trim(),
    noun: ['kg', 'kg'],
    step: 0,
  };
  if (!out.unitLabel) {
    errors['retail.unitLabel'] =
      'Indiquez le libellé de l’unité : « le kg », « la pièce », « la barquette de 250 g »…';
  } else if (out.unitLabel.length > 40) {
    errors['retail.unitLabel'] = 'Libellé trop long : 40 caractères au plus.';
  }
  if (unit === 'unit') {
    const one = str(input.noun?.[0]).trim();
    const many = str(input.noun?.[1]).trim();
    if (!one) errors['retail.noun.0'] = 'Nom de l’unité au singulier : « pièce », « botte »…';
    if (!many) errors['retail.noun.1'] = 'Nom de l’unité au pluriel : « pièces », « bottes »…';
    if (one.length > 24) errors['retail.noun.0'] = '24 caractères au plus.';
    if (many.length > 24) errors['retail.noun.1'] = '24 caractères au plus.';
    out.noun = [one, many];
    // Vendu à la pièce : le libellé ne peut pas parler de kilos (« le kg »). Il est remis d'aplomb.
    if (isKiloLabel(out.unitLabel)) out.unitLabel = pieceLabel(one);
  }

  const step = input.step;
  if (empty(step)) {
    errors['retail.step'] = 'Indiquez le palier de quantité (par exemple 0,5 kg ou 1 pièce).';
  } else if (!isNum(step) || step <= 0) {
    errors['retail.step'] = 'Palier : saisissez un nombre supérieur à zéro.';
  } else if (unit === 'unit' && !isInt(step)) {
    errors['retail.step'] = 'Palier : un produit vendu à l’unité se commande par unités entières.';
  } else if (unit === 'kg' && Math.abs(step * 1000 - Math.round(step * 1000)) > 1e-6) {
    errors['retail.step'] = 'Palier : au gramme près au plus (trois décimales).';
  } else if (step > 1000) {
    errors['retail.step'] = 'Palier : valeur trop grande pour une vente aux particuliers.';
  } else {
    out.step = step;
  }

  for (const key of ['min', 'max']) {
    const v = input[key];
    if (empty(v)) continue;
    const label = key === 'min' ? 'Quantité minimale' : 'Quantité maximale';
    if (!isNum(v) || v <= 0) errors[`retail.${key}`] = `${label} : nombre supérieur à zéro.`;
    else if (unit === 'unit' && !isInt(v)) errors[`retail.${key}`] = `${label} : nombre entier.`;
    else if (v > 100000) errors[`retail.${key}`] = `${label} : valeur trop grande.`;
    else out[key] = v;
  }
  // L'application applique « un palier » et « vingt paliers » quand ces bornes sont absentes.
  const effMin = out.min ?? out.step;
  const effMax = out.max ?? out.step * 20;
  if (out.step > 0 && effMin > effMax && !errors['retail.min'] && !errors['retail.max']) {
    errors[out.max ? 'retail.max' : 'retail.min'] =
      `La quantité minimale (${fr(effMin)}) dépasse la quantité maximale (${fr(effMax)}).`;
  }
  // Prix par pays : la clé n'existe que s'il y en a.
  const byCountry = validateRetailCountryPrices(input.countryPrices, errors);
  if (byCountry.length > 0) out.countryPrices = byCountry;
  return out;
}

function validateOffer(input, i, errors, rules) {
  const base = `wholesale.${i}`;
  if (!input || typeof input !== 'object') {
    errors[`${base}.mode`] = 'Offre illisible.';
    return null;
  }
  if (input.mode != null && input.mode !== 'avion' && input.mode !== 'bateau') {
    errors[`${base}.mode`] = 'Mode de transport inconnu : avion, bateau, ou offre sans mode.';
    return null;
  }
  const mode = input.mode ?? null;
  const name = modeLabel(mode).toLowerCase();
  const perContainer = input.priceUnit === 'conteneur';
  if (perContainer && mode !== 'bateau') {
    errors[`${base}.priceUnit`] = 'Un prix au conteneur n’existe que pour une offre par bateau.';
  }
  const priceMax = perContainer ? LIMITS.containerPrice : LIMITS.kgPrice;
  const out = {
    mode,
    available: input.available !== false,
    prices: {
      EXW: money(input.prices?.EXW, `${base}.prices.EXW`, errors, `Prix EXW ${name}`, priceMax),
      FOB: money(input.prices?.FOB, `${base}.prices.FOB`, errors, `Prix FOB ${name}`, priceMax),
    },
    priceUnit: perContainer && mode === 'bateau' ? 'conteneur' : 'kg',
  };
  if (out.prices.EXW !== null && out.prices.FOB !== null && out.prices.FOB < out.prices.EXW) {
    errors[`${base}.prices.FOB`] =
      `Prix incohérents : le FOB (${fr(out.prices.FOB)} €, marchandise chargée au port) est inférieur à l’EXW (${fr(out.prices.EXW)} €, départ entrepôt).`;
  }
  const byCountry = validateOfferCountryPrices(input.countryPrices, base, errors, out.prices, priceMax, name);
  if (byCountry.length > 0) out.countryPrices = byCountry;

  const sea = mode === 'bateau';
  const unit = sea ? 'conteneur' : 'kg';
  const qMax = sea ? LIMITS.containers : LIMITS.qtyKg;
  const min = quantity(input.minQty, `${base}.minQty`, errors, 'Minimum', qMax, unit);
  const step = quantity(input.stepQty, `${base}.stepQty`, errors, 'Palier', qMax, unit);
  const max = quantity(input.maxQty, `${base}.maxQty`, errors, 'Maximum', qMax, unit);
  if (min) out.minQty = min;
  if (step) out.stepQty = step;
  if (max) out.maxQty = max;

  // Valeurs réellement appliquées : celles de l'offre, sinon celles du catalogue.
  const r = sea ? null : mode === 'avion' ? rules.avion : rules.standard;
  const effMin = min ?? (sea ? rules.bateau.minContainers : r.minKg);
  const effStep = step ?? (sea ? rules.bateau.stepContainers : r.stepKg);
  const effMax = max ?? (sea ? rules.bateau.maxContainers : r.maxKg);
  const u = sea ? '' : ' kg';
  if (effMin > effMax && !errors[`${base}.minQty`] && !errors[`${base}.maxQty`]) {
    errors[max ? `${base}.maxQty` : `${base}.minQty`] =
      `Le minimum (${fr(effMin)}${u}) dépasse le maximum (${fr(effMax)}${u}).`;
  }
  // Avion et bateau : seules les quantités multiples du palier sont acceptées par l'application.
  if (mode !== null && effMin % effStep !== 0 && !errors[`${base}.minQty`] && !errors[`${base}.stepQty`]) {
    errors[min ? `${base}.minQty` : `${base}.stepQty`] =
      `Le minimum (${fr(effMin)}${u}) doit être un multiple du palier (${fr(effStep)}${u}) : sinon aucune quantité ne tombe juste.`;
  }

  if (sea && 'containerKg' in input && input.containerKg !== undefined) {
    const kg = input.containerKg;
    if (kg === null) out.containerKg = null;
    else if (!isNum(kg) || kg <= 0) {
      errors[`${base}.containerKg`] = 'Poids du conteneur : nombre de kilos supérieur à zéro.';
    } else if (!isInt(kg)) {
      errors[`${base}.containerKg`] = 'Poids du conteneur : nombre entier de kilos.';
    } else if (kg > LIMITS.containerKg) {
      errors[`${base}.containerKg`] =
        `Poids du conteneur : ${fr(kg)} kg dépasse le plafond de saisie (${fr(LIMITS.containerKg)} kg).`;
    } else out.containerKg = kg;
  }
  return out;
}

/**
 * Contrôle une fiche produit. `errors` associe un champ à son explication ; `value` est la fiche
 * nettoyée, prête à être enregistrée quand `errors` est vide.
 */
export function validateProduct(input, ctx = {}) {
  const errors = {};
  const warnings = [];
  const rules = parseRules(ctx.rules);
  const src = input && typeof input === 'object' ? input : {};

  const id = str(src.id).trim();
  if (ctx.isNew) {
    if (!id) errors.id = 'Indiquez un identifiant (il se remplit tout seul d’après le nom).';
    else if (!SLUG.test(id)) {
      errors.id = 'Identifiant : minuscules, chiffres et tirets uniquement, par exemple « mangue-sechee ».';
    } else if ((ctx.existingIds || []).includes(id)) {
      errors.id = `L’identifiant « ${id} » est déjà utilisé par un autre produit.`;
    }
  }

  const name = str(src.name).trim();
  if (!name) errors.name = 'Le nom du produit est obligatoire.';
  else if (name.length > 80) errors.name = 'Nom trop long : 80 caractères au plus.';

  const variety = str(src.variety).trim();
  if (variety.length > 80) errors.variety = 'Variété : 80 caractères au plus.';
  const origin = str(src.origin).trim();
  if (origin.length > 80) errors.origin = 'Origine : 80 caractères au plus.';
  const description = str(src.description).trim();
  if (description.length > 1200) errors.description = 'Description : 1 200 caractères au plus.';

  const category = str(src.category).trim();
  if (!category) errors.category = 'Choisissez un rayon.';
  else if (ctx.categoryIds && !ctx.categoryIds.includes(category)) {
    errors.category = 'Ce rayon n’existe pas (ou plus). Choisissez-en un autre.';
  }

  const tint = str(src.tint).trim() || DEFAULT_TINT;
  if (!HEX.test(tint)) errors.tint = 'Teinte : une couleur au format #RRGGBB.';

  const rawMonths = Array.isArray(src.months) ? src.months : [];
  if (rawMonths.some((m) => !isInt(m) || m < 1 || m > 12)) {
    errors.months = 'Mois de disponibilité illisibles.';
  }
  const months = [...new Set(rawMonths.filter((m) => isInt(m) && m >= 1 && m <= 12))].sort(
    (a, b) => a - b,
  );

  const available = src.available === true;
  const archived = src.archived === true;
  if (available && !archived && months.length === 0 && !errors.months) {
    errors.months =
      'Indiquez au moins un mois de disponibilité (ou « Toute l’année ») avant de rendre le produit visible : sans cela, l’application le présenterait comme disponible toute l’année.';
  }

  const photoUrl = empty(src.photo_url) ? null : str(src.photo_url).trim();
  if (photoUrl && !/^https:\/\/[^\s]+$/.test(photoUrl)) {
    errors.photo_url = 'Adresse de photo invalide : une adresse https est attendue.';
  }
  const ratio = isNum(src.photo_ratio) && src.photo_ratio >= 0.1 && src.photo_ratio <= 10 ? src.photo_ratio : 1;

  const retail = validateRetail(src.retail, errors);

  const offersIn = Array.isArray(src.wholesale) ? src.wholesale : [];
  if (offersIn.length > 3) errors.wholesale = 'Trois offres au plus : avion, bateau et standard.';
  const seen = new Set();
  const wholesale = [];
  offersIn.slice(0, 3).forEach((o, i) => {
    const offer = validateOffer(o, i, errors, rules);
    if (!offer) return;
    const key = String(offer.mode);
    if (seen.has(key)) {
      errors[`wholesale.${i}.mode`] =
        `Deux offres « ${modeLabel(offer.mode)} » : l’application ne retient que la première. Supprimez-en une.`;
    }
    seen.add(key);
    wholesale.push(offer);
  });

  const rating = isNum(src.rating) && src.rating >= 0 && src.rating <= 5 ? src.rating : 0;
  const reviews = isInt(src.reviews) && src.reviews >= 0 ? src.reviews : 0;

  if (available && !archived) {
    const retailPriced = !!retail && retail.price !== null;
    const proOpen = wholesale.some((o) => o.available);
    if (!retailPriced && !proOpen) {
      warnings.push(
        'Produit visible, mais sans prix particulier ni offre professionnelle ouverte : il n’apparaîtra dans aucun espace de l’application.',
      );
    }
  }

  return {
    errors,
    warnings,
    value: {
      id,
      name,
      variety,
      category,
      origin,
      description,
      photo_asset: empty(src.photo_asset) ? null : str(src.photo_asset),
      photo_url: photoUrl,
      photo_ratio: Math.round(ratio * 1000) / 1000,
      tint: HEX.test(tint) ? tint.toUpperCase() : DEFAULT_TINT,
      months,
      available,
      archived,
      bio: src.bio === true,
      rating,
      reviews,
      retail,
      wholesale,
      is_example: src.is_example === true,
    },
  };
}

export function validateCategory(input, ctx = {}) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};
  const id = str(src.id).trim();
  if (ctx.isNew) {
    if (!id) errors.id = 'Indiquez un identifiant de rayon.';
    else if (!SLUG.test(id)) errors.id = 'Identifiant : minuscules, chiffres et tirets uniquement.';
    else if (['tout', 'saison'].includes(id)) {
      errors.id = '« tout » et « saison » sont des filtres réservés par l’application.';
    } else if ((ctx.existingIds || []).includes(id)) {
      errors.id = `Le rayon « ${id} » existe déjà.`;
    }
  }
  const label = str(src.label).trim();
  if (!label) errors.label = 'Le nom du rayon est obligatoire.';
  else if (label.length > 30) errors.label = 'Nom du rayon : 30 caractères au plus.';
  const imageUrl = empty(src.image_url) ? null : str(src.image_url).trim();
  if (imageUrl && !/^https:\/\/[^\s]+$/.test(imageUrl)) errors.image_url = 'Adresse d’image invalide.';
  const product = empty(src.illustration_product) ? null : str(src.illustration_product);
  if (product && ctx.productIds && !ctx.productIds.includes(product)) {
    errors.illustration_product = 'Le produit choisi pour l’illustration n’existe plus.';
  }
  const ratio = isNum(src.image_ratio) && src.image_ratio >= 0.1 && src.image_ratio <= 10 ? src.image_ratio : 1;
  return {
    errors,
    value: {
      id,
      label,
      image_url: imageUrl,
      image_ratio: Math.round(ratio * 1000) / 1000,
      illustration_product: product,
    },
  };
}

export function validateRules(input) {
  const errors = {};
  const src = input && typeof input === 'object' ? input : {};
  const need = (v, path, label, max, unit) => {
    if (empty(v)) {
      errors[path] = `${label} : valeur obligatoire.`;
      return 0;
    }
    return quantity(v, path, errors, label, max, unit) ?? 0;
  };
  const kg = (key, title) => {
    const s = src[key] || {};
    const out = {
      minKg: need(s.minKg, `${key}.minKg`, 'Minimum', LIMITS.qtyKg, 'kg'),
      stepKg: need(s.stepKg, `${key}.stepKg`, 'Palier', LIMITS.qtyKg, 'kg'),
      maxKg: need(s.maxKg, `${key}.maxKg`, 'Maximum', LIMITS.qtyKg, 'kg'),
    };
    if (out.minKg && out.maxKg && out.minKg > out.maxKg) {
      errors[`${key}.maxKg`] = `${title} : le maximum est inférieur au minimum.`;
    }
    return out;
  };
  const standard = kg('standard', 'Offres sans mode');
  const avion = kg('avion', 'Avion');
  if (avion.minKg && avion.stepKg && avion.minKg % avion.stepKg !== 0) {
    errors['avion.minKg'] = `Avion : le minimum (${fr(avion.minKg)} kg) doit être un multiple du palier (${fr(avion.stepKg)} kg).`;
  }
  const b = src.bateau || {};
  const bateau = {
    minContainers: need(b.minContainers, 'bateau.minContainers', 'Minimum', LIMITS.containers, 'conteneur'),
    stepContainers: need(b.stepContainers, 'bateau.stepContainers', 'Palier', LIMITS.containers, 'conteneur'),
    maxContainers: need(b.maxContainers, 'bateau.maxContainers', 'Maximum', LIMITS.containers, 'conteneur'),
    containerKg: null,
    containerLabel: str(b.containerLabel).trim(),
  };
  if (bateau.minContainers && bateau.maxContainers && bateau.minContainers > bateau.maxContainers) {
    errors['bateau.maxContainers'] = 'Bateau : le maximum est inférieur au minimum.';
  }
  if (bateau.minContainers && bateau.stepContainers && bateau.minContainers % bateau.stepContainers !== 0) {
    errors['bateau.minContainers'] = 'Bateau : le minimum doit être un multiple du palier.';
  }
  if (!empty(b.containerKg)) {
    bateau.containerKg = quantity(b.containerKg, 'bateau.containerKg', errors, 'Poids de référence', LIMITS.containerKg, 'kg');
  }
  if (bateau.containerLabel.length > 30) {
    errors['bateau.containerLabel'] = 'Précision : 30 caractères au plus.';
  }
  return { errors, value: { standard, avion, bateau } };
}

// ───────────── État d'une fiche

/** Ce qu'il manque à une fiche. Calculé sur les données enregistrées, jamais estimé. */
export function completeness(p, ctx = {}) {
  const out = [];
  const embedded = ctx.embeddedAssets || [];
  const rules = parseRules(ctx.rules);
  if (!p.photo_url && !(p.photo_asset && embedded.includes(p.photo_asset))) {
    out.push({ code: 'photo', label: 'Photo à ajouter' });
  }
  if (!str(p.description).trim()) out.push({ code: 'description', label: 'Description à rédiger' });
  if (!str(p.origin).trim()) out.push({ code: 'origine', label: 'Origine à renseigner' });
  if (!Array.isArray(p.months) || p.months.length === 0) {
    out.push({ code: 'saison', label: 'Mois de disponibilité à renseigner' });
  }
  const offers = Array.isArray(p.wholesale) ? p.wholesale : [];
  if (!p.retail && offers.length === 0) {
    out.push({ code: 'prix', label: 'Aucun prix ni offre : produit proposé à personne' });
  } else if (p.retail && positive(p.retail.price) === null) {
    out.push({ code: 'prix', label: 'Prix particulier à fixer' });
  }
  offers.forEach((o) => {
    const missing = INCOTERMS.filter((t) => positive(o.prices?.[t]) === null);
    if (missing.length > 0) {
      out.push({
        code: 'prix-pro',
        label: `Prix ${modeLabel(o.mode).toLowerCase()} à confirmer (${missing.join(' et ')})`,
      });
    }
    if (o.mode === 'bateau' && o.priceUnit !== 'conteneur') {
      const kg = o.containerKg === undefined ? rules.bateau.containerKg : o.containerKg;
      if (!kg) out.push({ code: 'poids', label: 'Poids du conteneur non défini : aucun total calculé' });
    }
  });
  if (ctx.appCategoryIds && !ctx.appCategoryIds.includes(p.category)) {
    out.push({ code: 'rayon', label: 'Rayon inconnu de l’application d’achat' });
  }
  return out;
}
