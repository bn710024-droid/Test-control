import supabase from './db-client.js';
import { preflight, requireAdmin, readBody, log, serverError } from './_lib.js';
import { loadSeals, stateOf, sealRows, SEALED_TABLES, keyColumn } from './_seal.js';
import { validateRules, validateProduct, validateCategory, DEFAULT_RULES } from '../shared/catalog.js';
import { validateRequestMessage } from '../shared/requests.js';
import { validatePayments } from '../shared/payments.js';

/**
 * Réglages du catalogue :
 *  - `rules`  : règles de quantité des professionnels (publiées dans le document) ;
 *  - `compat` : ce que l'application d'achat connaît en dur (rayons, photos embarquées) ;
 *  - `link`   : état, déclaré à la main, du branchement de l'application d'achat ;
 *  - `filters`: nom et photo des deux filtres de l'accueil, « Tout » et « De saison » ;
 *  - `missing`: le message qui demande au client quel produit il recherche, quand il ne le trouve
 *               pas, et qui lui dit que nous reviendrons vers lui (publié dans le catalogue).
 */
export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    if (req.method === 'GET') {
      // Mode visite : lecture ouverte (aucune donnée personnelle dans ces réglages).
      const [{ data, error }, seals] = await Promise.all([supabase.from('settings').select('*'), loadSeals()]);
      if (error) throw error;
      const out = { rules: DEFAULT_RULES, compat: null, link: null, filters: null, missing: null, payments: null, updated: {}, seals: {} };
      for (const row of data) {
        if (!['rules', 'compat', 'link', 'audience', 'filters', 'missing', 'payments'].includes(row.key)) continue;
        out[row.key] = row.value;
        out.updated[row.key] = row.updated_at;
        out.seals[row.key] = stateOf('settings', row, seals);
      }
      return res.status(200).json(out);
    }

    if (req.method === 'PUT') {
      const { key, value } = readBody(req);
      // Les filtres de l'accueil et le message des produits introuvables se règlent par toute
      // l'équipe, comme les rayons et les publications ; le reste est réservé aux responsables.
      const admin = await requireAdmin(req, res, { owner: key !== 'filters' && key !== 'missing' });
      if (!admin) return;
      const now = new Date().toISOString();

      const save = async (row) => {
        const { data, error } = await supabase
          .from('settings')
          .upsert({ ...row, updated_at: now }, { onConflict: 'key' })
          .select()
          .single();
        if (error) throw error;
        await sealRows('settings', [data]);
        return data;
      };

      if (key === 'rules') {
        const { errors, value: rules } = validateRules(value);
        if (Object.keys(errors).length > 0) {
          return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
        }
        const data = await save({ key: 'rules', value: rules });
        await log(admin, 'update', 'settings', 'rules', 'Règles de quantité des professionnels modifiées');
        return res.status(200).json({ key, value: data.value });
      }

      if (key === 'link') {
        const link = {
          appLinked: value?.appLinked === true,
          note: String(value?.note ?? '').slice(0, 200),
          declaredBy: 'administration',
          declaredAt: now,
        };
        const data = await save({ key: 'link', value: link });
        await log(
          admin,
          'update',
          'settings',
          'link',
          link.appLinked ? 'Application d’achat déclarée reliée' : 'Application d’achat déclarée non reliée',
        );
        return res.status(200).json({ key, value: data.value });
      }

      if (key === 'filters') {
        const storage = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/catalogue/`;
        const filters = {};
        for (const id of ['tout', 'saison']) {
          const f = value?.[id] ?? {};
          const label = String(f.label ?? '').trim();
          if (label.length > 30) return res.status(400).json({ error: 'Nom du filtre : 30 caractères au plus.', fields: { [id]: 'Nom du filtre : 30 caractères au plus.' } });
          const image = f.image_url ? String(f.image_url).trim() : null;
          if (image && !image.startsWith(storage)) {
            return res.status(400).json({ error: 'Photo invalide : elle doit être envoyée depuis cette page.' });
          }
          const ratio = typeof f.image_ratio === 'number' && f.image_ratio >= 0.1 && f.image_ratio <= 10 ? Math.round(f.image_ratio * 1000) / 1000 : 1;
          filters[id] = { label, image_url: image, image_ratio: image ? ratio : 1 };
        }
        const data = await save({ key: 'filters', value: filters });
        await log(admin, 'update', 'settings', 'filters', 'Filtres de l’accueil modifiés (nom ou photo)');
        return res.status(200).json({ key, value: data.value });
      }

      if (key === 'payments') {
        const { errors, value: states } = validatePayments(value);
        if (Object.keys(errors).length > 0) {
          return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
        }
        const data = await save({ key: 'payments', value: states });
        const off = Object.entries(states).filter(([, on]) => !on).map(([id]) => id);
        await log(admin, 'update', 'settings', 'payments', off.length ? `Moyens de paiement : ${off.join(', ')} désactivé(s)` : 'Moyens de paiement : tous activés');
        return res.status(200).json({ key, value: data.value });
      }

      if (key === 'missing') {
        const { errors, value: message } = validateRequestMessage(value);
        if (Object.keys(errors).length > 0) {
          return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
        }
        const data = await save({ key: 'missing', value: message });
        await log(admin, 'update', 'settings', 'missing', `Produits introuvables : message au client ${message.enabled ? 'modifié' : 'désactivé'}`);
        return res.status(200).json({ key, value: data.value });
      }

      return res.status(400).json({ error: 'Réglage inconnu.' });
    }

    // Validation de lignes par un responsable : une ligne « à valider » est une ligne que
    // l'administration n'a pas écrite elle-même (import initial, écriture directe en base).
    if (req.method === 'POST') {
      const admin = await requireAdmin(req, res, { owner: true });
      if (!admin) return;
      const refs = Array.isArray(readBody(req).refs) ? readBody(req).refs.slice(0, 500) : [];
      const wanted = {};
      for (const ref of refs) {
        const cut = String(ref).indexOf(':');
        const table = String(ref).slice(0, cut);
        const id = String(ref).slice(cut + 1);
        if (cut > 0 && SEALED_TABLES.includes(table) && id) (wanted[table] ||= []).push(id);
      }

      const [categories, rules] = await Promise.all([
        supabase.from('categories').select('id'),
        supabase.from('settings').select('value').eq('key', 'rules').maybeSingle(),
      ]);
      if (categories.error) throw categories.error;
      const categoryIds = categories.data.map((c) => c.id);

      const sealed = [];
      const refused = [];
      for (const table of Object.keys(wanted)) {
        const column = keyColumn(table);
        const { data, error } = await supabase.from(table).select('*').in(column, wanted[table]);
        if (error) throw error;
        const accepted = [];
        for (const row of data) {
          let errors = {};
          if (table === 'products') {
            errors = validateProduct(row, { categoryIds, rules: rules.data?.value }).errors;
          } else if (table === 'categories') {
            errors = validateCategory(row, {}).errors;
          } else if (row.key === 'rules') {
            errors = validateRules(row.value).errors;
          }
          const first = Object.values(errors)[0];
          if (first) refused.push({ ref: `${table}:${row[column]}`, error: first });
          else accepted.push(row);
        }
        await sealRows(table, accepted);
        sealed.push(...accepted.map((row) => `${table}:${row[column]}`));
      }

      if (sealed.length > 0) {
        await log(
          admin,
          'update',
          'integrity',
          null,
          `${sealed.length} ligne${sealed.length > 1 ? 's validées' : ' validée'} pour publication`,
        );
      }
      return res.status(200).json({ sealed, refused });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}
