import { useState } from 'react';
import { hourglassOutline, keyOutline, logOutOutline, refreshOutline, shieldCheckmarkOutline } from '../lib/glyphs';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Backdrop, Wordmark } from '../components/Shell';
import { Icon } from '../components/Icon';
import { GhostButton, Notice, Page, PrimaryButton } from '../components/ui';
import { messageOf } from '../lib/api';

/** Compte connecté mais sans droit : on l'explique, et on propose la seule démarche possible. */
export default function NoAccess() {
  const { user, access, requestAccess, claimOwnership, refreshAccess, signOut } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<'request' | 'claim' | 'check' | null>(null);
  if (access.status !== 'ready') return null;
  const pending = access.role === 'pending';

  const run = async (kind: 'request' | 'claim' | 'check', fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative min-h-dvh">
      <Backdrop />
      <Page className="relative z-10 mx-auto w-full max-w-[480px] px-5 pb-10">
        <div style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 14px) + 14px)' }}>
          <Wordmark compact />
        </div>

        <h1 className="mt-10 font-display text-[30px] font-semibold leading-9">
          {pending ? 'Demande envoyée' : 'Accès non accordé'}
        </h1>
        <p className="mt-2.5 text-[15px] leading-[23px] text-fg-dim">
          {pending
            ? 'Un responsable doit valider votre demande. Vous pourrez ensuite gérer le catalogue avec ce compte.'
            : 'Vous êtes bien connecté, mais ce compte ne fait pas partie de l’équipe autorisée à gérer le catalogue.'}
        </p>
        <p className="mt-4 truncate rounded-2xl border border-line bg-surface px-4 py-3 text-[14.5px] font-bold">{user?.email}</p>

        {access.canClaim && (
          <div className="mt-6">
            <Notice tone="leaf" icon={shieldCheckmarkOutline} title="Première mise en service">
              Aucun responsable n’est encore désigné pour cette administration. Le premier compte qui le demande le devient ;
              cette possibilité disparaît aussitôt après.
            </Notice>
            <PrimaryButton
              label="Devenir responsable"
              className="mt-3"
              loading={busy === 'claim'}
              disabled={busy !== null}
              onClick={() => run('claim', claimOwnership)}
            />
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2.5">
          {!pending && !access.canClaim && (
            <PrimaryButton
              label="Demander l’accès"
              loading={busy === 'request'}
              disabled={busy !== null}
              onClick={() => run('request', requestAccess)}
            />
          )}
          {pending && (
            <GhostButton
              label="Vérifier à nouveau"
              icon={refreshOutline}
              loading={busy === 'check'}
              disabled={busy !== null}
              onClick={() => run('check', refreshAccess)}
            />
          )}
          <GhostButton label="Se déconnecter" icon={logOutOutline} onClick={signOut} disabled={busy !== null} />
        </div>
      </Page>
    </div>
  );
}
