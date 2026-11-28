import type { Product, ProTerms } from '../contexts/DataContext';
import { emptyPro, PRO_GROUP_IDS, type ProMedia, type ProMode, type ProSheet, type ProStatus } from '../../shared/pro.js';
import type { ExceptionForm, OfferForm } from '../components/pro/ProOffers';

/** Saisie d'une fiche pro : identité du produit + fiche pro, les nombres en texte tant qu'on tape. */
export type ProForm = {
  id: string;
  idTouched: boolean;
  name: string;
  variety: string;
  origin: string;
  description: string;
  category: string;
  tint: string;
  months: number[];
  available: boolean;
  archived: boolean;
  photo_url: string | null;
  photo_asset: string | null;
  photo_ratio: number;
  is_example: boolean;
  status: ProStatus;
  start: string;
  end: string;
  volumeAmount: string;
  volumeUnit: 'tonnes' | 'conteneurs';
  varieties: string[];
  calibres: string[];
  packaging: string;
  quality: string;
  offers: OfferForm[];
  countriesMode: 'all' | 'pays' | 'sauf';
  countriesList: string[];
  port: string;
  airport: string;
  station: string;
  terms: string;
  globalgap: boolean;
  media: ProMedia[];
  programmes: boolean;
};

const t = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
const key = () => Math.random().toString(36).slice(2, 10);

export function toProForm(p: Product | null, defaults: ProTerms | null): ProForm {
  const pro: ProSheet = p?.pro ?? emptyPro(defaults ?? undefined);
  return {
    id: p?.id ?? '',
    idTouched: false,
    name: p?.name ?? '',
    variety: p?.variety ?? '',
    origin: p?.origin ?? '',
    description: p?.description ?? '',
    category: p?.category ?? '',
    tint: p?.tint ?? '#7AAA2C',
    months: p?.months ?? [],
    available: p?.available ?? false,
    archived: p?.archived ?? false,
    photo_url: p?.photo_url ?? null,
    photo_asset: p?.photo_asset ?? null,
    photo_ratio: p?.photo_ratio ?? 1,
    is_example: p?.is_example ?? false,
    status: pro.status,
    start: pro.campaign.start ?? '',
    end: pro.campaign.end ?? '',
    volumeAmount: pro.volume ? t(pro.volume.amount) : '',
    volumeUnit: pro.volume?.unit ?? 'tonnes',
    varieties: pro.varieties,
    calibres: pro.calibres,
    packaging: pro.packaging,
    quality: pro.quality,
    offers: pro.offers.map((o) => ({
      key: key(),
      mode: o.mode as ProMode,
      active: o.active !== false,
      min: t(o.min),
      step: t(o.step),
      max: t(o.max),
      groups: Object.fromEntries(PRO_GROUP_IDS.map((g) => [g, { offered: !!o.groups?.[g]?.offered, EXW: t(o.groups?.[g]?.EXW), FOB: t(o.groups?.[g]?.FOB) }])) as OfferForm['groups'],
      exceptions: (o.exceptions ?? []).map((x): ExceptionForm => ({ key: key(), countries: x.countries, offered: x.offered !== false, EXW: t(x.EXW), FOB: t(x.FOB) })),
    })),
    countriesMode: pro.countries.mode,
    countriesList: pro.countries.list,
    port: pro.logistics.port,
    airport: pro.logistics.airport,
    station: pro.logistics.station,
    terms: pro.terms,
    globalgap: pro.globalgap,
    media: pro.media,
    programmes: pro.programmes,
  };
}

/** Fiche pro brute (nombres en texte), telle que la lit `validatePro`. */
export function proInputOf(f: ProForm) {
  return {
    status: f.status,
    campaign: { start: f.start || null, end: f.end || null },
    volume: f.volumeAmount.trim() ? { amount: f.volumeAmount.trim(), unit: f.volumeUnit } : null,
    varieties: f.varieties,
    calibres: f.calibres,
    packaging: f.packaging,
    quality: f.quality,
    offers: f.offers.map((o) => ({
      mode: o.mode,
      active: o.active,
      min: o.min,
      step: o.step,
      max: o.max,
      groups: o.groups,
      exceptions: o.exceptions.map(({ key: _k, ...x }) => x),
    })),
    countries: { mode: f.countriesMode, list: f.countriesList },
    logistics: { port: f.port, airport: f.airport, station: f.station },
    terms: f.terms,
    globalgap: f.globalgap,
    media: f.media,
    programmes: f.programmes,
  };
}

/** Identité du produit (colonnes de la table), pour `validateProduct`. */
export function identityOf(f: ProForm) {
  return {
    id: f.id.trim(),
    name: f.name,
    variety: f.variety,
    origin: f.origin,
    description: f.description,
    category: f.category,
    tint: f.tint,
    months: f.months,
    available: f.available,
    archived: f.archived,
    photo_url: f.photo_url,
    photo_asset: f.photo_asset,
    photo_ratio: f.photo_ratio,
    bio: false,
    rating: 0,
    reviews: 0,
    is_example: f.is_example,
    retail: null,
    wholesale: [],
  };
}
