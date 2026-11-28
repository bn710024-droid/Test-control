import supabase from './db-client.js';
import { stateOf, spaceOf, rowSpace, settingKey } from './_seal.js';
import { loadCatalogSource } from './_catalog-data.js';
import { buildDocument, DEFAULT_RULES, isCountryCode } from '../shared/catalog.js';
import { requestMessageOf } from '../shared/requests.js';
import { annonceState } from '../shared/orders.js';
import { toAppDocument } from '../shared/catalog-v2.js';
import { publishedPayments } from '../shared/payments.js';
import { transportZonesOf } from '../shared/transport.js';

/**
 * Catalogue publié — lecture publique, sans authentification.
 *
 * `?v=2` : document AU FORMAT DE L'APPLICATION (schema: 2, voir shared/catalog-v2.js) — c'est
 * l'adresse que lit l'application (`<tour>/api/catalog?v=2`). Sans `v` : document historique
 * (schema: 1, clés de la tour), gardé pour compatibilité. Aucune donnée personnelle.
 * Seules les lignes validées par l'administration (scellé intact) y figurent.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // `?pays=SN` : le catalogue tel que le voit un client de ce pays.
    const asked = String(req.query?.pays ?? '').toUpperCase();
    if (asked && !isCountryCode(asked)) return res.status(400).json({ error: 'Pays inconnu : attendu, un code à deux lettres (SN, FR…).' });
    // `?espace=b2b` : catalogue des grossistes et importateurs ; sinon celui des particuliers.
    // Un particulier ne voit jamais un produit pro, et l'inverse.
    const space = spaceOf(req);
    const [src, annonces] = await Promise.all([
      loadCatalogSource(['filters', 'missing', 'gp', 'payments', 'transport'], space),
      supabase.from('publications').select('*').eq('kind', 'annonce').eq('published', true).order('sort_order', { ascending: true }),
    ]);
    if (annonces.error) throw annonces.error;
    annonces.data = annonces.data.filter((r) => rowSpace(r) === space);
    const { seals, okProducts, okCategories, packagings, zones, rulesRow, rulesOk, audienceRow, proHidden } = src;
    const settings = { data: src.settings };
    const filtersRow = settings.data.find((r) => r.key === settingKey(space, 'filters')) ?? null;
    const filtersOk = !!filtersRow && stateOf('settings', filtersRow, seals) === 'ok';

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
    doc.space = space;
    // Particuliers : aucune offre professionnelle publiée.
    if (space === 'b2c') doc.products = doc.products.map((p) => ({ ...p, wholesale: [] }));
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
          kicker: r.data.kicker ?? '',
          title: r.data.title ?? '',
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
    const missingRow = settings.data.find((r) => r.key === settingKey(space, 'missing')) ?? null;
    doc.productRequest = requestMessageOf(missingRow && stateOf('settings', missingRow, seals) === 'ok' ? missingRow.value : null);
    // Moyens de paiement des particuliers, réglés dans Réglages › Moyens de paiement : seuls les
    // moyens activés sont publiés (réglage absent ou non validé : les quatre).
    const paymentsRow = space === 'b2c' ? (settings.data.find((r) => r.key === 'payments') ?? null) : null;
    const paymentsOk = !!paymentsRow && stateOf('settings', paymentsRow, seals) === 'ok';
    doc.payments = publishedPayments(paymentsOk ? paymentsRow.value : null);
    // Forfait transport des particuliers par zone (Réglages › Transport), en euros. Publié seulement
    // une fois réglé et validé : sans lui, l'application garde son barème.
    const transportRow = space === 'b2c' ? (settings.data.find((r) => r.key === 'transport') ?? null) : null;
    if (transportRow && stateOf('settings', transportRow, seals) === 'ok') {
      // `currency` : la devise par défaut ; chaque zone dit la sienne (euro ou franc CFA).
      // `currency: 'ZONES'` : un montant par devise de client (`fees`). Une application d'avant (qui
      // exige 'EUR') ignore ces forfaits et garde son barème — jamais un montant lu dans la mauvaise devise.
      doc.transport = { currency: 'ZONES', zones: transportZonesOf(transportRow.value) };
    }
    // Cache court : une annonce activée, désactivée ou arrivée à son terme se voit en quelques secondes.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=5');
    if (String(req.query?.v ?? '') === '2') {
      const demoIds = new Set(okProducts.filter((p) => p.is_example === true).map((p) => p.id));
      // Livraison GP : pays desservis (Commandes › Livraison), avec la modalité réglée là-bas.
      const gpRow = settings.data.find((r) => r.key === 'gp') ?? null;
      const gpOk = !!gpRow && stateOf('settings', gpRow, seals) === 'ok';
      const option = gpRow?.value?.delivery === 'domicile' ? 'domicile' : 'aéroport';
      const gp = gpOk && Array.isArray(gpRow.value?.countries)
        ? gpRow.value.countries.filter((c) => isCountryCode(c) && (!asked || c === asked)).map((country) => ({ country, options: [option] }))
        : [];
      return res.status(200).json(toAppDocument(doc, { demoIds, gp }));
    }
    return res.status(200).json(doc);
  } catch (err) {
    console.error('API error:', err?.message || err);
    return res.status(500).json({ error: 'Catalogue momentanément indisponible.' });
  }
}
