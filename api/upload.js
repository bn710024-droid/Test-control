import supabase from './db-client.js';
import { preflight, requireAdmin, readBody, serverError } from './_lib.js';

const BUCKET = 'catalogue';
const TYPES = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };
const MAX_BYTES = 3 * 1024 * 1024;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Dépôt d'une image (photo de produit, d'emballage ou illustration de rayon) dans le stockage.
 * Le stockage est en lecture publique (l'application doit afficher les photos) ; l'écriture n'est
 * possible que par cette route, avec la clé de service, après vérification du rôle.
 */
export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { fileBase64, contentType, kind, id } = readBody(req);
    const ext = TYPES[contentType];
    if (!ext) return res.status(400).json({ error: 'Format non accepté : PNG, WebP ou JPEG.' });
    if (kind !== 'products' && kind !== 'categories' && kind !== 'packagings') {
      return res.status(400).json({ error: 'Destination d’image inconnue.' });
    }
    if (typeof id !== 'string' || !SLUG.test(id) || id.length > 40) {
      return res.status(400).json({ error: 'Identifiant invalide pour nommer l’image.' });
    }
    if (typeof fileBase64 !== 'string' || !fileBase64) {
      return res.status(400).json({ error: 'Aucune image reçue.' });
    }
    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.length === 0) return res.status(400).json({ error: 'Image vide ou illisible.' });
    if (buffer.length > MAX_BYTES) {
      return res.status(413).json({ error: 'Image trop lourde après préparation (3 Mo au plus).' });
    }

    // Plusieurs photos d'emballage portent le nom du même produit : un suffixe les distingue.
    const path = `${kind}/${id}-${Date.now()}${kind === 'packagings' ? `-${Math.random().toString(36).slice(2, 8)}` : ''}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType, upsert: false, cacheControl: '31536000' });
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return res.status(200).json({ url: data.publicUrl, path });
  } catch (err) {
    return serverError(res, err);
  }
}
