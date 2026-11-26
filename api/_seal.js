import crypto from 'node:crypto';
import supabase from './db-client.js';

/**
 * Scellés d'intégrité.
 *
 * Constat fait lors de la mise en place : dans cet environnement, les tables restent lisibles et
 * modifiables avec la clé publique de Supabase tant que la sécurité par ligne (RLS) n'a pas été
 * activée à la main (voir supabase/schema.sql). Une écriture pourrait donc contourner ces routes.
 *
 * Parade : chaque ligne écrite par l'administration reçoit une empreinte HMAC calculée avec un
 * secret que seul le serveur connaît. Une ligne sans empreinte valide n'a pas été écrite par
 * l'administration : elle est signalée, et elle n'est jamais publiée à l'application d'achat.
 */
/**
 * Clés séparées. Chaque usage a son propre secret, indépendant de la clé de service Supabase :
 *   SEAL_SECRET  : empreintes d'intégrité (lignes du catalogue, journal)
 *   VAULT_SECRET : chiffrement des commandes (données personnelles)
 * Si une variable n'est pas définie, l'ancienne dérivation depuis la clé de service reste utilisée
 * (aucune rupture). Une fois définie, la nouvelle clé sert pour tout ce qui s'écrit ; l'ancienne
 * continue de LIRE et de vérifier l'existant, le temps de la migration.
 */
const derive = (label, secret) => crypto.createHash('sha256').update(`${label}:${secret}`).digest();
const legacy = (label) => derive(label, process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const keysFor = (label, envName) => {
  const own = process.env[envName];
  const list = [];
  if (own && own.length >= 32) list.push(derive(label, own));
  list.push(legacy(label));
  return list;
};
const SEAL_KEYS = keysFor('tropicaura-seal-v1', 'SEAL_SECRET');
const VAULT_KEYS = keysFor('tropicaura-vault-v1', 'VAULT_SECRET');

const FIELDS = {
  products: [
    'id', 'name', 'variety', 'category', 'origin', 'description', 'photo_asset', 'photo_url',
    'photo_ratio', 'tint', 'months', 'available', 'archived', 'bio', 'rating', 'reviews', 'retail',
    'wholesale', 'is_example', 'sort_order',
  ],
  categories: ['id', 'label', 'illustration_product', 'image_url', 'image_ratio', 'sort_order'],
  settings: ['key', 'value'],
  publications: ['id', 'kind', 'data', 'published', 'sort_order'],
  packagings: ['id', 'items'],
  zones: ['id', 'zone'],
};

export const SEALED_TABLES = Object.keys(FIELDS);
export const keyColumn = (table) => (table === 'settings' ? 'key' : 'id');
export const refOf = (table, row) => `${table}:${row[keyColumn(table)]}`;

/** Écriture stable d'une valeur : mêmes données, même texte, quel que soit l'ordre des clés. */
export function canon(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
    .join(',')}}`;
}

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const hmacWith = (key, text) => crypto.createHmac('sha256', key).update(text).digest('hex');
const hmac = (text) => hmacWith(SEAL_KEYS[0], text);
/** Vrai si l'empreinte correspond à l'une des clés acceptées (la nouvelle d'abord, puis l'ancienne). */
const matches = (sig, text) => SEAL_KEYS.some((k) => same(sig, hmacWith(k, text)));

function rowText(table, row) {
  const picked = {};
  for (const f of FIELDS[table]) picked[f] = row[f] ?? null;
  // Les nombres décimaux stockés en « numeric » peuvent revenir sous forme de texte.
  if (table === 'products') picked.rating = Number(picked.rating) || 0;
  return `${table}\n${canon(picked)}`;
}

export const signRow = (table, row) => hmac(rowText(table, row));

export async function loadSeals() {
  const { data, error } = await supabase.from('seals').select('ref, sig');
  if (error) throw error;
  return new Map(data.map((s) => [s.ref, s.sig]));
}

/** 'ok' : écrite par l'administration. 'missing' : jamais validée. 'invalid' : modifiée ensuite. */
export function stateOf(table, row, seals) {
  const sig = seals.get(refOf(table, row));
  if (!sig) return 'missing';
  return matches(sig, rowText(table, row)) ? 'ok' : 'invalid';
}

export async function sealRows(table, rows) {
  if (!rows || rows.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from('seals').upsert(
    rows.map((row) => ({ ref: refOf(table, row), sig: signRow(table, row), sealed_at: now })),
    { onConflict: 'ref' },
  );
  if (error) throw error;
}

export async function unseal(table, id) {
  await supabase.from('seals').delete().eq('ref', `${table}:${id}`);
}

/**
 * Rayons masqués aux grossistes et importateurs. La liste est rangée dans `settings` (clé
 * « audience ») et scellée comme les autres lignes.
 */
export const AUDIENCE_KEY = 'audience';

export function proHiddenOf(row, seals, allCategoryIds) {
  if (!row) return [];
  // Ligne modifiée hors de l'administration : par prudence, aucun rayon n'est montré aux pros.
  if (stateOf('settings', row, seals) !== 'ok') return [...allCategoryIds];
  return Array.isArray(row.value?.proHidden) ? row.value.proHidden.filter((x) => typeof x === 'string') : [];
}

export async function saveProHidden(ids) {
  const { data, error } = await supabase
    .from('settings')
    .upsert(
      { key: AUDIENCE_KEY, value: { proHidden: [...new Set(ids)].sort() }, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
    .select()
    .single();
  if (error) throw error;
  await sealRows('settings', [data]);
}

/**
 * Coffre des commandes : chiffrement AES-256-GCM avec une clé que seul le serveur connaît.
 * Les commandes portent des données personnelles (nom, adresse, téléphone) ; chiffrées, elles
 * restent illisibles même pour qui lirait la table directement. L'identifiant de la ligne est lié
 * au contenu : une ligne recopiée ailleurs ou modifiée ne se déchiffre plus.
 */
export function vaultSeal(id, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', VAULT_KEYS[0], iv);
  cipher.setAAD(Buffer.from(String(id)));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function vaultOpen(id, text) {
  const [version, iv, tag, data] = String(text).split('.');
  if (version !== 'v1') return null;
  // Essaie la clé propre au coffre, puis l'ancienne dérivation (commandes déjà enregistrées).
  for (const key of VAULT_KEYS) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(String(id)));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8'));
    } catch {
      /* mauvaise clé pour cette ligne : on essaie la suivante */
    }
  }
  return null;
}

const journalText = (e) =>
  `journal\n${canon({
    at: new Date(e.at).getTime(),
    user_id: e.user_id ?? null,
    action: e.action ?? null,
    entity: e.entity ?? null,
    entity_id: e.entity_id ?? null,
    summary: e.summary ?? null,
  })}`;

export const signJournal = (entry) => hmac(journalText(entry));
export const journalIsGenuine = (row) => !!row.sig && matches(row.sig, journalText(row));
