import supabase from './db-client.js';
import { loadSeals, stateOf, AUDIENCE_KEY, proHiddenOf } from './_seal.js';
import { buildDocument, DEFAULT_RULES, zoneOf, isCountryCode } from '../shared/catalog.js';
import { requestMessageOf } from '../shared/requests.js';
import { annonceState } from '../shared/orders.js';

/**
 * Catalogue publié — lecture publique, sans authentification.
 *
 * C'est l'adresse à renseigner dans `CATALOG_ENDPOINT` (lib/config.ts de l'application d'achat).
 * Le document suit `lib/catalog/schema.ts` (schema: 1). Il ne contient aucune donnée personnelle.
 * Seules les lignes validées par l'administration (scellé intact) y figurent.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [products, categories, settings, seals] = await Promise.all([
      supabase.from('products').select('*').eq('archived', false).order('sort_order', { ascending: true }),
      supabase.from('categories').select('*').order('sort_order', { ascending: true }),
      supabase.from('settings').select('*').in('key', ['rules', AUDIENCE_KEY, 'filters', 'missing']),
      loadSeals(),
    ]);
    const annonces = await supabase.from('publications').select('*').eq('kind', 'annonce').eq('published', true).order('sort_order', { ascending: true });
    if (annonces.error) throw annonces.error;
    const packRows = await supabase.from('packagings').select('*');
    if (packRows.error) throw packRows.error;
    const packagings = Object.fromEntries(
      packRows.data.filter((r) => stateOf('packagings', r, seals) === 'ok').map((r) => [r.id, Array.isArray(r.items) ? r.items : []]),
    );
    // Pays où chaque produit s'affiche (table `zones`). Sans ligne : le monde entier.
    const zoneRows = await supabase.from('zones').select('*');
    if (zoneRows.error) throw zoneRows.error;
    const zones = Object.fromEntries(zoneRows.data.filter((r) => stateOf('zones', r, seals) === 'ok').map((r) => [r.id, zoneOf(r.zone)]));
    // `?pays=SN` : le catalogue tel que le voit un client de ce pays.
    const asked = String(req.query?.pays ?? '').toUpperCase();
    if (asked && !isCountryCode(asked)) return res.status(400).json({ error: 'Pays inconnu : attendu, un code à deux lettres (SN, FR…).' });
    if (products.error) throw products.error;
    if (categories.error) throw categories.error;
    if (settings.error) throw settings.error;

    const okProducts = products.data.filter((p) => stateOf('products', p, seals) === 'ok');
    const okCategories = categories.data.filter((c) => stateOf('categories', c, seals) === 'ok');
    const rulesRow = settings.data.find((r) => r.key === 'rules') ?? null;
    const audienceRow = settings.data.find((r) => r.key === AUDIENCE_KEY) ?? null;
    const rulesOk = !!rulesRow && stateOf('settings', rulesRow, seals) === 'ok';
    const filtersRow = settings.data.find((r) => r.key === 'filters') ?? null;
    const filtersOk = !!filtersRow && stateOf('settings', filtersRow, seals) === 'ok';
    // Rayons masqués aux grossistes et importateurs : leurs offres professionnelles ne sont pas publiées.
    const proHidden = proHiddenOf(audienceRow, seals, categories.data.map((c) => c.id));

    const stamps = [
      ...okProducts.map((p) => p.updated_at),
      ...okCategories.map((c) => c.updated_at),
      rulesOk ? rulesRow.updated_at : null,
      audienceRow?.updated_at ?? null,
      filtersOk ? filtersRow.updated_at : null,
    ]
      .filter(Boolean)
      .map((s) => new Date(s).getTime())
      .filter((n) => Number.isFinite(n));
    const updatedAt = new Date(stamps.length ? Math.max(...stamps) : Date.now()).toISOString();

    const doc = buildDocument({
      products: okProducts,
      categories: okCategories,
      rules: rulesOk ? rulesRow.value : DEFAULT_RULES,
      proHidden,
      packagings,
      zones,
      country: asked || undefined,
      updatedAt,
    });
    if (asked) doc.country = asked;
    // Filtres de l'accueil (« Tout », « De saison ») : nom et photo réglés par l'équipe. Clé
    // supplémentaire, que l'application actuelle ignore (ses filtres sont dans son code).
    if (filtersOk) {
      doc.filters = ['tout', 'saison'].map((id) => ({
        id,
        label: filtersRow.value?.[id]?.label || (id === 'tout' ? 'Tout' : 'De saison'),
        illustration: filtersRow.value?.[id]?.image_url ? { url: filtersRow.value[id].image_url } : null,
      }));
    }
    // Annonces du bandeau d'accueil, au format de CAMPAIGNS (lib/data.ts de l'application).
    // Une annonce ne s'affiche que si son produit est visible — dans le pays demandé, s'il y en a un.
    const visible = new Set(doc.products.filter((p) => p.available).map((p) => p.id));
    // Seules les annonces en cours sont publiées : activées, commencées et pas encore terminées.
    // Aucune annonce en cours → liste vide → l'application n'affiche pas de bandeau.
    const liveAds = annonces.data.filter((r) => stateOf('publications', r, seals) === 'ok' && annonceState(r) === 'live');
    // `campaigns` : les annonces au modèle (produit + texte), seules comprises par une application
    // qui n'a pas le dernier correctif.
    doc.campaigns = liveAds
      .filter((r) => !r.data?.image_url && visible.has(r.data?.product_id))
      .map((r) => ({ id: r.data.product_id, accent: r.data.accent ?? '', body: r.data.body ?? '', startsAt: r.data.starts_at ?? null, endsAt: r.data.ends_at ?? null }));
    // `banners` : toutes les annonces en cours, dans l'ordre du bandeau — modèle et image de l'équipe.
    // Une image sans lien n'a pas de produit (`id: null`) ; `link` dit ce que fait un toucher.
    doc.banners = liveAds
      .filter((r) => (r.data?.image_url && (r.data.link ?? 'button') === 'none') || visible.has(r.data?.product_id))
      .map((r) => {
        const image = r.data.image_url || null;
        const link = image ? (r.data.link ?? 'button') : 'button';
        return {
          key: r.id,
          id: link === 'none' ? null : r.data.product_id,
          accent: r.data.accent ?? '',
          body: r.data.body ?? '',
          startsAt: r.data.starts_at ?? null,
          endsAt: r.data.ends_at ?? null,
          imageUrl: image,
          link,
          buttonLabel: image && link === 'button' ? r.data.button_label || 'Voir le produit' : null,
        };
      });
    // Produit introuvable : le message qui demande au client quel produit il recherche, et la
    // confirmation qu'il lit après l'envoi. `enabled: false` : l'application ne propose rien.
    const missingRow = settings.data.find((r) => r.key === 'missing') ?? null;
    doc.productRequest = requestMessageOf(missingRow && stateOf('settings', missingRow, seals) === 'ok' ? missingRow.value : null);
    // Moyens de paiement des particuliers. Orange Money et Wave : surtout au Sénégal.
    doc.payments = [
      { id: 'orange_money', title: 'Orange Money', detail: 'Surtout au Sénégal', icon: 'phone-portrait-outline' },
      { id: 'wave', title: 'Wave', detail: 'Surtout au Sénégal', icon: 'phone-portrait-outline' },
      { id: 'virement', title: 'Virement bancaire', detail: 'Depuis l’étranger', icon: 'business-outline' },
      { id: 'carte', title: 'Carte bancaire', detail: 'Partout', icon: 'card-outline' },
    ];
    // Cache court : une annonce activée, désactivée ou arrivée à son terme se voit en quelques secondes.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=5');
    return res.status(200).json(doc);
  } catch (err) {
    console.error('API error:', err?.message || err);
    return res.status(500).json({ error: 'Catalogue momentanément indisponible.' });
  }
}
