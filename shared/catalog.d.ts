export type Mode = 'avion' | 'bateau';
export type Incoterm = 'EXW' | 'FOB';
export type PriceUnit = 'kg' | 'conteneur';

export type RetailOffer = {
  price: number | null;
  unit: 'kg' | 'unit';
  unitLabel: string;
  noun: [string, string];
  step: number;
  min?: number;
  max?: number;
  /** Pays qui ont leur propre prix ; partout ailleurs, `price` (le prix global) s'applique. */
  countryPrices?: RetailCountryPrice[];
};

/** Prix particulier propre à un groupe de pays. */
export type RetailCountryPrice = { countries: string[]; price: number | null };
/** Prix professionnels propres à un groupe de pays. Un incoterm vide garde le prix global. */
export type OfferCountryPrice = { countries: string[]; prices: Record<Incoterm, number | null> };

export type WholesaleOffer = {
  mode: Mode | null;
  available: boolean;
  prices: Record<Incoterm, number | null>;
  priceUnit: PriceUnit;
  minQty?: number;
  stepQty?: number;
  maxQty?: number;
  containerKg?: number | null;
  /** Pays qui ont leurs propres prix ; partout ailleurs, `prices` (les prix globaux) s'appliquent. */
  countryPrices?: OfferCountryPrice[];
};

export type QuantityRules = {
  standard: { minKg: number; stepKg: number; maxKg: number };
  avion: { minKg: number; stepKg: number; maxKg: number };
  bateau: {
    minContainers: number;
    stepContainers: number;
    maxContainers: number;
    containerKg: number | null;
    containerLabel: string;
  };
};

/** Ligne de la table `products`. */
export type PackUnit = 'kg' | 'g' | 'piece';
export type PackAudience = 'tous' | 'particuliers' | 'pros';
/**
 * Emballage. `qty` + `unit` : contenu d'UN emballage. `step`, `min`, `max` : nombre d'emballages
 * qu'un client commande (entiers) — `min` vide : un palier ; `max` vide : aucun maximum fixé.
 */
export type Packaging = { id: string; label: string; qty: number | null; unit: PackUnit; price: number | null; currency?: PackCurrency; step: number; min: number | null; max: number | null; audience: PackAudience; available: boolean; photo_url?: string | null; description?: string; countryRules?: PackCountryRule[] };
/** Réglage d'un emballage pour un groupe de pays. `price: null` : prix d'origine. `own` (saisie) : « prix propre » choisi. */
export type PackCurrency = 'EUR' | 'XOF';
export const PACK_CURRENCIES: PackCurrency[];
export type PackCountryRule = { countries: string[]; available: boolean; price: number | null; currency?: PackCurrency; own?: boolean; photo_url?: string | null; ownPhoto?: boolean };
export type PackShape = { qty?: number | null; unit?: PackUnit; price?: number | null; step?: number | null; min?: number | null; max?: number | null };
export function packTotal(p: PackShape, count: number): string;
export function packUnitPrice(p: PackShape): string;
export function packPriceAlert(p: PackShape & { audience?: string }, retail: { price: number | null; unit: 'kg' | 'unit' } | null): string;
export function packRange(p: PackShape | null | undefined): { step: number; min: number; max: number | null };
export function packRuleText(p: PackShape | null | undefined): string;
export function isKiloLabel(label: unknown): boolean;
export function pieceLabel(noun: unknown): string;
export const PACK_UNITS: PackUnit[];
export const PACK_AUDIENCES: PackAudience[];
export const PACK_LIMIT: number;
export const PACK_DESCRIPTION_MAX: number;
export function packContent(p: PackShape): string;
export function validatePackagings(input: unknown): { errors: Errors; value: Packaging[] };
export function packCountryRules(pack: unknown): { countries: string[]; available: boolean; price: number | null; photo_url: string | null }[];
export function packFor<T extends { countryRules?: unknown }>(pack: T, country: string | null | undefined): Omit<T, 'countryRules'> | null;

export type ProductRow = {
  id: string;
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
  rating: number;
  reviews: number;
  retail: RetailOffer | null;
  wholesale: WholesaleOffer[];
  is_example: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  /** Emballages proposés (carton, barquette, sachet…). Enregistrés avec la fiche. */
  packagings?: Packaging[];
  /** Pays où le produit s'affiche. Enregistré avec la fiche, rangé dans la table `zones`. */
  zone: Zone;
};

/** Saisie d'une fiche : les nombres peuvent être absents (`null`) ou illisibles (`NaN`). */
export type ProductInput = Omit<
  ProductRow,
  'sort_order' | 'created_at' | 'updated_at' | 'updated_by' | 'retail' | 'wholesale'
> & {
  retail: (Omit<RetailOffer, 'price' | 'step' | 'min' | 'max'> & {
    price: number | null;
    step: number | null;
    min?: number | null;
    max?: number | null;
  }) | null;
  wholesale: (Omit<WholesaleOffer, 'minQty' | 'stepQty' | 'maxQty'> & {
    minQty?: number | null;
    stepQty?: number | null;
    maxQty?: number | null;
  })[];
};

export type CategoryRow = {
  id: string;
  label: string;
  illustration_product: string | null;
  image_url: string | null;
  image_ratio: number;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
  /** Faux : les grossistes et importateurs ne voient pas les produits de ce rayon. */
  pro_visible?: boolean;
};

export type CatalogProduct = {
  id: string;
  name: string;
  variety: string;
  category: string;
  origin: string;
  description: string;
  photo: { asset: string } | { url: string };
  tint: string;
  months: number[];
  available: boolean;
  bio: boolean;
  rating: number;
  reviews: number;
  retail: RetailOffer | null;
  wholesale: WholesaleOffer[];
};

export type CatalogDocument = {
  schema: 1;
  updatedAt: string;
  example: boolean;
  rules: QuantityRules;
  products: CatalogProduct[];
  categories?: { id: string; label: string; pro?: boolean; illustration: unknown }[];
};

export type Orderable = {
  unit: 'kg' | 'unit';
  noun: [string, string];
  step: number;
  min: number;
  max: number;
  strictStep: boolean;
  mode: Mode | null;
  price: number;
  noPrice: boolean;
  missing: 'prix' | 'poids' | null;
  shownPrice: number | null;
  shownUnit: string;
  containerKg: number | null;
};

export type Errors = Record<string, string>;
export type Issue = { code: string; label: string };

export const SCHEMA_VERSION: 1;
export const DEFAULT_TINT: string;
export const ALL_MONTHS: number[];
export const INCOTERMS: Incoterm[];
export const LIMITS: Record<string, number>;
export const DEFAULT_RULES: QuantityRules;
export const MODE_LABEL: Record<'avion' | 'bateau' | 'standard', string>;
export function modeLabel(mode: Mode | null | undefined): string;
export function slugify(value: string): string;
export function parseRules(raw: unknown): QuantityRules;
export function parseCatalog(raw: unknown): CatalogDocument | null;
export function resolveOffer(offer: WholesaleOffer, rules: QuantityRules, incoterm: Incoterm): Orderable;
export function lineTotal(line: Pick<Orderable, 'price' | 'noPrice'>, qty: number): number | null;
export function productToDoc(row: ProductRow): CatalogProduct;
export function buildDocument(input: {
  products: ProductRow[];
  categories: CategoryRow[];
  rules: unknown;
  updatedAt?: string;
  proHidden?: string[];
}): CatalogDocument;
export function validateProduct(
  input: unknown,
  ctx?: { isNew?: boolean; existingIds?: string[]; categoryIds?: string[]; rules?: unknown },
): { errors: Errors; warnings: string[]; value: Omit<ProductRow, 'sort_order' | 'created_at' | 'updated_at' | 'updated_by'> };
export function validateCategory(
  input: unknown,
  ctx?: { isNew?: boolean; existingIds?: string[]; productIds?: string[] },
): { errors: Errors; value: Pick<CategoryRow, 'id' | 'label' | 'image_url' | 'image_ratio' | 'illustration_product'> };
export function validateRules(input: unknown): { errors: Errors; value: QuantityRules };
export function completeness(
  product: ProductRow,
  ctx?: { embeddedAssets?: string[]; appCategoryIds?: string[]; rules?: unknown },
): Issue[];

export type ZoneMode = 'all' | 'sn' | 'except';
export type Zone = { mode: ZoneMode; except: string[] };
export const COUNTRY_CODES: string[];
export const HOME_COUNTRY: string;
export const ZONE_MODES: ZoneMode[];
export const ZONE_EXCEPT_LIMIT: number;
export const DEFAULT_ZONE: Zone;
export function countryName(code: string): string;
export function isCountryCode(code: unknown): boolean;
export function zoneOf(raw: unknown): Zone;
export function validateZone(input: unknown): { errors: Errors; value: Zone };
export function zoneAllows(zone: unknown, country: string | null | undefined): boolean;
export const COUNTRY_PRICE_LIMIT: number;
export function retailCountryPrices(retail: unknown): { countries: string[]; price: number }[];
export function offerCountryPrices(offer: unknown): { countries: string[]; prices: Record<Incoterm, number | null> }[];
export function retailPriceFor(retail: { price: number | null; countryPrices?: unknown } | null, country: string | null | undefined): number | null;
export function offerPricesFor(offer: { prices?: Partial<Record<Incoterm, number | null>>; countryPrices?: unknown }, country: string | null | undefined): Record<Incoterm, number | null>;
export function pricedCountries(list: unknown): string[];
export function globalScope(list: unknown): string;
export function zoneLabel(zone: unknown, short?: boolean): string;
