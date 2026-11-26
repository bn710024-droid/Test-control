import { preflight, requireAdmin, readBody, listAccounts, setRole, log, serverError, maskEmail, isGuest } from './_lib.js';

/** Équipe et droits d'accès — réservé aux responsables. */
export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    const admin = await requireAdmin(req, res, { owner: true });
    if (!admin) return;

    const team = (await listAccounts()).filter((a) => a.role);

    if (req.method === 'GET') return res.status(200).json(isGuest(admin) ? team.map((a) => ({ ...a, email: maskEmail(a.email) })) : team);

    const body = readBody(req);
    const target = team.find((u) => u.user_id === body.user_id);
    if (!target) {
      return res.status(404).json({ error: 'Compte introuvable : la demande a peut-être été retirée.' });
    }
    const owners = team.filter((u) => u.role === 'owner');
    const lastOwner = target.role === 'owner' && owners.length === 1;

    if (req.method === 'PUT') {
      const role = body.role;
      if (role !== 'owner' && role !== 'editor') {
        return res.status(400).json({ error: 'Rôle inconnu : responsable ou éditeur.' });
      }
      if (lastOwner && role !== 'owner') {
        return res.status(409).json({
          error: 'Il doit rester au moins un responsable. Nommez-en un autre avant de changer ce rôle.',
        });
      }
      await setRole(target.user_id, role);
      const label = role === 'owner' ? 'responsable' : 'éditeur';
      await log(
        admin,
        'update',
        'team',
        target.user_id,
        target.role === 'pending' ? `Accès accordé (${label})` : `Changement de rôle : ${label}`,
      );
      return res.status(200).json({ ...target, role });
    }

    if (req.method === 'DELETE') {
      if (lastOwner) {
        return res.status(409).json({
          error: 'Impossible de retirer le dernier responsable : plus personne ne pourrait gérer les accès.',
        });
      }
      await setRole(target.user_id, null);
      await log(
        admin,
        'delete',
        'team',
        target.user_id,
        target.role === 'pending' ? 'Demande d’accès refusée' : 'Accès retiré',
      );
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}
