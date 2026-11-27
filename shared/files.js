/**
 * Fichiers de l'espace `catalogue` (photos de produit et de rayon, images des filtres de l'accueil).
 * Une photo remplacée ou retirée ne sert plus : son fichier est supprimé du stockage, à condition
 * qu'aucune autre ligne ne la cite (voir api/_files.js).
 */
const MARKER = '/object/public/catalogue/';
const OWNED = /^(products|categories)\/[a-z0-9][a-z0-9-]*\.(webp|png|jpg)$/;

/** Chemin dans l'espace `catalogue` d'une photo de produit ou de rayon envoyée par la tour, sinon null. */
export function catalogueFileOf(url) {
  if (typeof url !== 'string') return null;
  const at = url.indexOf(MARKER);
  if (at < 0) return null;
  const path = url.slice(at + MARKER.length).split(/[?#]/)[0];
  return OWNED.test(path) ? path : null;
}

/** Fichiers à supprimer : ceux des adresses données qu'aucun des textes `uses` ne cite plus. */
export function unusedFiles(urls, uses) {
  const text = uses.join('\n');
  return [...new Set((urls ?? []).map(catalogueFileOf).filter(Boolean))].filter((path) => !text.includes(path));
}
