import type { Mode, PriceUnit, ProductInput, WholesaleOffer, PackAudience, PackUnit, Packaging, ZoneMode } from '../../shared/catalog.js';
import { isKiloLabel, pieceLabel } from '../../shared/catalog.js';
import type { Product } from '../contexts/DataContext';
import { numStr, parseNum } from './format';

/**
 * État du formulaire d'une fiche. Les nombres y restent du texte, tel que saisi (« 3,5 ») : ils
 * ne sont lus qu'au moment du contrôle, pour pouvoir dire précisément ce qui ne va pas.
 */
/** Prix propre à un groupe de pays, pour les particuliers. Partout ailleurs : le prix global. */
export type RetailGroupForm = { key: string; countries: string[]; price: string };
/** Prix propres à un groupe de pays, pour une offre professionnelle. */
export type OfferGroupForm = { key: string; countries: string[]; exw: string; fob: string };

export type OfferForm = {
  key: string;
  mode: Mode | null;
  available: boolean;
  exw: string;
  fob: string;
  priceUnit: PriceUnit;
  /** Vrai : l'offre a ses propres minimum, palier et maximum. Faux : règles du catalogue. */
  custom: boolean;
  minQty: string;
  stepQty: string;
  maxQty: string;
  /** Bateau — poids du conteneur : référence du catalogue, valeur propre, ou non défini. */
  container: 'ref' | 'custom' | 'none';
  containerKg: string;
  /** Pays qui ont leurs propres prix pour cette offre. */
  countryPrices: OfferGroupForm[];
};

export type PackForm = {
  key: string;
  id: string;
  label: string;
  qty: string;
  unit: PackUnit;
  /** Prix de l'emballage entier par devise ; vide = non vendu dans cette zone. */
  prices: { XOF: string; EUR: string; USD: string };
  /** Nombre d'emballages commandés : palier, minimum, maximum (en emballages entiers). */
  step: string;
  min: string;
  max: string;
  audience: PackAudience;
  available: boolean;
  /** Photo de l'emballage (adresse), ou chaîne vide. */
  photo: string;
  /** Phrase affichée au client quand il choisit cet emballage. Facultative. */
  description: string;
  /** Photo du produit dans l'emballage (grand aperçu de la fiche), ou chaîne vide. */
  preview: string;
  /** Pays : toutes les zones avec un prix, seulement ces pays, ou sauf ces pays. */
  countries: { mode: 'zone' | 'pays' | 'sauf'; list: string[] };
  /** Emballage sélectionné à l'ouverture de la fiche. */
  isDefault: boolean;
};

export type Form = {
  id: string;
  idTouched: boolean;
  name: string;
  variety: string;
  category: string;
  origin: string;
  description: string;
  photo_asset: string | null;
  photo_url: string | null;
  photo_ratio: number;
  tint: string;
  months: number[];
  available: boolean;
  archived: boolean;
  bio: boolean;
  /** Particuliers : 'emballe' (vendu par ses emballages) ou 'frais' (au kilo ou à la pièce). */
  kind: 'emballe' | 'frais';
  /** Frais : proposé aux particuliers. Désactivé, les prix restent enregistrés. */
  sold: boolean;
  price: string;
  unit: 'kg' | 'unit';
  unitLabel: string;
  nounOne: string;
  nounMany: string;
  step: string;
  min: string;
  max: string;
  /** Pays qui ont leur propre prix particulier. */
  countryPrices: RetailGroupForm[];
  offers: OfferForm[];
  packs: PackForm[];
  rating: number;
  reviews: number;
  is_example: boolean;
  /** Pays où le produit s'affiche : monde entier, Sénégal uniquement, ou monde entier sauf… */
  zoneMode: ZoneMode;
  zoneExcept: string[];
};

let sequence = 0;

export const newPack = (): PackForm => ({ key: `emballage-${++sequence}`, id: '', label: '', qty: '', unit: 'g', prices: { XOF: '', EUR: '', USD: '' }, step: '1', min: '', max: '', audience: 'tous', available: true, photo: '', preview: '', description: '', countries: { mode: 'zone', list: [] }, isDefault: false });

/** Emballage tel qu'il sera envoyé (et tel que l'aperçu client le montre pendant la saisie). */
export const packInput = (k: PackForm): Packaging => ({
  id: k.id || k.key,
  label: k.label,
  qty: parseNum(k.qty),
  unit: k.unit,
  prices: { XOF: parseNum(k.prices.XOF), EUR: parseNum(k.prices.EUR), USD: parseNum(k.prices.USD) },
  price: parseNum(k.prices.EUR),
  // Palier laissé vide : 1 emballage. Minimum et maximum vides : non fixés.
  step: parseNum(k.step) ?? 1,
  min: parseNum(k.min),
  max: parseNum(k.max),
  audience: k.audience,
  available: k.available,
  photo_url: k.photo || null,
  preview_url: k.preview || null,
  description: k.description,
  countries: { mode: k.countries.mode, list: k.countries.mode === 'zone' ? [] : k.countries.list },
  is_default: k.isDefault,
});


export const newOffer = (mode: Mode | null): OfferForm => ({
  key: `offre-${++sequence}`,
  mode,
  available: true,
  exw: '',
  fob: '',
  priceUnit: 'kg',
  custom: false,
  minQty: '',
  stepQty: '',
  maxQty: '',
  container: 'ref',
  containerKg: '',
  countryPrices: [],
});

export const newRetailGroup = (): RetailGroupForm => ({ key: `prix-pays-${++sequence}`, countries: [], price: '' });
export const newOfferGroup = (): OfferGroupForm => ({ key: `prix-pays-${++sequence}`, countries: [], exw: '', fob: '' });

function offerToForm(o: WholesaleOffer): OfferForm {
  return {
    key: `offre-${++sequence}`,
    mode: o.mode,
    available: o.available,
    exw: numStr(o.prices?.EXW),
    fob: numStr(o.prices?.FOB),
    priceUnit: o.mode === 'bateau' && o.priceUnit === 'conteneur' ? 'conteneur' : 'kg',
    custom: o.minQty !== undefined || o.stepQty !== undefined || o.maxQty !== undefined,
    minQty: numStr(o.minQty),
    stepQty: numStr(o.stepQty),
    maxQty: numStr(o.maxQty),
    container: o.mode !== 'bateau' || o.containerKg === undefined ? 'ref' : o.containerKg === null ? 'none' : 'custom',
    containerKg: numStr(o.containerKg),
    countryPrices: (o.countryPrices ?? []).map((g) => ({ key: `prix-pays-${++sequence}`, countries: [...g.countries], exw: numStr(g.prices?.EXW), fob: numStr(g.prices?.FOB) })),
  };
}

export function toForm(p: Product | null, category: string): Form {
  const r = p?.retail ?? null;
  return {
    id: p?.id ?? '',
    idTouched: false,
    name: p?.name ?? '',
    variety: p?.variety ?? '',
    category: p?.category ?? category,
    origin: p?.origin ?? '',
    description: p?.description ?? '',
    photo_asset: p?.photo_asset ?? null,
    photo_url: p?.photo_url ?? null,
    photo_ratio: p?.photo_ratio ?? 1,
    tint: p?.tint ?? '#7AAA2C',
    months: [...(p?.months ?? [])].sort((a, b) => a - b),
    // Un nouveau produit naît masqué : il devient visible quand sa fiche est prête.
    available: p?.available ?? false,
    archived: p?.archived ?? false,
    bio: p?.bio ?? false,
    kind: r?.kind === 'emballe' ? 'emballe' : 'frais',
    sold: !!r && r.active !== false,
    price: numStr(r?.price),
    unit: r?.unit ?? 'kg',
    // Une vente à la pièce ne porte jamais le libellé « le kg ».
    unitLabel: r?.unit === 'unit' && isKiloLabel(r.unitLabel) ? pieceLabel(r.noun[0]) : (r?.unitLabel ?? 'le kg'),
    nounOne: r?.unit === 'unit' ? r.noun[0] : '',
    nounMany: r?.unit === 'unit' ? r.noun[1] : '',
    step: numStr(r?.step ?? 0.5),
    min: numStr(r?.min),
    max: numStr(r?.max),
    countryPrices: (r?.countryPrices ?? []).map((g) => ({ key: `prix-pays-${++sequence}`, countries: [...g.countries], price: numStr(g.price) })),
    offers: (p?.wholesale ?? []).map(offerToForm),
    packs: (p?.packagings ?? []).map((k) => ({
      key: `emballage-${++sequence}`,
      id: k.id,
      label: k.label,
      qty: numStr(k.qty),
      unit: k.unit,
      prices: { XOF: numStr(k.prices?.XOF ?? null), EUR: numStr(k.prices ? (k.prices.EUR ?? null) : k.price), USD: numStr(k.prices?.USD ?? null) },
      step: numStr(k.step ?? 1),
      min: numStr(k.min),
      max: numStr(k.max),
      audience: k.audience,
      available: k.available,
      photo: k.photo_url ?? '',
      preview: k.preview_url ?? '',
      description: k.description ?? '',
      countries: { mode: k.countries?.mode ?? 'zone', list: [...(k.countries?.list ?? [])] },
      isDefault: k.is_default === true,
    })),
    rating: Number(p?.rating) || 0,
    reviews: p?.reviews ?? 0,
    is_example: p?.is_example ?? false,
    zoneMode: p?.zone?.mode ?? 'all',
    zoneExcept: [...(p?.zone?.except ?? [])],
  };
}

type OfferInput = ProductInput['wholesale'][number];

function offerInput(o: OfferForm): OfferInput {
  const out: OfferInput = {
    mode: o.mode,
    available: o.available,
    prices: { EXW: parseNum(o.exw), FOB: parseNum(o.fob) },
    priceUnit: o.mode === 'bateau' ? o.priceUnit : 'kg',
  };
  if (o.custom) {
    out.minQty = parseNum(o.minQty);
    out.stepQty = parseNum(o.stepQty);
    out.maxQty = parseNum(o.maxQty);
  }
  if (o.mode === 'bateau') {
    if (o.container === 'none') out.containerKg = null;
    // « Propre à l'offre » sans valeur : `NaN`, pour que le contrôle réclame le poids.
    else if (o.container === 'custom') out.containerKg = parseNum(o.containerKg) ?? NaN;
  }
  if (o.countryPrices.length > 0) out.countryPrices = o.countryPrices.map((g) => ({ countries: g.countries, prices: { EXW: parseNum(g.exw), FOB: parseNum(g.fob) } }));
  return out;
}

/** Du formulaire à la fiche à contrôler. Une saisie illisible devient `NaN`, signalé ensuite. */
export function toInput(f: Form): ProductInput {
  return {
    id: f.id.trim(),
    name: f.name,
    variety: f.variety,
    category: f.category,
    origin: f.origin,
    description: f.description,
    photo_asset: f.photo_asset,
    photo_url: f.photo_url,
    photo_ratio: f.photo_ratio,
    tint: f.tint,
    months: f.months,
    available: f.available,
    archived: f.archived,
    bio: f.bio,
    rating: f.rating,
    reviews: f.reviews,
    is_example: f.is_example,
    // Les valeurs de l'offre particuliers sont gardées, même emballé ou désactivé : rien n'est effacé.
    retail: f.sold || f.kind === 'emballe' || f.price.trim() !== ''
      ? {
          kind: f.kind,
          active: f.kind === 'emballe' ? true : f.sold,
          price: parseNum(f.price),
          unit: f.unit,
          unitLabel: f.unit === 'kg' ? 'le kg' : f.unitLabel,
          noun: f.unit === 'kg' ? ['kg', 'kg'] : [f.nounOne, f.nounMany],
          step: parseNum(f.step),
          min: parseNum(f.min),
          max: parseNum(f.max),
          ...(f.countryPrices.length > 0 ? { countryPrices: f.countryPrices.map((g) => ({ countries: g.countries, price: parseNum(g.price) })) } : null),
        }
      : null,
    wholesale: f.offers.map(offerInput),
    packagings: f.packs.map(packInput),
    zone: { mode: f.zoneMode, except: f.zoneMode === 'except' ? [...f.zoneExcept].sort() : [] },
  };
}

const positive = (s: string) => {
  const n = parseNum(s);
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};

/** Offre « propre » pour le calcul en direct : ce qui est illisible est traité comme absent. */
export function offerPreview(o: OfferForm): WholesaleOffer {
  const out: WholesaleOffer = {
    mode: o.mode,
    available: o.available,
    prices: { EXW: positive(o.exw), FOB: positive(o.fob) },
    priceUnit: o.mode === 'bateau' ? o.priceUnit : 'kg',
  };
  if (o.custom) {
    const min = positive(o.minQty);
    const step = positive(o.stepQty);
    const max = positive(o.maxQty);
    if (min) out.minQty = min;
    if (step) out.stepQty = step;
    if (max) out.maxQty = max;
  }
  if (o.mode === 'bateau') {
    if (o.container === 'none') out.containerKg = null;
    else if (o.container === 'custom') out.containerKg = positive(o.containerKg);
  }
  return out;
}
