import supabase from './db-client.js';
import { loadSeals, stateOf, AUDIENCE_KEY, proHiddenOf, rowSpace, settingKey } from './_seal.js';
import { buildDocument, DEFAULT_RULES, zoneOf } from '../shared/catalog.js';
import { toAppDocument } from '../shared/catalog-v2.js';

/**
 * Lignes du catalogue publié, lues une seule fois : produits non archivés, rayons, réglages demandés,
 * emballages et pays d'affichage. Seules les lignes validées par l'administration (scellé intact)
 * sont gardées. Partagé par le catalogue publié (api/catalog.js) et le prix des paniers (api/_carts.js).
 */
export async function loadCatalogSource(settingKeys, space = 'b2c') {
  const [products, categories, settings, seals, packRows, zoneRows] = await Promise.all([
    supabase.from('products').select('*').eq('archived', false).order('sort_order', { ascending: true }),
    supabase.from('categories').select('*').order('sort_order', { ascending: true }),
    supabase.from('settings').select('*').in('key', [...new Set(['rules', AUDIENCE_KEY, ...settingKeys.map((k) => settingKey(space, k))])]),
    loadSeals(),
    supabase.from('packagings').select('*'),
    supabase.from('zones').select('*'),
  ]);
  for (const r of [products, categories, settings, packRows, zoneRows]) if (r.error) throw r.error;
  const packagings = Object.fromEntries(
    packRows.data.filter((r) => stateOf('packagings', r, seals) === 'ok').map((r) => [r.id, Array.isArray(r.items) ? r.items : []]),
  );
  // Pays où chaque produit s'affiche (table `zones`). Sans ligne : le monde entier.
  const zones = Object.fromEntries(zoneRows.data.filter((r) => stateOf('zones', r, seals) === 'ok').map((r) => [r.id, zoneOf(r.zone)]));
  const rulesRow = settings.data.find((r) => r.key === 'rules') ?? null;
  const audienceRow = settings.data.find((r) => r.key === AUDIENCE_KEY) ?? null;
  // Deux espaces : seuls les produits et rayons de l'espace demandé.
  products.data = products.data.filter((p) => rowSpace(p) === space);
  categories.data = categories.data.filter((c) => rowSpace(c) === space);
  return {
    space,
    seals,
    settings: settings.data,
    okProducts: products.data.filter((p) => stateOf('products', p, seals) === 'ok'),
    okCategories: categories.data.filter((c) => stateOf('categories', c, seals) === 'ok'),
    categoryIds: categories.data.map((c) => c.id),
    packagings,
    zones,
    rulesRow,
    rulesOk: !!rulesRow && stateOf('settings', rulesRow, seals) === 'ok',
    audienceRow,
    // Rayons masqués aux grossistes et importateurs : leurs offres professionnelles ne sont pas publiées.
    proHidden: space === 'b2b' ? [] : proHiddenOf(audienceRow, seals, categories.data.map((c) => c.id)),
  };
}

/** Document publié au format de l'application (`?v=2`), sans pays : celui que lit l'application. */
export async function loadAppDocument(space = 'b2c') {
  const src = await loadCatalogSource([], space);
  const doc = buildDocument({
    products: src.okProducts,
    categories: src.okCategories,
    rules: src.rulesOk ? src.rulesRow.value : DEFAULT_RULES,
    proHidden: src.proHidden,
    packagings: src.packagings,
    zones: src.zones,
    updatedAt: new Date().toISOString(),
  });
  return toAppDocument(doc, { demoIds: new Set(), gp: [] });
}
