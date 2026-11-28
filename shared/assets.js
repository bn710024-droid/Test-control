/**
 * Photos de produits fournies avec la tour (public/produce/<clé>.webp, vignette dans
 * public/produce/thumb/). Les mêmes clés que les photos embarquées dans l'application
 * (assets/produce/). La tour les affiche même quand la base n'a pas de réglage « compat »
 * (base neuve) : sans cette liste, chaque produit et chaque rayon restait « sans photo ».
 * Vérifiée par scripts/test-assets.mjs : chaque clé a son fichier et sa vignette.
 */
export const TOWER_ASSETS = [
  'abricot',
  'ail',
  'ananas',
  'ananas-seche',
  'avocat',
  'banane',
  'baobab',
  'basilic',
  'bissap',
  'brocoli',
  'carotte',
  'cerise',
  'choufleur',
  'citron',
  'citronvert',
  'concombre',
  'courgette',
  'figue',
  'fraise',
  'framboise',
  'gingembre',
  'grenade',
  'kaki',
  'kiwi',
  'mangue',
  'mangue-sechee',
  'melon',
  'myrtille',
  'oignon',
  'orange',
  'pamplemousse',
  'peche',
  'persil',
  'piment',
  'poire',
  'poivron',
  'pomme',
  'potimarron',
  'prune',
  'radis',
  'raisin',
  'tomate',
];

/** Photos connues : celles déclarées par l'application (`compat.embeddedAssets`) et celles de la tour. */
export function embeddedAssetsOf(compat) {
  const declared = Array.isArray(compat?.embeddedAssets) ? compat.embeddedAssets : [];
  return [...new Set([...declared, ...TOWER_ASSETS])];
}
