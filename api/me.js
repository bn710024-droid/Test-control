import { preflight, getUser, roleOf, listAccounts, setRole, log, readBody, serverError } from './_lib.js';

/**
 * GET  : qui suis-je, et ai-je le droit d'administrer ?
 * POST { action: 'request' } : demander l'accès (reste « pending » jusqu'à validation).
 * POST { action: 'claim' }   : première mise en service uniquement — tant qu'AUCUN responsable
 *                              n'existe, le compte connecté peut le devenir. La porte se referme
 *                              définitivement dès qu'un responsable est désigné.
 *
 * L'autorisation porte sur le compte lui-même (métadonnées écrites par le serveur), jamais sur
 * une adresse e-mail saisie : créer un compte avec l'adresse d'un administrateur ne donne rien.
 */
export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Session absente ou expirée. Reconnectez-vous.' });
    const provider = user.app_metadata?.provider ?? 'email';
    const role = roleOf(user);
    const me = { id: user.id, email: user.email ?? '', provider, role, canClaim: false };

    if (req.method === 'GET') {
      if (role !== 'owner' && role !== 'editor') {
        const accounts = await listAccounts();
        me.canClaim = !accounts.some((a) => a.role === 'owner');
      }
      return res.status(200).json(me);
    }

    if (req.method === 'POST') {
      const { action } = readBody(req);
      if (role === 'owner' || role === 'editor') return res.status(200).json(me);
      const accounts = await listAccounts();
      const hasOwner = accounts.some((a) => a.role === 'owner');

      if (action === 'claim') {
        if (hasOwner) {
          return res.status(409).json({
            error: 'Un responsable existe déjà : demandez-lui l’accès.',
          });
        }
        await setRole(user.id, 'owner');
        await log({ id: user.id }, 'update', 'team', user.id, 'Première mise en service : responsable désigné');
        return res.status(200).json({ ...me, role: 'owner' });
      }

      if (role === 'pending') return res.status(200).json({ ...me, canClaim: !hasOwner });
      if (accounts.filter((a) => a.role === 'pending').length >= 40) {
        return res.status(429).json({
          error: 'Trop de demandes sont déjà en attente. Contactez directement un responsable.',
        });
      }
      await setRole(user.id, 'pending');
      return res.status(201).json({ ...me, role: 'pending', canClaim: !hasOwner });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}
