import supabase from './db-client.js';
import { signJournal } from './_seal.js';
import { OPEN_ACCESS } from '../shared/access.js';

/**
 * Le rôle d'un compte est rangé dans ses métadonnées d'authentification (`app_metadata`), que
 * seul le serveur peut écrire avec la clé de service. Il ne dépend d'aucune table : personne ne
 * peut se l'attribuer depuis un navigateur.
 */
export const ROLE_KEY = 'tropicaura_role';
const ROLES = ['owner', 'editor', 'pending'];

/** En-têtes communs. Renvoie `true` quand la requête (OPTIONS) est déjà traitée. */
export function preflight(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

/** Utilisateur du jeton présenté, relu auprès de Supabase à chaque appel. `null` si invalide. */
export async function getUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export const roleOf = (user) => {
  const role = user?.app_metadata?.[ROLE_KEY];
  return ROLES.includes(role) ? role : null;
};

/**
 * Autorisation serveur : jeton valide ET rôle actif. Répond 401 / 403 et renvoie `null` sinon.
 * Le compte est relu à chaque appel : un accès retiré cesse de fonctionner immédiatement.
 */
export async function requireAdmin(req, res, { owner = false } = {}) {
  const user = await getUser(req);
  // Phase de test (shared/access.js) : tout le monde agit comme responsable, sans connexion.
  if (OPEN_ACCESS) return { id: user?.id ?? 'acces-ouvert', email: user?.email ?? '', role: 'owner' };
  if (!user) {
    res.status(401).json({ error: 'Session absente ou expirée. Reconnectez-vous.' });
    return null;
  }
  const role = roleOf(user);
  if (role !== 'owner' && role !== 'editor') {
    res.status(403).json({ error: 'Ce compte n’est pas autorisé à administrer le catalogue.' });
    return null;
  }
  if (owner && role !== 'owner') {
    res.status(403).json({ error: 'Action réservée aux responsables.' });
    return null;
  }
  return { id: user.id, email: user.email ?? '', role };
}

/** Lecture seule : renvoie l'administrateur s'il y en a un, sinon `null` — sans rien refuser. */
export async function optionalAdmin(req) {
  const user = await getUser(req);
  if (OPEN_ACCESS) return { id: user?.id ?? 'acces-ouvert', email: user?.email ?? '', role: 'owner' };
  const role = roleOf(user);
  return user && (role === 'owner' || role === 'editor') ? { id: user.id, email: user.email ?? '', role } : null;
}

/** « b•••@exemple.fr » : sans connexion (phase de test), une adresse n'est jamais montrée en clair. */
export const maskEmail = (email) => {
  const [name, domain] = String(email || '').split('@');
  return domain ? `${name.slice(0, 1)}•••@${domain}` : '';
};
export const isGuest = (admin) => admin?.id === 'acces-ouvert';

export async function listAccounts() {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return (data?.users ?? []).map((u) => ({
    user_id: u.id,
    email: u.email ?? '',
    provider: u.app_metadata?.provider ?? 'email',
    role: roleOf(u),
    since: u.app_metadata?.tropicaura_since ?? null,
    created_at: u.created_at ?? null,
  }));
}

export async function setRole(userId, role) {
  const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { [ROLE_KEY]: role, tropicaura_since: role ? new Date().toISOString() : null },
  });
  if (error) throw error;
  return data.user;
}

/** Journal des modifications. Un échec d'écriture du journal ne bloque jamais l'action. */
export async function log(admin, action, entity, entityId, summary) {
  try {
    const entry = {
      at: new Date().toISOString(),
      user_id: admin.id,
      action,
      entity,
      entity_id: entityId ?? null,
      summary: String(summary || '').slice(0, 300),
    };
    const { error } = await supabase.from('journal').insert({ ...entry, sig: signJournal(entry) });
    if (error) console.error('Journal non écrit :', error.message);
  } catch (err) {
    console.error('Journal non écrit :', err?.message);
  }
}

export function serverError(res, err) {
  console.error('API error:', err?.message || err);
  res.status(500).json({ error: 'Le serveur n’a pas pu traiter la demande. Réessayez dans un instant.' });
}
