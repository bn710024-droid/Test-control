import supabase from './db-client.js';
import { removeUnusedPhotos } from './_files.js';
import { preflight, requireAdmin, optionalAdmin, readBody, log, serverError } from './_lib.js';
import { loadSeals, stateOf, sealRows, unseal, AUDIENCE_KEY, proHiddenOf, saveProHidden, spaceOf, rowSpace } from './_seal.js';
import { validateCategory } from '../shared/catalog.js';

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    // Mode visite : la lecture est ouverte ; toute écriture exige un rôle.
    const admin = req.method === 'GET' ? await optionalAdmin(req) : await requireAdmin(req, res);
    if (!admin && req.method !== 'GET') return;

    const body0 = req.method === 'GET' ? {} : readBody(req);
    const space = spaceOf(req, body0);
    const [everything, seals, audience] = await Promise.all([
      supabase.from('categories').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true }),
      loadSeals(),
      supabase.from('settings').select('*').eq('key', AUDIENCE_KEY).maybeSingle(),
    ]);
    if (everything.error) throw everything.error;
    // Chaque espace a ses rayons ; les identifiants restent uniques sur les deux.
    const all = { data: everything.data.filter((c) => rowSpace(c) === space) };
    if (audience.error) throw audience.error;
    // Rayons que les grossistes et importateurs ne voient pas.
    const hidden = proHiddenOf(audience.data, seals, all.data.map((c) => c.id));

    if (req.method === 'GET') {
      return res.status(200).json(all.data.map((c) => ({ ...c, _seal: stateOf('categories', c, seals), pro_visible: !hidden.includes(c.id) })));
    }

    const body = body0;
    const allProducts = await supabase.from('products').select('id, category, space');
    if (allProducts.error) throw allProducts.error;
    const products = { data: allProducts.data.filter((p) => rowSpace(p) === space) };
    const productIds = products.data.map((p) => p.id);
    const now = new Date().toISOString();

    if (req.method === 'POST') {
      const { errors, value } = validateCategory(body, {
        isNew: true,
        existingIds: everything.data.map((c) => c.id),
        productIds,
      });
      if (Object.keys(errors).length > 0) {
        return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
      }
      const last = Math.max(0, ...all.data.map((c) => c.sort_order ?? 0));
      const { data, error } = await supabase
        .from('categories')
        .insert({ ...value, space, sort_order: last + 10, created_at: now, updated_at: now })
        .select()
        .single();
      if (error) throw error;
      await sealRows('categories', [data]);
      const proVisible = body.pro_visible !== false;
      if (!proVisible) await saveProHidden([...hidden, data.id]);
      await log(admin, 'create', 'category', data.id, `Rayon « ${data.label} » créé${proVisible ? '' : ' (masqué aux grossistes et importateurs)'}`);
      return res.status(201).json({ ...data, _seal: 'ok', pro_visible: proVisible });
    }

    if (req.method === 'PUT') {
      // Nouvel ordre des rayons : la liste complète des identifiants, dans l'ordre voulu.
      if (Array.isArray(body.order)) {
        const known = new Set(all.data.map((c) => c.id));
        const order = body.order.filter((id) => known.has(id));
        if (order.length !== known.size || new Set(order).size !== known.size) {
          return res.status(409).json({
            error: 'La liste des rayons a changé entre-temps. Rechargez la page avant de réordonner.',
          });
        }
        const toSeal = [];
        for (let i = 0; i < order.length; i++) {
          const current = all.data.find((c) => c.id === order[i]);
          const position = (i + 1) * 10;
          if (current.sort_order === position) continue;
          const { data, error } = await supabase
            .from('categories')
            .update({ sort_order: position, updated_at: now })
            .eq('id', current.id)
            .select()
            .single();
          if (error) throw error;
          // Seules les lignes déjà validées le restent : réordonner ne valide rien.
          if (stateOf('categories', current, seals) === 'ok') toSeal.push(data);
        }
        await sealRows('categories', toSeal);
        await log(admin, 'update', 'category', null, 'Ordre des rayons modifié');
        return res.status(200).json({ ok: true });
      }

      const current = all.data.find((c) => c.id === body.id);
      if (!current) return res.status(404).json({ error: 'Rayon introuvable : il a peut-être été supprimé.' });
      const { errors, value } = validateCategory({ ...current, ...body, id: current.id }, { productIds });
      if (Object.keys(errors).length > 0) {
        return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
      }
      const { id: _id, ...fields } = value;
      const { data, error } = await supabase
        .from('categories')
        .update({ ...fields, updated_at: now })
        .eq('id', current.id)
        .select()
        .single();
      if (error) throw error;
      await sealRows('categories', [data]);
      if ((data.image_url ?? null) !== (current.image_url ?? null)) await removeUnusedPhotos([current.image_url]);
      const wasVisible = !hidden.includes(current.id);
      const proVisible = typeof body.pro_visible === 'boolean' ? body.pro_visible : wasVisible;
      if (proVisible !== wasVisible) {
        await saveProHidden(proVisible ? hidden.filter((x) => x !== current.id) : [...hidden, current.id]);
      }
      const what =
        proVisible !== wasVisible
          ? proVisible
            ? 'ouvert aux grossistes et importateurs'
            : 'masqué aux grossistes et importateurs'
          : current.label !== data.label
            ? `renommé « ${current.label} » → « ${data.label} »`
            : 'illustration mise à jour';
      await log(admin, 'update', 'category', data.id, `Rayon « ${data.label} » : ${what}`);
      return res.status(200).json({ ...data, _seal: 'ok', pro_visible: proVisible });
    }

    if (req.method === 'DELETE') {
      const current = all.data.find((c) => c.id === body.id);
      if (!current) return res.status(404).json({ error: 'Rayon introuvable : il a peut-être déjà été supprimé.' });
      const used = products.data.filter((p) => p.category === current.id).length;
      if (used > 0) {
        return res.status(409).json({
          error: `${used} produit${used > 1 ? 's utilisent' : ' utilise'} ce rayon (archives comprises). Déplacez-${used > 1 ? 'les' : 'le'} dans un autre rayon avant de le supprimer.`,
        });
      }
      const { error } = await supabase.from('categories').delete().eq('id', current.id);
      if (error) throw error;
      await unseal('categories', current.id);
      await removeUnusedPhotos([current.image_url]);
      if (hidden.includes(current.id)) await saveProHidden(hidden.filter((x) => x !== current.id));
      await log(admin, 'delete', 'category', current.id, `Rayon « ${current.label} » supprimé`);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}
