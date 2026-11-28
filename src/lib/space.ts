import { createContext, useContext } from 'react';

/**
 * Deux espaces séparés dans la tour : Particuliers ('b2c') et Grossistes et importateurs ('b2b').
 * Mêmes pages, données distinctes. L'espace se lit dans l'adresse (#/particuliers/… ou #/pros/…),
 * se mémorise sur l'appareil, et se transmet à chaque appel /api (`?espace=`).
 */
export type Space = 'b2c' | 'b2b';
export type SpaceSlug = 'particuliers' | 'pros';

export const SPACES: Record<Space, { slug: SpaceSlug; label: string; short: string; hint: string }> = {
  b2c: { slug: 'particuliers', label: 'Particuliers', short: 'Particuliers', hint: 'Produits emballés, prix en F CFA, € et $, commandes et livraison' },
  b2b: { slug: 'pros', label: 'Grossistes et importateurs', short: 'Pros', hint: 'Offres avion et bateau, EXW / FOB, demandes et programmes' },
};
export const spaceOfSlug = (slug: string | undefined): Space | null => (slug === 'particuliers' ? 'b2c' : slug === 'pros' ? 'b2b' : null);

const KEY = 'tour.espace';
export function rememberedSpace(): Space | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'b2c' || v === 'b2b' ? v : null;
  } catch {
    return null;
  }
}
export function rememberSpace(space: Space) {
  try {
    localStorage.setItem(KEY, space);
  } catch {
    // Stockage refusé (navigation privée) : le choix vaut pour cette visite.
  }
}

// Espace des appels /api : posé par le cadre de l'espace avant tout chargement de données.
let current: Space = 'b2c';
export function setApiSpace(space: Space) {
  current = space;
  // Accent de l'espace (vert Particuliers, or Pros) : voir src/index.css, [data-espace].
  if (typeof document !== 'undefined') document.documentElement.dataset.espace = space;
}
export const apiSpace = () => current;

const SPACED = /^\/api\/(products|categories|publications|settings|catalog)(?:[?#]|$)/;
/** Ajoute `espace=` aux routes dont les données dépendent de l'espace. */
export function withSpace(path: string) {
  if (!SPACED.test(path) || /[?&]espace=/.test(path)) return path;
  return `${path}${path.includes('?') ? '&' : '?'}espace=${current}`;
}

export type SpaceValue = { space: Space; slug: SpaceSlug; label: string; to: (path: string) => string };
export const SpaceContext = createContext<SpaceValue | null>(null);

/** Espace courant et chemins préfixés (`to('/produits')` → `/pros/produits`). */
export function useSpace(): SpaceValue {
  const v = useContext(SpaceContext);
  if (v) return v;
  const space = rememberedSpace() ?? 'b2c';
  const slug = SPACES[space].slug;
  return { space, slug, label: SPACES[space].label, to: (p) => `/${slug}${p === '/' ? '' : p}` };
}

/** Chemin dans l'espace ouvert, hors composant (`sp('/produits')` → `/pros/produits`). */
export const sp = (path: string) => `/${SPACES[current].slug}${path === '/' ? '' : path}`;
