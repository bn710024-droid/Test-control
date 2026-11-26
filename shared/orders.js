/**
 * Règles communes aux commandes : parcours d'une demande professionnelle et messages au client.
 * Le même texte sert à l'administration (message WhatsApp ou e-mail pré-rempli) et au suivi publié
 * pour l'application d'achat. Aucun message ne contient de nom ni de montant.
 */
export function isSenegal(country, address) {
  const text = `${country ?? ''} ${address ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return String(country ?? '').trim().toUpperCase() === 'SN' || text.includes('senegal');
}

/**
 * Parcours d'une demande de grossiste ou d'importateur (B2B). Rien n'est payé dans l'application :
 * le client envoie son intérêt, l'équipe le contacte, puis fait avancer la demande jusqu'au
 * contrat et à la livraison. `status` : le statut correspondant dans l'application d'achat.
 */
export const PRO_STAGES = [
  { id: 'interet', label: 'Intérêt reçu', status: 'attente' },
  { id: 'contacte', label: 'Contacté', status: 'attente' },
  { id: 'discussion', label: 'En discussion', status: 'attente' },
  { id: 'contrat', label: 'Contrat conclu', status: 'confirmee' },
  { id: 'preparation', label: 'En préparation', status: 'preparation' },
  { id: 'livraison', label: 'En livraison', status: 'expediee' },
  { id: 'livree', label: 'Livrée', status: 'livree' },
  { id: 'annulee', label: 'Sans suite', status: 'annulee' },
];
const BY_STATUS = { attente: 'interet', confirmee: 'contrat', preparation: 'preparation', expediee: 'livraison', livree: 'livree', annulee: 'annulee' };

export const isProStage = (id) => PRO_STAGES.some((s) => s.id === id);
export const proStageFromStatus = (status) => BY_STATUS[status] ?? 'interet';
/** Étape d'une demande professionnelle ; les demandes d'avant ce parcours la déduisent de leur statut. */
export const proStageOf = (order) => (isProStage(order?.stage) ? order.stage : proStageFromStatus(order?.status));
export const proStageLabel = (id) => PRO_STAGES.find((s) => s.id === id)?.label ?? '';
export const statusOfProStage = (id) => PRO_STAGES.find((s) => s.id === id)?.status ?? 'attente';

function proNotice(ref, stage) {
  switch (stage) {
    case 'interet':
      return { title: 'Demande reçue', message: `${ref} est bien arrivée chez nous. Notre équipe vous contacte pour en discuter. Rien n’est payé dans l’application.` };
    case 'contacte':
      return { title: 'Nous vous avons contacté', message: `Notre équipe vous a contacté au sujet de ${ref.replace('Votre', 'votre')}. Répondez-nous pour avancer ensemble.` };
    case 'discussion':
      return { title: 'Demande en discussion', message: `${ref} est en discussion avec notre équipe : quantités, prix, transport et paiement.` };
    case 'contrat':
      return { title: 'Contrat conclu', message: `${ref} est confirmée : le contrat est conclu. Nous préparons maintenant votre commande.` };
    case 'preparation':
      return { title: 'Commande en préparation', message: `${ref} est en préparation : calibrage, conditionnement, documents.` };
    case 'livraison':
      return { title: 'Commande en livraison', message: `${ref} est en route, selon les conditions convenues au contrat.` };
    case 'livree':
      return { title: 'Commande livrée', message: `${ref} est livrée. Merci de votre confiance !` };
    default:
      return { title: 'Demande classée sans suite', message: `${ref} est classée sans suite. Écrivez-nous pour la rouvrir.` };
  }
}

/** Message au client pour un statut (et, pour une demande professionnelle, pour une étape). */
/**
 * `abroad` : hors du Sénégal (transit par GP). `door` : le GP livre jusqu'au domicile (porte à
 * porte) au lieu de l'aéroport. `located` : le client a partagé la position de son téléphone.
 */
export function clientNotice({ reference, type, abroad, airport, door, located }, status, stage) {
  const what = type === 'pro' ? 'demande' : 'commande';
  const ref = `Votre ${what} ${reference}`;
  if (type === 'pro') return proNotice(ref, isProStage(stage) ? stage : proStageFromStatus(status));
  switch (status) {
    case 'attente':
      return { title: 'Commande reçue', message: `${ref} est bien arrivée chez nous. Elle sera confirmée dès que votre paiement sera reçu.` };
    case 'confirmee':
      return {
        title: 'Commande confirmée',
        message: `${ref} est confirmée : nous avons bien reçu votre paiement. ${
          abroad
            ? 'Nous préparons maintenant sa livraison.'
            : located
              ? 'Notre livreur vous l’apportera à l’endroit indiqué par votre téléphone.'
              : 'Notre livreur vous l’apportera à votre adresse.'
        }`,
      };
    case 'preparation':
      return { title: 'Commande en préparation', message: `${ref} est en préparation.` };
    case 'expediee':
      return {
        title: 'Commande en livraison',
        message: abroad
          ? door
            ? `${ref} est en route : notre GP vous la remet à votre domicile.`
            : `${ref} est en route vers l’aéroport d’arrivée${airport ? `, ${airport}` : ''}. Vous la récupérez à l’aéroport ; la suite du trajet est à votre charge.`
          : `${ref} est en livraison : notre livreur à moto est en route vers vous. Gardez votre téléphone à portée, il peut vous appeler.`,
      };
    case 'livree':
      return {
        title: 'Commande reçue',
        message: abroad && !door ? `${ref} a bien été récupérée à l’aéroport d’arrivée. Merci de votre confiance !` : `Vous avez bien reçu votre ${what} ${reference}. Merci de votre confiance, et bonne dégustation !`,
      };
    default:
      return { title: 'Commande annulée', message: `${ref} est annulée. Écrivez-nous pour toute question.` };
  }
}

// ───────────── Annonces du bandeau d'accueil : durée d'affichage
/**
 * État d'une annonce à un instant donné :
 *  - `off`       : désactivée par l'équipe ;
 *  - `scheduled` : activée, mais son début n'est pas encore arrivé ;
 *  - `live`      : affichée aux clients ;
 *  - `ended`     : sa durée est écoulée — elle n'est plus affichée, sans rien avoir à faire.
 */
export function annonceState(row, now = Date.now()) {
  if (!row || row.published !== true) return 'off';
  const start = row.data?.starts_at ? new Date(row.data.starts_at).getTime() : null;
  const end = row.data?.ends_at ? new Date(row.data.ends_at).getTime() : null;
  if (end !== null && Number.isFinite(end) && end <= now) return 'ended';
  if (start !== null && Number.isFinite(start) && start > now) return 'scheduled';
  return 'live';
}
