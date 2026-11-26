import supabase from './db-client.js';
import { preflight, optionalAdmin, listAccounts, serverError, maskEmail, isGuest } from './_lib.js';
import { journalIsGenuine } from './_seal.js';

/**
 * Dernières modifications enregistrées par l'administration.
 * Le journal ne stocke que des identifiants de compte : les adresses sont relues ici, côté
 * serveur, pour les seules personnes autorisées. Les lignes non signées par le serveur sont
 * écartées.
 */
export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    // Mode visite : le journal est lisible, sans les adresses des auteurs.
    const admin = await optionalAdmin(req);
    const { data, error } = await supabase
      .from('journal')
      .select('*')
      .order('id', { ascending: false })
      .limit(80);
    if (error) throw error;

    let emails = new Map();
    try {
      if (admin) emails = new Map((await listAccounts()).map((a) => [a.user_id, a.email]));
    } catch {
      // Annuaire indisponible : le journal s'affiche sans les noms.
    }
    const seen = new Set();
    const rows = data
      .filter(journalIsGenuine)
      .filter((r) => {
        const key = `${new Date(r.at).getTime()}|${r.user_id}|${r.summary}`;
        return !seen.has(key) && !!seen.add(key);
      })
      .slice(0, 30)
      .map((r) => ({
        id: r.id,
        at: r.at,
        by: emails.has(r.user_id) ? (isGuest(admin) ? maskEmail(emails.get(r.user_id)) : emails.get(r.user_id)) : null,
        action: r.action,
        entity: r.entity,
        entity_id: r.entity_id,
        summary: r.summary,
      }));
    return res.status(200).json(rows);
  } catch (err) {
    return serverError(res, err);
  }
}
