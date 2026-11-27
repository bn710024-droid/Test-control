import supabase from './db-client.js';
import { removeUnusedPhotos } from './_files.js';
import { preflight, requireAdmin, optionalAdmin, readBody, log, serverError } from './_lib.js';
import { loadSeals, stateOf, sealRows, unseal } from './_seal.js';
import { validateProduct, validatePackagings, validateZone, zoneOf, zoneLabel, DEFAULT_RULES, modeLabel } from '../shared/catalog.js';

const BUCKET = 'catalogue';

async function loadContext() {
  const [categories, rules, products, seals] = await Promise.all([
    supabase.from('categories').select('*'),
    supabase.from('settings').select('*').eq('key', 'rules').maybeSingle(),
    supabase.from('products').select('*'),
    loadSeals(),
  ]);
  if (categories.error) throw categories.error;
  if (rules.error) throw rules.error;
  if (products.error) throw products.error;
  const rulesOk = rules.data && stateOf('settings', rules.data, seals) === 'ok';
  return {
    categories: categories.data,
    categoryIds: categories.data.map((c) => c.id),
    rules: rulesOk ? rules.data.value : DEFAULT_RULES,
    products: products.data,
    seals,
  };
}

/** Emballages de tous les produits, par identifiant de produit. */
async function loadPacks() {
  const { data, error } = await supabase.from('packagings').select('*');
  if (error) throw error;
  return new Map(data.map((r) => [r.id, Array.isArray(r.items) ? r.items : []]));
}

async function savePacks(productId, items) {
  const { data, error } = await supabase
    .from('packagings')
    .upsert({ id: productId, items, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  await sealRows('packagings', [data]);
  return data.items;
}

/** Toutes les photos qu'utilisent des emballages : celle d'origine et celles propres à des pays. */
const packPhotos = (items) =>
  (Array.isArray(items) ? items : []).flatMap((k) => [k?.photo_url, ...(Array.isArray(k?.countryRules) ? k.countryRules.map((g) => g?.photo_url) : [])]).filter((u) => typeof u === 'string' && u);

async function removePackPhotos(urls) {
  const marker = `/object/public/${BUCKET}/packagings/`;
  const paths = urls.filter((u) => u.includes(marker)).map((u) => `packagings/${u.split(marker)[1]}`);
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    // Les fichiers restent dans le stockage : sans conséquence pour le catalogue.
  }
}

/** Pays où chaque produit s'affiche, par identifiant de produit. Sans ligne : le monde entier. */
async function loadZones(seals) {
  const { data, error } = await supabase.from('zones').select('*');
  if (error) throw error;
  return new Map(data.filter((r) => !seals || stateOf('zones', r, seals) === 'ok').map((r) => [r.id, zoneOf(r.zone)]));
}

async function saveZone(productId, zone) {
  const { data, error } = await supabase
    .from('zones')
    .upsert({ id: productId, zone, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  await sealRows('zones', [data]);
  return zoneOf(data.zone);
}

const euro = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`;
const priceText = (n) => (n === null || n === undefined ? 'non fixé' : euro(n));

/** Résumé lisible d'une modification, pour le journal. */
function describe(before, after) {
  const parts = [];
  if (before.archived !== after.archived) parts.push(after.archived ? 'archivé' : 'désarchivé');
  if (before.available !== after.available) parts.push(after.available ? 'rendu visible' : 'masqué');
  const b = before.retail?.price ?? null;
  const a = after.retail?.price ?? null;
  if (!!before.retail !== !!after.retail) {
    parts.push(after.retail ? 'ouvert aux particuliers' : 'retiré de la vente aux particuliers');
  } else if (b !== a) parts.push(`prix particulier ${priceText(b)} → ${priceText(a)}`);
  if (JSON.stringify(before.retail?.countryPrices ?? []) !== JSON.stringify(after.retail?.countryPrices ?? [])) {
    const n = new Set((after.retail?.countryPrices ?? []).flatMap((g) => g.countries)).size;
    parts.push(n > 0 ? `prix particuliers par pays mis à jour (${n} pays)` : 'prix particuliers par pays retirés');
  }
  if (JSON.stringify(before.wholesale ?? []) !== JSON.stringify(after.wholesale ?? [])) {
    const modes = (after.wholesale ?? []).map((o) => modeLabel(o.mode).toLowerCase());
    parts.push(
      modes.length
        ? `offres professionnelles mises à jour (${modes.join(', ')})`
        : 'offres professionnelles supprimées',
    );
  }
  if ((before.photo_url ?? null) !== (after.photo_url ?? null)) {
    parts.push(after.photo_url ? 'photo remplacée' : 'photo retirée');
  }
  if (before.is_example && !after.is_example) parts.push('données vérifiées');
  if (parts.length === 0) parts.push('fiche modifiée');
  return parts.join(' · ');
}

const sameInstant = (a, b) => new Date(a).getTime() === new Date(b).getTime();

/**
 * Applique des changements à un produit existant. Ne lève pas : renvoie un résultat.
 * `full` : la fiche complète vient d'être relue dans l'éditeur ; c'est la seule façon de valider
 * une ligne dont le scellé n'est pas intact.
 */
async function applyUpdate(current, changes, expected, ctx, admin, full) {
  const sealState = stateOf('products', current, ctx.seals);
  if (sealState !== 'ok' && !full) {
    return {
      ok: false,
      status: 409,
      error: `La fiche « ${current.name} » doit d’abord être validée : ouvrez-la, vérifiez-la et enregistrez-la.`,
    };
  }
  if (expected && !sameInstant(expected, current.updated_at)) {
    return {
      ok: false,
      status: 409,
      error: `La fiche « ${current.name} » a été modifiée entre-temps par quelqu’un d’autre. Rechargez avant d’enregistrer à nouveau.`,
    };
  }
  const merged = { ...current, ...changes, id: current.id };
  // Les avis ne s'inventent pas : on peut les conserver ou les remettre à zéro, rien d'autre.
  if (!(Number(merged.rating) === 0 && Number(merged.reviews) === 0)) {
    merged.rating = Number(current.rating) || 0;
    merged.reviews = Number(current.reviews) || 0;
  }
  const { errors, value } = validateProduct(merged, { categoryIds: ctx.categoryIds, rules: ctx.rules });
  if (Object.keys(errors).length > 0) {
    return { ok: false, status: 400, error: Object.values(errors)[0], fields: errors };
  }
  const { id: _id, ...fields } = value;
  const { data, error } = await supabase
    .from('products')
    .update({ ...fields, updated_at: new Date().toISOString(), updated_by: admin.id })
    .eq('id', current.id)
    .select()
    .single();
  if (error) return { ok: false, status: 500, error: 'Enregistrement impossible pour le moment.' };
  try {
    await sealRows('products', [data]);
  } catch {
    return {
      ok: false,
      status: 500,
      error: `La fiche « ${data.name} » est enregistrée mais n’a pas pu être validée pour publication. Enregistrez-la à nouveau.`,
    };
  }
  await log(admin, 'update', 'product', current.id, `${data.name} : ${describe(current, data)}`);
  return { ok: true, row: { ...data, _seal: 'ok' } };
}

const CHANGEABLE = [
  'name', 'variety', 'category', 'origin', 'description', 'photo_asset', 'photo_url', 'photo_ratio',
  'tint', 'months', 'available', 'archived', 'bio', 'rating', 'reviews', 'retail', 'wholesale', 'is_example',
];
const pick = (src) => Object.fromEntries(CHANGEABLE.filter((k) => k in src).map((k) => [k, src[k]]));

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    if (req.method === 'GET') {
      // Mode visite : la lecture est ouverte, sans les identifiants de compte.
      const admin = await optionalAdmin(req);
      const [{ data, error }, seals] = await Promise.all([
        supabase.from('products').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true }),
        loadSeals(),
      ]);
      if (error) throw error;
      const [packs, zones] = await Promise.all([loadPacks(), loadZones(seals)]);
      return res.status(200).json(data.map((p) => ({ ...p, updated_by: admin ? p.updated_by : null, packagings: packs.get(p.id) ?? [], zone: zones.get(p.id) ?? zoneOf(null), _seal: stateOf('products', p, seals) })));
    }

    if (req.method === 'POST') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const body = readBody(req);
      const ctx = await loadContext();
      const { errors, value } = validateProduct(
        { ...body, rating: 0, reviews: 0, archived: false },
        { isNew: true, existingIds: ctx.products.map((p) => p.id), categoryIds: ctx.categoryIds, rules: ctx.rules },
      );
      const packs = validatePackagings(body.packagings);
      Object.assign(errors, packs.errors);
      const place = validateZone(body.zone);
      Object.assign(errors, place.errors);
      if (Object.keys(errors).length > 0) {
        return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
      }
      const last = Math.max(0, ...ctx.products.map((p) => p.sort_order ?? 0));
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('products')
        .insert({ ...value, sort_order: last + 10, created_at: now, updated_at: now, updated_by: admin.id })
        .select()
        .single();
      if (error) throw error;
      await sealRows('products', [data]);
      const items = packs.value.length > 0 ? await savePacks(data.id, packs.value) : [];
      const zone = place.value.mode === 'all' ? place.value : await saveZone(data.id, place.value);
      await log(admin, 'create', 'product', data.id, `${data.name} : produit créé${data.available ? '' : ' (masqué)'}${zone.mode === 'all' ? '' : ` · ${zoneLabel(zone, true)}`}`);
      return res.status(201).json({ ...data, packagings: items, zone, _seal: 'ok' });
    }

    if (req.method === 'PUT') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const body = readBody(req);
      const ctx = await loadContext();
      const byId = new Map(ctx.products.map((p) => [p.id, p]));

      // Mise à jour en série (prix, disponibilités) : chaque ligne réussit ou échoue pour elle-même.
      if (Array.isArray(body.updates)) {
        if (body.updates.length > 120) {
          return res.status(400).json({ error: 'Trop de modifications en une fois (120 au plus).' });
        }
        const results = [];
        const replaced = [];
        for (const u of body.updates) {
          const current = byId.get(u?.id);
          if (!current) {
            results.push({ id: u?.id ?? '', ok: false, error: 'Produit introuvable : il a peut-être été supprimé.' });
            continue;
          }
          const result = await applyUpdate(current, pick(u.changes || {}), u.expected_updated_at, ctx, admin, false);
          results.push({ id: current.id, ...result });
          if (result.ok && (result.row.photo_url ?? null) !== (current.photo_url ?? null)) replaced.push(current.photo_url);
        }
        // Photos remplacées ou retirées : leurs fichiers ne servent plus.
        await removeUnusedPhotos(replaced);
        return res.status(200).json({ results });
      }

      const current = byId.get(body.id);
      if (!current) return res.status(404).json({ error: 'Produit introuvable : il a peut-être été supprimé.' });
      // Les emballages voyagent avec la fiche : contrôlés avant d'enregistrer quoi que ce soit.
      const packs = Array.isArray(body.packagings) ? validatePackagings(body.packagings) : null;
      if (packs && Object.keys(packs.errors).length > 0) {
        return res.status(400).json({ error: Object.values(packs.errors)[0], fields: packs.errors });
      }
      const place = body.zone !== undefined ? validateZone(body.zone) : null;
      if (place && Object.keys(place.errors).length > 0) {
        return res.status(400).json({ error: Object.values(place.errors)[0], fields: place.errors });
      }
      const result = await applyUpdate(current, pick(body), body.expected_updated_at, ctx, admin, body.full === true);
      if (!result.ok) return res.status(result.status).json({ error: result.error, fields: result.fields });
      // Photo du produit remplacée ou retirée : son fichier ne sert plus (s'il n'est cité nulle part).
      if ((result.row.photo_url ?? null) !== (current.photo_url ?? null)) await removeUnusedPhotos([current.photo_url]);
      const before = (await loadPacks()).get(current.id) ?? [];
      let items = before;
      // La base range les clés dans son ordre à elle : on compare champ par champ.
      const flat = (list) => JSON.stringify(list.map((k) => [k.id, k.label, k.qty, k.unit, k.price, k.step ?? 1, k.min ?? null, k.max ?? null, k.audience, k.available, k.photo_url ?? null, k.description ?? '', (k.countryRules ?? []).map((g) => [g.countries, g.available !== false, g.price ?? null, g.photo_url ?? null])]));
      if (packs && flat(packs.value) !== flat(before)) {
        items = await savePacks(current.id, packs.value);
        // Photos d'emballage retirées ou remplacées : leurs fichiers ne servent plus.
        const kept = new Set(packPhotos(items));
        await removePackPhotos(packPhotos(before).filter((u) => !kept.has(u)));
        await log(admin, 'update', 'product', current.id, `${result.row.name} : emballages mis à jour (${items.length})`);
      }
      const zoneBefore = (await loadZones(ctx.seals)).get(current.id) ?? zoneOf(null);
      let zone = zoneBefore;
      if (place && JSON.stringify(place.value) !== JSON.stringify(zoneBefore)) {
        zone = await saveZone(current.id, place.value);
        await log(admin, 'update', 'product', current.id, `${result.row.name} : affiché — ${zoneLabel(zone).replace(/^Monde/, 'monde')}`);
      }
      return res.status(200).json({ ...result.row, packagings: items, zone });
    }

    if (req.method === 'DELETE') {
      // Suppression définitive : réservée aux responsables. Les éditeurs archivent.
      const admin = await requireAdmin(req, res, { owner: true });
      if (!admin) return;
      const { id } = readBody(req);
      const ctx = await loadContext();
      const current = ctx.products.find((p) => p.id === id);
      if (!current) return res.status(404).json({ error: 'Produit introuvable : il a peut-être déjà été supprimé.' });

      // Cohérence des références : un rayon illustré par ce produit perd son illustration.
      for (const c of ctx.categories.filter((cat) => cat.illustration_product === id)) {
        const wasOk = stateOf('categories', c, ctx.seals) === 'ok';
        const { data: updated, error: refError } = await supabase
          .from('categories')
          .update({ illustration_product: null, updated_at: new Date().toISOString() })
          .eq('id', c.id)
          .select()
          .single();
        if (refError) throw refError;
        if (wasOk) await sealRows('categories', [updated]);
      }

      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
      await unseal('products', id);
      const { data: gone } = await supabase.from('packagings').select('items').eq('id', id).maybeSingle();
      await supabase.from('packagings').delete().eq('id', id);
      await removePackPhotos(packPhotos(gone?.items));
      await unseal('packagings', id);
      await supabase.from('zones').delete().eq('id', id);
      await unseal('zones', id);

      // Sa photo n'est supprimée que si aucune autre ligne ne la cite.
      await removeUnusedPhotos([current.photo_url]);
      await log(admin, 'delete', 'product', id, `${current.name} : produit supprimé définitivement`);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}
