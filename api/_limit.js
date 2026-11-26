import crypto from 'node:crypto';
import supabase from './db-client.js';

/**
 * Limite par visiteur pour les routes publiques (réception de commandes, demandes, position,
 * réactions). Les freins globaux existants restent en place ; celui-ci empêche qu'UN seul visiteur
 * en consomme toute la marge et bloque les autres.
 *
 * Le visiteur est identifié par son adresse réseau, jamais gardée en clair : on n'enregistre
 * qu'une empreinte salée. Table `rate_hits` (voir supabase/schema.sql).
 *
 * Si la table n'existe pas encore ou si la base ne répond pas, la requête passe : la limite ne
 * doit jamais faire tomber une vraie commande.
 */
const SALT = process.env.SEAL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'tropicaura';

export function visitorKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || String(req.headers['x-real-ip'] || '') || req.socket?.remoteAddress || 'inconnu';
  return crypto.createHash('sha256').update(`visitor:${SALT}:${ip}`).digest('hex').slice(0, 32);
}

/**
 * Renvoie `true` (et répond 429) quand ce visiteur a dépassé `max` appels sur `windowSec` secondes
 * pour ce `bucket`. Sinon enregistre l'appel et renvoie `false`.
 */
export async function tooMany(req, res, bucket, max, windowSec = 60) {
  try {
    const key = `${bucket}:${visitorKey(req)}`;
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const { count, error } = await supabase
      .from('rate_hits')
      .select('id', { count: 'exact', head: true })
      .eq('key', key)
      .gt('at', since);
    if (error) throw error;
    if ((count ?? 0) >= max) {
      res.setHeader('Retry-After', String(windowSec));
      res.status(429).json({ error: 'Trop de requêtes depuis cet appareil. Réessayez dans un instant.' });
      return true;
    }
    const { error: insertError } = await supabase.from('rate_hits').insert({ key });
    if (insertError) throw insertError;
    // Ménage occasionnel : les traces de plus d'une heure ne servent plus.
    if (Math.random() < 0.02) {
      const old = new Date(Date.now() - 3600 * 1000).toISOString();
      await supabase.from('rate_hits').delete().lt('at', old);
    }
    return false;
  } catch (err) {
    console.error('Limite par visiteur non appliquée :', err?.message || err);
    return false;
  }
}
