// ───────────── Produits introuvables
// Un client cherche un produit qui n'est pas au catalogue : l'application lui demande lequel, et
// transmet sa demande à l'équipe. Ce fichier est partagé par l'écran et par le serveur : les mêmes
// textes par défaut, les mêmes limites, les mêmes étapes.

/**
 * Le message que lit le client. `enabled: false` : l'application ne propose pas d'envoyer de
 * demande. Chaque texte se règle dans la tour de contrôle (Introuvables › Message au client).
 */
export const DEFAULT_REQUEST_MESSAGE = {
  enabled: true,
  title: 'Vous ne trouvez pas votre produit ?',
  body: 'Dites-nous quel produit vous recherchez. Nous reviendrons vers vous dès qu’il sera disponible.',
  placeholder: 'Le produit que vous recherchez',
  button: 'Envoyer ma demande',
  thanks: 'Demande envoyée. Nous reviendrons vers vous dès que ce produit sera disponible.',
};

/** Longueur maximale de chaque texte, pour qu'il tienne sur l'écran d'un téléphone. */
export const REQUEST_MESSAGE_LIMITS = { title: 60, body: 220, placeholder: 40, button: 28, thanks: 220 };

const LABELS = { title: 'Titre', body: 'Message', placeholder: 'Texte du champ', button: 'Texte du bouton', thanks: 'Message de confirmation' };
const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

/** Lecture tolérante d'un message enregistré : ce qui manque reprend le texte par défaut. */
export function requestMessageOf(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { enabled: src.enabled !== false };
  for (const key of Object.keys(REQUEST_MESSAGE_LIMITS)) {
    const text = clean(src[key]).slice(0, REQUEST_MESSAGE_LIMITS[key]);
    out[key] = text || DEFAULT_REQUEST_MESSAGE[key];
  }
  return out;
}

/** Contrôle d'un message saisi. Le texte du champ est facultatif ; les autres sont attendus. */
export function validateRequestMessage(input) {
  const src = input && typeof input === 'object' ? input : {};
  const errors = {};
  const value = { enabled: src.enabled !== false };
  for (const key of Object.keys(REQUEST_MESSAGE_LIMITS)) {
    const text = clean(src[key]);
    const max = REQUEST_MESSAGE_LIMITS[key];
    if (!text && key !== 'placeholder') errors[key] = `${LABELS[key]} : écrivez le texte que le client lira.`;
    else if (text.length > max) errors[key] = `${LABELS[key]} : ${max} caractères au plus.`;
    value[key] = text || DEFAULT_REQUEST_MESSAGE[key];
  }
  return { errors, value };
}

/**
 * Étapes d'une demande, dans l'ordre où l'équipe la traite :
 *  - `nouvelle` : reçue, pas encore regardée ;
 *  - `etude`    : l'équipe cherche le produit, ou prépare sa fiche ;
 *  - `prevenu`  : le produit est disponible et le client a été prévenu — la promesse est tenue ;
 *  - `ecartee`  : demande non retenue (hors de notre offre, doublon, message sans objet).
 */
export const REQUEST_STATUSES = [
  { id: 'nouvelle', label: 'Nouvelle', detail: 'Reçue, pas encore regardée.', open: true },
  { id: 'etude', label: 'À l’étude', detail: 'Nous cherchons ce produit, ou préparons sa fiche.', open: true },
  { id: 'prevenu', label: 'Client prévenu', detail: 'Le produit est disponible et le client le sait.', open: false },
  { id: 'ecartee', label: 'Écartée', detail: 'Demande non retenue.', open: false },
];
export const isRequestStatus = (id) => REQUEST_STATUSES.some((s) => s.id === id);
export const requestStatusLabel = (id) => REQUEST_STATUSES.find((s) => s.id === id)?.label ?? 'Nouvelle';
/** Vrai tant qu'il reste quelque chose à faire pour cette demande. */
export const isRequestOpen = (id) => REQUEST_STATUSES.find((s) => s.id === id)?.open !== false;

/** « Papaye  solo » et « papaye solo » : la même demande. Sert à regrouper et à éviter les doublons. */
export const requestKey = (text) =>
  clean(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
