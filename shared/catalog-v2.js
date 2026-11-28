/**
 * Catalogue publié, version 2 — AU FORMAT DE L'APPLICATION D'ACHAT.
 *
 * `GET /api/catalog?v=2` renvoie exactement les types de `lib/catalog/schema.ts` de l'application
 * (dépôt Test-app-tropicaura) : `formats` au lieu de `packagings`, `visibility` au lieu de
 * `countries`, `campaigns` au format de l'application, `delivery.gp`. Les écrans de l'application
 * n'ont donc rien à traduire. Clés en plus, qu'une application plus ancienne ignore :
 * `categories`, `filters`, `payments`, `productRequest`, et `countryPrices` (dans `retail` et dans
 * chaque offre `wholesale`).
 *
 * `schema: 2` distingue ce document du document historique (`schema: 1`, clés de la tour), que
 * l'application ne sait pas lire correctement : l'application accepte 1 (catalogue embarqué) et 2.
 *
 * Fonction pure : elle part du document v1 déjà calculé par `buildDocument` (avec ou sans pays),
 * sans relire la base.
 */
import { packContent, packRange } from './catalog.js';

export const SCHEMA_V2 = 2;

/** Zone de la tour (`all` | `sn` | `except`) → visibilité de l'application. */
export function visibilityOfZone(zone) {
  if (zone?.mode === 'sn') return { mode: 'pays', countries: ['SN'] };
  if (zone?.mode === 'except') {
    const countries = (Array.isArray(zone.except) ? zone.except : []).map((c) => String(c).toUpperCase());
    return countries.length > 0 ? { mode: 'monde_sauf', countries } : { mode: 'monde', countries: [] };
  }
  return { mode: 'monde', countries: [] };
}

const pluralWord = (w) => (/[sxz]$/.test(w) ? w : /(au|eu)$/.test(w) ? `${w}x` : `${w}s`);

/**
 * Nom d'unité d'un emballage, d'après son libellé, sans ce qui suit « de » (son contenu) :
 * « Sachet » → ['sachet', 'sachets'] ; « Box » → ['box', 'box'] ; « Carton de 4 kg » →
 * ['carton', 'cartons'] ; « Petit carton » → ['petit carton', 'petits cartons'] ; « Pot en verre
 * de 200 g » → ['pot en verre', 'pots en verre'] (seul le nom avant « en » prend la marque du pluriel).
 */
export function nounOf(label) {
  const head = String(label ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+(?:de|d['’]|du|des)\s*(?=\S)/)[0]
    .replace(/\s*\d.*$/, '')
    .trim();
  if (!head) return ['emballage', 'emballages'];
  const words = head.split(/\s+/);
  const cut = words.findIndex((w, i) => i > 0 && ['en', 'à', 'a', 'pour', 'avec', 'sans'].includes(w));
  const front = cut < 0 ? words : words.slice(0, cut);
  const rest = cut < 0 ? [] : words.slice(cut);
  return [head, [...front.map(pluralWord), ...rest].join(' ')];
}

/** Contenu d'un emballage en grammes (kg et g) ; `null` pour un contenu en pièces ou absent. */
export function gramsOf(pack) {
  const qty = Number(pack?.qty);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (pack.unit === 'kg') return Math.round(qty * 1000);
  if (pack.unit === 'g') return Math.round(qty);
  return null;
}

/** Contenu en pièces, affiché sous le nom de l'emballage (« 6 pièces ») ; vide sinon. */
function pieceDetail(pack) {
  const qty = Number(pack?.qty);
  if (pack?.unit !== 'piece' || !Number.isFinite(qty) || qty <= 0) return '';
  return `${qty} ${qty > 1 ? 'pièces' : 'pièce'}`;
}

const DEFAULT_CURRENCY = 'EUR';

/**
 * Réglage par pays de la tour → réglage de l'application. Sémantique différente sur le prix :
 * tour `price: null` = prix d'origine ; application, clé `price` présente à `null` = « à
 * compléter ». La clé n'est donc posée que pour un prix propre.
 */
function settingOf(rule) {
  const out = { mode: 'pays', countries: rule.countries, available: rule.available !== false };
  if (typeof rule.price === 'number' && rule.price > 0) {
    out.price = rule.price;
    out.currency = rule.currency === 'XOF' ? 'XOF' : DEFAULT_CURRENCY;
  }
  if (rule.photo_url) out.photo = { url: rule.photo_url };
  return out;
}

/**
 * Emballage de la tour → format de l'application (`CatalogFormat`). Sans photo envoyée, la photo
 * embarquée dans l'application (`format:<produit>:<emballage>`, et son aperçu `preview:…`) est
 * désignée : l'application l'affiche si elle la connaît, sinon rien n'est montré.
 */
export function formatOf(pack, productId) {
  const range = packRange(pack);
  const settings = (Array.isArray(pack.countryRules) ? pack.countryRules : [])
    .filter((r) => Array.isArray(r?.countries) && r.countries.length > 0)
    .map(settingOf);
  return {
    id: pack.id,
    label: pack.label,
    detail: pieceDetail(pack),
    description: pack.description ?? '',
    grams: gramsOf(pack),
    unit: pack.unit === 'piece' ? 'unit' : 'kg',
    // Prix de l'emballage ENTIER ; `null` conservé : « Prix à compléter », jamais remplacé.
    price: typeof pack.price === 'number' && pack.price > 0 ? pack.price : null,
    // Avec `?pays=`, le prix est déjà celui du pays, dans sa devise (franc CFA possible).
    currency: pack.currency === 'XOF' ? 'XOF' : DEFAULT_CURRENCY,
    noun: nounOf(pack.label),
    // Libellé d'unité neutre (« par cagette de 5 kg ») : l'application ne devine plus l'article
    // (« le cagette ») et le contenu s'affiche en kg au-delà du kilo.
    unitLabel: `par ${nounOf(pack.label)[0]}${packContent(pack) ? ` de ${packContent(pack)}` : ''}`,
    step: range.step,
    min: range.min,
    ...(range.max !== null ? { max: range.max } : null),
    available: pack.available !== false,
    ...(pack.photo_url
      ? { photo: { url: pack.photo_url } }
      : productId
        ? { photo: { asset: `format:${productId}:${pack.id}` }, preview: { asset: `preview:${productId}:${pack.id}` } }
        : null),
    visibility: { mode: 'monde', countries: [] },
    ...(settings.length > 0 ? { settings } : null),
  };
}

/** Produit du document v1 → produit de l'application (`CatalogProduct`). */
export function productOf(p, demoIds) {
  const { packagings, countries, ...rest } = p;
  return {
    ...rest,
    visibility: visibilityOfZone(countries),
    demo: demoIds.has(p.id),
    // Les emballages réservés aux professionnels ne sont pas des formats particuliers.
    formats: (Array.isArray(packagings) ? packagings : []).filter((k) => k.audience !== 'pros').map((k) => formatOf(k, p.id)),
  };
}

/**
 * Annonces en cours (`banners` du v1) → annonces de l'application. `link` : `button` (bouton),
 * `tap` (toucher l'image ouvre la fiche), `none` (image seule : `id` nul, aucun produit).
 * Une annonce sans produit n'est gardée que si c'est une image sans lien.
 */
export function campaignsOf(banners) {
  return (Array.isArray(banners) ? banners : [])
    .filter((b) => (typeof b?.id === 'string' && b.id) || (b?.imageUrl && b.link === 'none'))
    .map((b) => ({
      id: b.link === 'none' ? null : b.id,
      key: b.key,
      link: b.imageUrl ? (b.link === 'tap' || b.link === 'none' ? b.link : 'button') : 'button',
      accent: b.accent ?? '',
      body: b.body ?? '',
      ...(b.buttonLabel ? { cta: b.buttonLabel } : null),
      ...(b.imageUrl ? { photo: { url: b.imageUrl } } : null),
      ...(b.link ? { link: b.link } : null),
      enabled: true,
      ...(b.startsAt ? { startsAt: b.startsAt } : null),
      ...(b.endsAt ? { endsAt: b.endsAt } : null),
    }));
}

/** Rayons du v1 → `{ id, label, order, image, pro }` (image : photo publiée, ou produit illustrant). */
export function categoriesOf(list, products = []) {
  // Produit d'illustration : sa photo envoyée depuis la tour, sinon sa photo embarquée (`asset`).
  const photoOf = (id) => (Array.isArray(products) ? products : []).find((p) => p.id === id)?.photo;
  return (Array.isArray(list) ? list : []).map((c, i) => ({
    id: c.id,
    label: c.label,
    order: i,
    image: c.illustration?.url
      ? { url: c.illustration.url }
      : c.illustration?.product
        ? photoOf(c.illustration.product)?.url
          ? { url: photoOf(c.illustration.product).url, product: c.illustration.product }
          : { asset: c.illustration.product }
        : null,
    pro: c.pro !== false,
  }));
}

/** Filtres « Tout » / « De saison » (v1 : `[{ id, label, illustration }]`) → `{ all, season }`. */
export function filtersOf(list) {
  const find = (id) => (Array.isArray(list) ? list.find((f) => f.id === id) : null);
  const one = (id, fallback) => {
    const f = find(id);
    return { label: f?.label || fallback, image: f?.illustration?.url ? { url: f.illustration.url } : null };
  };
  return { all: one('tout', 'Tout'), season: one('saison', 'De saison') };
}

/**
 * Document v2. `v1` : document de `buildDocument` complété par catalog.js (campaigns, banners,
 * filters, productRequest, payments). `demoIds` : produits marqués « Exemple » dans la tour.
 * `gp` : livraison GP convenue, `[{ country, options }]` — vide tant que rien n'est réglé.
 */
export function toAppDocument(v1, { demoIds = new Set(), gp = [] } = {}) {
  return {
    schema: SCHEMA_V2,
    updatedAt: v1.updatedAt,
    example: v1.example === true,
    country: v1.country ?? null,
    currency: DEFAULT_CURRENCY,
    rules: v1.rules,
    products: (v1.products ?? []).map((p) => productOf(p, demoIds)),
    campaigns: campaignsOf(v1.banners),
    delivery: { gp },
    categories: categoriesOf(v1.categories, v1.products),
    filters: filtersOf(v1.filters),
    payments: (v1.payments ?? []).map((p) => ({ ...p, enabled: true })),
    productRequest: v1.productRequest ?? null,
    ...(v1.transport ? { transport: v1.transport } : null),
  };
}
