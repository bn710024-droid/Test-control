import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  airplaneOutline,
  boatOutline,
  checkmarkCircle,
  cubeOutline,
  keyOutline,
  linkOutline,
  logOutOutline,
  refreshOutline,
  shieldCheckmarkOutline,
  warningOutline,
} from '../lib/glyphs';
import supabase from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { Icon } from '../components/Icon';
import { Chip, ConfirmSheet, ErrorPanel, Field, GhostButton, Notice, Page, PageHeader, PrimaryButton, Segmented, Sheet, SkeletonRows, Switch } from '../components/ui';
import { ApiError, api, messageOf } from '../lib/api';
import { ago, initials, kgText, numStr, parseNum, plural } from '../lib/format';
import { cx } from '../lib/ui';
import { DEFAULT_RULES, parseCatalog, validateRules, type Errors, type QuantityRules } from '../../shared/catalog.js';
import { PAYMENT_METHODS, paymentStates } from '../../shared/payments.js';

type Member = { user_id: string; email: string; provider: string; role: 'owner' | 'editor' | 'pending'; since: string | null };
type Credit = { id: string; title: string; artist: string; license: string; url: string };
type RulesForm = Record<string, string>;

const rulesToForm = (r: QuantityRules): RulesForm => ({
  'standard.minKg': numStr(r.standard.minKg),
  'standard.stepKg': numStr(r.standard.stepKg),
  'standard.maxKg': numStr(r.standard.maxKg),
  'avion.minKg': numStr(r.avion.minKg),
  'avion.stepKg': numStr(r.avion.stepKg),
  'avion.maxKg': numStr(r.avion.maxKg),
  'bateau.minContainers': numStr(r.bateau.minContainers),
  'bateau.stepContainers': numStr(r.bateau.stepContainers),
  'bateau.maxContainers': numStr(r.bateau.maxContainers),
  'bateau.containerKg': numStr(r.bateau.containerKg),
  'bateau.containerLabel': r.bateau.containerLabel ?? '',
});

const formToRules = (f: RulesForm) => ({
  standard: { minKg: parseNum(f['standard.minKg']), stepKg: parseNum(f['standard.stepKg']), maxKg: parseNum(f['standard.maxKg']) },
  avion: { minKg: parseNum(f['avion.minKg']), stepKg: parseNum(f['avion.stepKg']), maxKg: parseNum(f['avion.maxKg']) },
  bateau: {
    minContainers: parseNum(f['bateau.minContainers']),
    stepContainers: parseNum(f['bateau.stepContainers']),
    maxContainers: parseNum(f['bateau.maxContainers']),
    containerKg: parseNum(f['bateau.containerKg']),
    containerLabel: f['bateau.containerLabel'],
  },
});

function Block({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="card mx-5 mt-3.5 scroll-mt-24 p-[18px]">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-titre`} className="font-display text-[20px] font-semibold leading-[26px]">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

type Report =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | {
      state: 'done';
      accepted: boolean;
      updatedAt: string;
      example: boolean;
      published: number;
      kept: number;
      visible: number;
      retail: number;
      pro: number;
      unknown: number;
    };

export default function Settings() {
  const { user, access, isOwner, canEdit, signOut } = useAuth();
  const navigate = useNavigate();
  const { products, settings, loading, error, reload, pendingRefs, saveRules, saveLink, savePayments, sealRefs } = useData();
  const toast = useToast();
  const [params] = useSearchParams();
  const provider = access.status === 'ready' ? access.provider : 'email';

  // Arrivée depuis une tâche du tableau de bord : on amène la section demandée à l'écran.
  const section = params.get('section');
  useEffect(() => {
    if (!section || loading) return;
    const t = window.setTimeout(() => document.getElementById(section)?.scrollIntoView({ block: 'start' }), 120);
    return () => window.clearTimeout(t);
  }, [section, loading]);

  // ───── Règles de quantité
  const stored = settings?.rules ?? DEFAULT_RULES;
  const [rules, setRules] = useState<RulesForm>(() => rulesToForm(stored));
  const [ruleErrors, setRuleErrors] = useState<Errors>({});
  const [savingRules, setSavingRules] = useState(false);
  const storedKey = JSON.stringify(stored);
  useEffect(() => {
    setRules(rulesToForm(JSON.parse(storedKey)));
  }, [storedKey]);
  const rulesDirty = JSON.stringify(rules) !== JSON.stringify(rulesToForm(stored));

  const submitRules = async () => {
    const { errors, value } = validateRules(formToRules(rules));
    setRuleErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast(`${plural(Object.keys(errors).length, 'valeur à corriger', 'valeurs à corriger')}`, { tone: 'error' });
      return;
    }
    setSavingRules(true);
    try {
      await saveRules(value);
      toast('Règles de quantité enregistrées');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setRuleErrors(err.fields);
      toast(`Non enregistré. ${messageOf(err)}`, { tone: 'error' });
    } finally {
      setSavingRules(false);
    }
  };

  const ruleField = (path: string, label: string, suffix: string) => (
    <Field
      key={path}
      label={label}
      compact
      inputMode="numeric"
      suffix={suffix}
      disabled={!isOwner}
      value={rules[path] ?? ''}
      onValue={(v) => {
        setRules((r) => ({ ...r, [path]: v }));
        setRuleErrors((e) => (e[path] ? { ...e, [path]: '' } : e));
      }}
      error={ruleErrors[path] || undefined}
      className="pr-[46px]"
    />
  );

  // ───── Publication
  // Adresse lue par l'application (format de l'application, schema 2). Sans `?v=2` : format historique.
  const endpoint = `${window.location.origin}/api/catalog?v=2`;
  const [report, setReport] = useState<Report>({ state: 'idle' });
  const [linking, setLinking] = useState(false);

  const verify = async () => {
    setReport({ state: 'loading' });
    try {
      const res = await fetch(`/api/catalog?t=${Date.now()}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Le catalogue publié répond ${res.status}.`);
      const raw = (await res.json()) as { products?: unknown[]; example?: boolean; updatedAt?: string };
      const doc = parseCatalog(raw);
      const known = settings?.compat?.categoryIds ?? [];
      const shown = doc ? doc.products.filter((p) => p.available) : [];
      setReport({
        state: 'done',
        accepted: !!doc,
        updatedAt: raw.updatedAt ?? '',
        example: raw.example === true,
        published: Array.isArray(raw.products) ? raw.products.length : 0,
        kept: doc?.products.length ?? 0,
        visible: shown.length,
        retail: shown.filter((p) => p.retail && p.retail.price !== null).length,
        pro: shown.filter((p) => p.wholesale.some((o) => o.available)).length,
        unknown: shown.filter((p) => known.length > 0 && !known.includes(p.category)).length,
      });
    } catch (err) {
      setReport({ state: 'error', message: messageOf(err) });
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      toast('Adresse copiée');
    } catch {
      toast('Copie impossible : sélectionnez l’adresse à la main.', { tone: 'error' });
    }
  };

  const setLinked = async (appLinked: boolean) => {
    setLinking(true);
    try {
      await saveLink({ appLinked, note: appLinked ? 'Déclarée reliée depuis l’administration.' : 'Déclarée non reliée depuis l’administration.' });
      toast(appLinked ? 'Application déclarée reliée' : 'Application déclarée non reliée');
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setLinking(false);
    }
  };

  // ───── Moyens de paiement proposés aux particuliers
  const payStates = paymentStates(settings?.payments);
  const [paying, setPaying] = useState<string | null>(null);
  const setPayment = async (id: string, on: boolean) => {
    setPaying(id);
    try {
      await savePayments({ ...payStates, [id]: on });
      const name = PAYMENT_METHODS.find((m) => m.id === id)?.title ?? id;
      toast(on ? `${name} proposé aux clients` : `${name} retiré de l’application`);
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setPaying(null);
    }
  };

  // ───── Intégrité
  const [sealOpen, setSealOpen] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [refused, setRefused] = useState<{ ref: string; error: string }[]>([]);
  const seal = async () => {
    setSealing(true);
    try {
      const out = await sealRefs(pendingRefs.map((r) => r.ref));
      setRefused(out.refused);
      setSealOpen(false);
      toast(
        out.refused.length === 0
          ? `${plural(out.sealed.length, 'ligne validée', 'lignes validées')} : elles sont publiées`
          : `${plural(out.sealed.length, 'ligne validée', 'lignes validées')}, ${plural(out.refused.length, 'refusée', 'refusées')} (à corriger dans leur fiche)`,
        { tone: out.refused.length === 0 ? 'ok' : 'error' },
      );
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setSealing(false);
    }
  };

  // ───── Équipe
  const [team, setTeam] = useState<Member[] | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamBusy, setTeamBusy] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<Member | null>(null);
  const loadTeam = async () => {
    setTeamError(null);
    try {
      setTeam(await api<Member[]>('/api/team'));
    } catch (err) {
      setTeamError(messageOf(err));
    }
  };
  useEffect(() => {
    if (isOwner) loadTeam();
  }, [isOwner]);

  const changeRole = async (m: Member, role: 'owner' | 'editor') => {
    setTeamBusy(m.user_id);
    try {
      await api('/api/team', { method: 'PUT', body: { user_id: m.user_id, role } });
      toast(m.role === 'pending' ? `Accès accordé à ${m.email}` : `${m.email} : ${role === 'owner' ? 'responsable' : 'éditeur'}`);
      await loadTeam();
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setTeamBusy(null);
    }
  };
  const removeMember = async () => {
    if (!toRemove) return;
    setTeamBusy(toRemove.user_id);
    try {
      await api('/api/team', { method: 'DELETE', body: { user_id: toRemove.user_id } });
      toast(toRemove.role === 'pending' ? 'Demande refusée' : `Accès retiré à ${toRemove.email}`);
      setToRemove(null);
      await loadTeam();
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setTeamBusy(null);
    }
  };

  // ───── Mot de passe
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ a: '', b: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const changePassword = async () => {
    if (pw.a.length < 10) return setPwError('Dix caractères au moins.');
    if (pw.a !== pw.b) return setPwError('Les deux saisies ne sont pas identiques.');
    setPwBusy(true);
    setPwError(null);
    try {
      const { error: e } = await supabase.auth.updateUser({ password: pw.a });
      if (e) throw new Error(e.message.toLowerCase().includes('different') ? 'Choisissez un mot de passe différent de l’actuel.' : 'Le mot de passe n’a pas pu être changé. Réessayez.');
      toast('Mot de passe changé');
      setPwOpen(false);
      setPw({ a: '', b: '' });
    } catch (err) {
      setPwError(messageOf(err));
    } finally {
      setPwBusy(false);
    }
  };

  // ───── Crédits photo
  const [credits, setCredits] = useState<Credit[] | null>(null);
  const [creditsOpen, setCreditsOpen] = useState(false);
  useEffect(() => {
    if (!creditsOpen || credits) return;
    fetch('/produce/credits.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Credit[]) => setCredits(list))
      .catch(() => setCredits([]));
  }, [creditsOpen, credits]);

  const sealedCount = useMemo(() => products.filter((p) => p._seal === 'ok').length, [products]);
  const linked = settings?.link?.appLinked === true;
  const pendingMembers = team?.filter((m) => m.role === 'pending') ?? [];
  const members = team?.filter((m) => m.role !== 'pending') ?? [];

  return (
    <Page>
      <PageHeader title="Réglages" subtitle="Compte, publication, règles des offres et accès de l’équipe." />

      {/* ───── Compte */}
      <section className="card mx-5 flex items-center gap-3.5 p-4" aria-label="Mon compte">
        <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-leaf text-[16px] font-extrabold text-on-leaf">{user ? initials(user.email ?? '') : canEdit ? 'T' : 'V'}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15.5px] font-bold leading-5">{user?.email ?? (canEdit ? 'Accès ouvert' : 'Mode visite')}</p>
          <p className="mt-0.5 text-[13px] text-fg-dim">
            {canEdit && !user
              ? 'Phase de test : tout est modifiable, sans connexion.'
              : canEdit
              ? `${isOwner ? 'Responsable' : 'Éditeur'} · connexion par ${provider === 'google' ? 'Google' : 'e-mail'}`
              : 'Lecture seule : connectez-vous pour modifier le catalogue.'}
          </p>
        </div>
      </section>
      <div className="mx-5 mt-2.5 flex flex-wrap gap-2.5">
        {user && canEdit && provider !== 'google' && <GhostButton compact icon={keyOutline} label="Changer le mot de passe" onClick={() => setPwOpen(true)} />}
        {user ? (
          <GhostButton compact icon={logOutOutline} label="Se déconnecter" onClick={signOut} />
        ) : canEdit ? null : (
          <GhostButton compact tone="leaf" icon={keyOutline} label="Se connecter" onClick={() => navigate('/connexion')} />
        )}
      </div>

      {error ? (
        <ErrorPanel message={error} onRetry={reload} />
      ) : loading ? (
        <div className="pt-5">
          <SkeletonRows rows={4} />
        </div>
      ) : (
        <div className="lg:grid lg:grid-cols-2 lg:gap-x-2">
          <div className="min-w-0">
            {/* ───── Publication */}
            <Block id="publication" title="Publication" aside={<Chip tone={linked ? 'leaf' : 'neutral'} icon={linked ? checkmarkCircle : linkOutline}>{linked ? 'Reliée' : 'Non reliée'}</Chip>}>
              <p className="mt-2 text-[13.5px] leading-5 text-fg-dim">
                Chaque enregistrement met à jour le catalogue publié à cette adresse, au format attendu par l’application d’achat
                (lib/catalog/schema.ts, schema 2, adresse ?v=2).
              </p>
              <div className="mt-3 flex items-center gap-2 rounded-2xl border border-line bg-black/25 p-1.5 pl-3.5">
                <code className="min-w-0 flex-1 truncate text-[13px] text-fg">{endpoint}</code>
                <button type="button" onClick={copy} aria-label="Copier l’adresse du catalogue" className="press press-deep grid h-11 shrink-0 place-items-center rounded-full bg-surface-strong px-4 text-[13px] font-bold">
                  Copier
                </button>
              </div>

              <GhostButton className="mt-3 w-full" icon={refreshOutline} label="Vérifier le document publié" loading={report.state === 'loading'} onClick={verify} />
              {report.state === 'error' && (
                <p role="alert" className="mt-2.5 text-[13.5px] font-semibold leading-[19px] text-danger">
                  {report.message}
                </p>
              )}
              {report.state === 'done' && (
                <div className="mt-3 rounded-2xl bg-black/25 p-3.5" role="status">
                  <p className={cx('flex items-center gap-2 text-[14px] font-bold', report.accepted ? 'text-leaf' : 'text-star')}>
                    <Icon src={report.accepted ? checkmarkCircle : warningOutline} size={18} />
                    {report.accepted ? 'Document accepté par le lecteur de l’application' : 'Document refusé : l’application garderait son catalogue embarqué'}
                  </p>
                  <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                    {(
                      [
                        ['Produits publiés', report.published],
                        ['Conservés par l’application', report.kept],
                        ['Visibles', report.visible],
                        ['Proposés aux particuliers', report.retail],
                        ['Proposés aux professionnels', report.pro],
                        ['Rayon inconnu de l’app', report.unknown],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="flex items-baseline justify-between gap-2 border-b border-line py-1">
                        <dt className="min-w-0 truncate text-fg-dim">{k}</dt>
                        <dd className="tabular font-extrabold">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2.5 text-[12.5px] leading-[18px] text-fg-faint">
                    {report.example ? 'Marqué « données d’exemple » : au moins une fiche publiée n’a pas été vérifiée. ' : 'Aucune donnée d’exemple dans ce document. '}
                    {report.updatedAt ? `Dernière mise à jour ${ago(report.updatedAt)}.` : ''}
                    {!report.accepted && report.published === 0 ? ' Aucun produit validé n’est publié pour l’instant.' : ''}
                  </p>
                </div>
              )}

              <div className="mt-4 border-t border-line pt-4">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold leading-5">Application d’achat reliée</p>
                    <p className="mt-0.5 text-[13px] leading-[18px] text-fg-dim">
                      Déclaration manuelle : cette administration ne peut pas voir si l’application lit bien cette adresse.
                    </p>
                  </div>
                  <Switch checked={linked} onChange={setLinked} disabled={!isOwner} busy={linking} label="Application d’achat reliée" />
                </div>
                {/* Branchement : le correctif prêt à appliquer au dépôt de l'application mobile. */}
                <div className="mt-3 rounded-2xl bg-black/25 p-3.5">
                  <p className="text-[14.5px] font-bold leading-5">Brancher l’application mobile</p>
                  <p className="mt-1 text-[13px] leading-[19px] text-fg-dim">
                    L’application est un projet à part. Elle se relie à cette tour par une seule adresse, la variable{' '}
                    <code className="text-fg">EXPO_PUBLIC_CONTROL_TOWER_URL</code>. Ensuite, produits, prix, emballages, rayons, annonces, vidéos,
                    commandes, demandes et statuts s’y répercutent seuls, en une minute au plus. L’ancien correctif (git apply) ne s’applique plus
                    à l’application actuelle : ne l’utilisez pas.
                  </p>
                  <ol className="mt-2.5 list-decimal space-y-1 pl-5 text-[13px] leading-[19px] text-fg-dim">
                    <li>
                      Dans l’application, définir <code className="text-fg">EXPO_PUBLIC_CONTROL_TOWER_URL={window.location.origin}</code> (fichier
                      .env.local, variables Vercel pour le web, eas.json pour les téléphones).
                    </li>
                    <li>Republier l’application.</li>
                  </ol>
                  <div className="mt-3 flex flex-wrap gap-2.5">
                    <a href="/branchement/LISEZ-MOI.txt" target="_blank" rel="noreferrer noopener" className="press flex min-h-11 items-center rounded-full border border-line-strong px-4 text-[13.5px] font-bold">
                      Lire les instructions
                    </a>
                    <GhostButton
                      compact
                      label="Copier la consigne"
                      onClick={async () => {
                        const text = `Dans le dépôt de l’application TROPICAURA, définis EXPO_PUBLIC_CONTROL_TOWER_URL=${window.location.origin} (fichier .env.local en local, variables d’environnement Vercel pour le web, eas.json pour iOS et Android), lance npx tsc --noEmit, puis republie l’application. N’applique pas l’ancien correctif app-tropicaura.patch.`;
                        try {
                          await navigator.clipboard.writeText(text);
                          toast('Consigne copiée : collez-la dans le projet de l’application');
                        } catch {
                          toast('Copie impossible : ouvrez les instructions.', { tone: 'error' });
                        }
                      }}
                    />
                  </div>
                </div>
                {settings?.link?.note && <p className="mt-2.5 text-[12.5px] leading-[18px] text-fg-faint">Dernier état connu : {settings.link.note}</p>}
              </div>
            </Block>

            {/* ───── Intégrité */}
            <Block id="integrite" title="Validation des lignes" aside={<Chip tone={pendingRefs.length ? 'danger' : 'leaf'} icon={shieldCheckmarkOutline}>{pendingRefs.length ? `${pendingRefs.length} à valider` : 'Tout est validé'}</Chip>}>
              <p className="mt-2 text-[13.5px] leading-5 text-fg-dim">
                Seules les lignes écrites par cette administration sont publiées. Une ligne importée, ou modifiée directement dans la base, reste en attente jusqu’à
                ce qu’un responsable la valide. {sealedCount > 0 ? `${plural(sealedCount, 'fiche produit est validée', 'fiches produit sont validées')}.` : ''}
              </p>
              {pendingRefs.length > 0 && (
                <>
                  <ul className="mt-3 max-h-[220px] divide-y divide-line overflow-y-auto rounded-2xl bg-black/25 px-3.5">
                    {pendingRefs.map((r) => (
                      <li key={r.ref} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                        <span className="min-w-0 truncate font-semibold">{r.label}</span>
                        <span className={cx('shrink-0 text-[12px] font-bold', r.state === 'invalid' ? 'text-danger' : 'text-star')}>{r.state === 'invalid' ? 'modifiée hors administration' : 'jamais validée'}</span>
                      </li>
                    ))}
                  </ul>
                  {isOwner ? (
                    <PrimaryButton className="mt-3" icon={shieldCheckmarkOutline} label={`Valider ${plural(pendingRefs.length, 'ligne', 'lignes')}`} onClick={() => setSealOpen(true)} />
                  ) : (
                    <p className="mt-3 text-[13px] leading-[18px] text-fg-faint">Seul un responsable peut valider ces lignes en une fois. Vous pouvez valider une fiche produit en l’ouvrant et en l’enregistrant.</p>
                  )}
                </>
              )}
              {refused.length > 0 && (
                <div className="mt-3">
                  <Notice tone="danger" icon={warningOutline} title="Lignes refusées">
                    <ul className="list-disc space-y-1 pl-4">
                      {refused.map((r) => (
                        <li key={r.ref}>
                          <strong className="text-fg">{r.ref.split(':')[1]}</strong> — {r.error}
                        </li>
                      ))}
                    </ul>
                  </Notice>
                </div>
              )}
            </Block>
          </div>

          <div className="min-w-0">
            {/* ───── Moyens de paiement */}
            <Block id="paiements" title="Moyens de paiement">
              <p className="mt-2 text-[13.5px] leading-5 text-fg-dim">
                Moyens proposés aux particuliers à la validation de commande, publiés dans le catalogue. Aucun n’est encaissé par
                l’application : l’équipe pointe le paiement reçu dans Commandes.{!isOwner && ' Seul un responsable peut les modifier.'}
              </p>
              {PAYMENT_METHODS.map((m) => {
                const on = payStates[m.id];
                const last = on && Object.values(payStates).filter(Boolean).length === 1;
                return (
                  <div key={m.id} className="mt-4 border-t border-line pt-4">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-bold leading-5">{m.title}</p>
                        <p className="mt-0.5 text-[13px] leading-[18px] text-fg-dim">
                          {m.detail}
                          {last ? ' · dernier moyen proposé : il reste activé.' : ''}
                        </p>
                      </div>
                      <Switch
                        checked={on}
                        onChange={(v) => setPayment(m.id, v)}
                        disabled={!isOwner || last || (paying !== null && paying !== m.id)}
                        busy={paying === m.id}
                        label={m.title}
                      />
                    </div>
                  </div>
                );
              })}
            </Block>

            {/* ───── Règles de quantité */}
            <Block id="regles" title="Règles des offres pro">
              <p className="mt-2 text-[13.5px] leading-5 text-fg-dim">
                Règles générales, publiées dans le catalogue. Une offre peut avoir ses propres valeurs, réglées dans la fiche du produit.
                {!isOwner && ' Seul un responsable peut les modifier.'}
              </p>

              <h3 className="mt-5 flex items-center gap-2 text-[14.5px] font-bold">
                <Icon src={airplaneOutline} size={17} className="text-leaf" /> Avion — en kilos
              </h3>
              <div className="grid grid-cols-3 gap-2.5">
                {ruleField('avion.minKg', 'Minimum', 'kg')}
                {ruleField('avion.stepKg', 'Palier', 'kg')}
                {ruleField('avion.maxKg', 'Maximum', 'kg')}
              </div>

              <h3 className="mt-5 flex items-center gap-2 text-[14.5px] font-bold">
                <Icon src={boatOutline} size={17} className="text-leaf" /> Bateau — en conteneurs entiers
              </h3>
              <div className="grid grid-cols-3 gap-2.5">
                {ruleField('bateau.minContainers', 'Minimum', 'cont.')}
                {ruleField('bateau.stepContainers', 'Palier', 'cont.')}
                {ruleField('bateau.maxContainers', 'Maximum', 'cont.')}
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {ruleField('bateau.containerKg', 'Poids de référence', 'kg')}
                <Field
                  label="Précision"
                  compact
                  disabled={!isOwner}
                  maxLength={30}
                  value={rules['bateau.containerLabel'] ?? ''}
                  onValue={(v) => setRules((r) => ({ ...r, 'bateau.containerLabel': v }))}
                  error={ruleErrors['bateau.containerLabel'] || undefined}
                />
              </div>
              <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">
                Poids de référence d’un conteneur{stored.bateau.containerKg ? ` : ${kgText(stored.bateau.containerKg)} (${stored.bateau.containerLabel || 'sans précision'})` : ' non défini'}. Laissé vide, seul le nombre
                de conteneurs s’affiche et un prix au kilo ne donne aucun total.
              </p>

              <h3 className="mt-5 flex items-center gap-2 text-[14.5px] font-bold">
                <Icon src={cubeOutline} size={17} className="text-leaf" /> Offres sans mode — en kilos
              </h3>
              <div className="grid grid-cols-3 gap-2.5">
                {ruleField('standard.minKg', 'Minimum', 'kg')}
                {ruleField('standard.stepKg', 'Palier', 'kg')}
                {ruleField('standard.maxKg', 'Maximum', 'kg')}
              </div>

              {isOwner && (
                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <PrimaryButton className="!w-auto min-w-[200px] flex-1" label="Enregistrer les règles" disabled={!rulesDirty} loading={savingRules} onClick={submitRules} />
                  {rulesDirty && <GhostButton label="Annuler" onClick={() => { setRules(rulesToForm(stored)); setRuleErrors({}); }} />}
                </div>
              )}
              {rulesDirty && <p className="mt-2.5 text-center text-[12.5px] font-semibold text-star" role="status">Modifications non enregistrées</p>}
            </Block>

            {/* ───── Équipe */}
            {isOwner && (
              <Block id="equipe" title="Équipe et accès" aside={pendingMembers.length > 0 ? <Chip tone="star">{plural(pendingMembers.length, 'demande', 'demandes')}</Chip> : undefined}>
                <p className="mt-2 text-[13.5px] leading-5 text-fg-dim">
                  Un éditeur gère produits, prix et rayons. Un responsable gère en plus les règles, les accès, la validation et les suppressions définitives. Les droits
                  sont vérifiés par le serveur à chaque action.
                </p>
                {teamError ? (
                  <div className="-mx-5">
                    <ErrorPanel message={teamError} onRetry={loadTeam} />
                  </div>
                ) : !team ? (
                  <div className="mt-3 flex items-center gap-3 text-[13.5px] text-fg-dim" role="status">
                    <span className="spinner text-leaf" /> Lecture de l’équipe…
                  </div>
                ) : (
                  <>
                    {pendingMembers.map((m) => (
                      <div key={m.user_id} className="mt-3 rounded-2xl border border-star/30 bg-star-wash p-3.5">
                        <p className="truncate text-[14.5px] font-bold">{m.email}</p>
                        <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-dim">
                          Demande d’accès · {m.provider === 'google' ? 'adresse vérifiée par Google' : 'compte par e-mail : confirmez l’identité de la personne avant d’accepter'}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2.5">
                          <GhostButton compact tone="leaf" label="Accepter comme éditeur" loading={teamBusy === m.user_id} onClick={() => changeRole(m, 'editor')} />
                          <GhostButton compact tone="danger" label="Refuser" disabled={teamBusy === m.user_id} onClick={() => setToRemove(m)} />
                        </div>
                      </div>
                    ))}
                    <ul className="mt-3 flex flex-col gap-2.5">
                      {members.map((m) => {
                        const self = m.user_id === user?.id;
                        return (
                          <li key={m.user_id} className="rounded-2xl bg-black/25 p-3.5">
                            <p className="truncate text-[14.5px] font-bold">
                              {m.email} {self && <span className="font-medium text-fg-faint">· vous</span>}
                            </p>
                            <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                              <Segmented
                                label={`Rôle de ${m.email}`}
                                value={m.role as 'owner' | 'editor'}
                                onChange={(role) => changeRole(m, role)}
                                options={[
                                  { value: 'editor', label: 'Éditeur' },
                                  { value: 'owner', label: 'Responsable' },
                                ]}
                              />
                              <GhostButton compact tone="danger" label="Retirer l’accès" disabled={teamBusy === m.user_id} onClick={() => setToRemove(m)} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-3 text-[12.5px] leading-[18px] text-fg-faint">
                      Pour ajouter quelqu’un : la personne crée son compte sur l’écran de connexion, touche « Demander l’accès », puis sa demande apparaît ici.
                    </p>
                  </>
                )}
              </Block>
            )}

            {/* ───── Crédits */}
            <Block id="credits" title="Photos d’origine">
              <p className="mt-2 text-[13.5px] leading-5 text-fg-dim">
                Les photos détourées reprises de l’application proviennent de Wikimedia Commons. Leurs licences demandent de citer les auteurs.
              </p>
              <button type="button" onClick={() => setCreditsOpen((v) => !v)} aria-expanded={creditsOpen} className="press mt-1 flex min-h-11 items-center text-[13.5px] font-bold text-leaf">
                {creditsOpen ? 'Masquer les crédits' : 'Voir les crédits photo'}
              </button>
              {creditsOpen &&
                (credits === null ? (
                  <p className="text-[13px] text-fg-dim" role="status">Lecture des crédits…</p>
                ) : credits.length === 0 ? (
                  <p className="text-[13px] text-fg-dim">Crédits indisponibles pour le moment.</p>
                ) : (
                  <ul className="max-h-[300px] divide-y divide-line overflow-y-auto text-[12.5px] leading-[18px]">
                    {credits.map((c) => (
                      <li key={c.id} className="py-2">
                        <a href={c.url} target="_blank" rel="noreferrer noopener" className="font-bold text-fg underline decoration-line-strong underline-offset-2">
                          {c.id}
                        </a>{' '}
                        <span className="text-fg-dim">
                          — {c.artist} · {c.license}
                        </span>
                      </li>
                    ))}
                  </ul>
                ))}
            </Block>
          </div>
        </div>
      )}

      <ConfirmSheet open={sealOpen} onClose={() => setSealOpen(false)} title={`Valider ${plural(pendingRefs.length, 'ligne', 'lignes')} ?`} confirmLabel="Valider et publier" onConfirm={seal} busy={sealing}>
        <p>
          Vous confirmez que ces lignes peuvent être publiées telles qu’elles sont enregistrées aujourd’hui. Les lignes qui ne passent pas les contrôles de saisie
          seront refusées et devront être corrigées dans leur fiche.
        </p>
        <p className="mt-3">
          Si certaines vous semblent inconnues, annulez et ouvrez-les une à une : elles ont pu être écrites en dehors de l’administration.
        </p>
      </ConfirmSheet>

      <ConfirmSheet
        open={!!toRemove}
        onClose={() => setToRemove(null)}
        title={toRemove?.role === 'pending' ? 'Refuser cette demande ?' : 'Retirer cet accès ?'}
        confirmLabel={toRemove?.role === 'pending' ? 'Refuser la demande' : 'Retirer l’accès'}
        danger
        onConfirm={removeMember}
        busy={!!toRemove && teamBusy === toRemove.user_id}
      >
        <p>
          <strong className="text-fg">{toRemove?.email}</strong> {toRemove?.role === 'pending' ? 'n’obtiendra pas l’accès au catalogue.' : 'ne pourra plus rien modifier, dès sa prochaine action.'}
          {toRemove?.user_id === user?.id ? ' Il s’agit de votre propre compte.' : ''}
        </p>
      </ConfirmSheet>

      <Sheet
        open={pwOpen}
        onClose={() => !pwBusy && setPwOpen(false)}
        title="Changer le mot de passe"
        footer={<PrimaryButton label="Changer le mot de passe" loading={pwBusy} onClick={changePassword} />}
      >
        <Field label="Nouveau mot de passe" type="password" autoComplete="new-password" value={pw.a} onValue={(v) => setPw((p) => ({ ...p, a: v }))} hint="Dix caractères au moins." />
        <Field label="Encore une fois" type="password" autoComplete="new-password" value={pw.b} onValue={(v) => setPw((p) => ({ ...p, b: v }))} error={pwError ?? undefined} />
      </Sheet>
    </Page>
  );
}
