import supabase from './db-client.js';
import { unusedFiles } from '../shared/files.js';

/**
 * Photos de produit, de rayon ou de filtre remplacées ou retirées : leurs fichiers sont supprimés du
 * stockage s'ils ne servent plus nulle part (produits, rayons, réglages, emballages). En cas de
 * doute (lecture impossible), rien n'est supprimé : un fichier en trop est sans conséquence.
 */
export async function removeUnusedPhotos(urls) {
  if (!Array.isArray(urls) || !urls.some(Boolean)) return;
  try {
    const [products, categories, settings, packagings] = await Promise.all([
      supabase.from('products').select('*'),
      supabase.from('categories').select('*'),
      supabase.from('settings').select('key, value'),
      supabase.from('packagings').select('items'),
    ]);
    if (products.error || categories.error || settings.error || packagings.error) return;
    const uses = [products.data, categories.data, settings.data, packagings.data].map((rows) => JSON.stringify(rows ?? []));
    const paths = unusedFiles(urls, uses);
    if (paths.length > 0) await supabase.storage.from('catalogue').remove(paths);
  } catch {
    // Les fichiers restent dans le stockage : sans conséquence pour le catalogue.
  }
}
