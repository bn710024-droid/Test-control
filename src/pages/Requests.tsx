import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { Choice, RuleRow } from '../components/CountryPrices';
import { Phone, Workbench } from '../components/Preview';
import { Chip, EmptyState, ErrorPanel, Field, GhostButton, Notice, Page, PageHeader, PrimaryButton, Sheet, SkeletonRows, Switch, TextArea } from '../components/ui';
import { ApiError, api, messageOf } from '../lib/api';
import { MONTHS, ago, plural } from '../lib/format';
import { cx } from '../lib/ui';
import {
  DEFAULT_REQUEST_MESSAGE,
  REQUEST_MESSAGE_LIMITS,
  REQUEST_STATUSES,
  isRequestOpen,
  requestKey,
  requestMessageOf,
  requestStatusLabel,
  validateRequestMessage,
  type ProductRequest,
  type RequestMessage,
  type RequestMessageKey,
  type RequestStatus,
} from '../../shared/requests.js';

// ───────────── Produits introuvables
// Un client a cherché un produit qui n'est pas au catalogue et nous l'a demandé. Cet écran réunit
// le message qu'il lit dans l'application, et les demandes reçues, à traiter une par une.

type Filter = 'ouvertes' | 'traitees' | 'toutes';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ouvertes', label: 'À traiter' },
  { value: 'traitees', label: 'Traitées' },
  { value: 'toutes', label: 'Toutes' },
];
const STATUS_TONE: Record<RequestStatus, 'star' | 'leaf' | 'neutral'> = { nouvelle: 'star', etude: 'leaf', prevenu: 'neutral', ecartee: 'neutral' };
const contactLink = 'press inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-[13.5px] font-bold';
const waLink = (number: string, text: string) => `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

/** « 26 novembre à 13h02 » */
function when(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTHS[d.getMonth()]} à ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
}
const who = (r: ProductRequest) => r.customer.company || r.customer.name || 'Client sans nom';

export default function Requests() {
  const { canEdit } = useAuth();
  const { settings, saveRequestMessage } = useData();
  const toast = useToast();
  const [requests, setRequests] = useState<ProductRequest[]>([]);
  const [scope, setScope] = useState<'all' | 'none'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ouvertes');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState(false);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const out = await api<{ requests: ProductRequest[]; scope: 'all' | 'none' }>('/api/orders?vue=introuvables');
      setRequests(out.requests);
      setScope(out.scope);
      setError(null);
    } catch (err) {
      if (!quiet) setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const message = useMemo(() => requestMessageOf(settings?.missing), [settings]);
  const open = requests.filter((r) => isRequestOpen(r.status));
  const fresh = requests.filter((r) => r.status === 'nouvelle').length;
  const list = filter === 'ouvertes' ? open : filter === 'traitees' ? requests.filter((r) => !isRequestOpen(r.status)) : requests;
  const count = (f: Filter) => (f === 'ouvertes' ? open.length : f === 'traitees' ? requests.length - open.length : requests.length);
  // Le même produit demandé par plusieurs clients : un signal pour le catalogue.
  const asked = useMemo(() => {
    const groups = new Map<string, { label: string; n: number }>();
    for (const r of requests.filter((x) => isRequestOpen(x.status))) {
      const key = requestKey(r.product);
      const g = groups.get(key);
      if (g) g.n += 1;
      else groups.set(key, { label: r.product, n: 1 });
    }
    return [...groups.values()].filter((g) => g.n > 1).sort((a, b) => b.n - a.n).slice(0, 8);
  }, [requests]);
  const current = requests.find((r) => r.id === openId) ?? null;

  /** Mode visite : rien n'est envoyé au serveur, qui refuserait de toute façon. */
  const allowed = () => {
    if (canEdit) return true;
    toast('Mode visite, en lecture seule : connectez-vous pour modifier.', { tone: 'error' });
    return false;
  };

  const toggleMessage = async (enabled: boolean) => {
    if (!allowed()) return;
    setSwitching(true);
    try {
      await saveRequestMessage({ ...message, enabled });
      toast(enabled ? 'Message affiché : les clients peuvent envoyer leur demande' : 'Message désactivé : l’application ne propose plus d’envoyer de demande');
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Produits"
        accent="introuvables"
        subtitle={loading ? 'Lecture des demandes…' : requests.length === 0 ? 'Aucune demande reçue pour l’instant.' : `${plural(open.length, 'demande à traiter', 'demandes à traiter')}${fresh > 0 ? ` · ${plural(fresh, 'nouvelle', 'nouvelles')}` : ''}`}
      />

      <div className="px-5">
        <p className="px-1 text-[12px] font-extrabold uppercase leading-[17px] tracking-[0.07em] text-leaf" data-espace="introuvables">
          Recherche de l’application · quand un client ne trouve pas son produit
        </p>
        <p className="px-1 pt-1 text-[13px] leading-[19px] text-fg-dim">
          L’application lui demande quel produit il recherche et nous transmet sa demande. Vous réglez ici le message qu’il lit, puis vous traitez chaque demande : revenir vers lui dès que le produit est disponible.
        </p>
      </div>

      {/* Le message : une ligne. Le détail ne s'ouvre que sur « Modifier ». */}
      <div className="mx-5 mt-4" data-message={message.enabled ? 'affiche' : 'desactive'}>
        <RuleRow
          title="Message au client"
          summary={`« ${message.title} » ${message.body}`}
          chips={
            <>
              <Chip tone={message.enabled ? 'leaf' : 'neutral'}>{message.enabled ? 'Affiché dans l’application' : 'Désactivé'}</Chip>
              {!settings?.missing && <Chip>Textes d’origine</Chip>}
            </>
          }
          extra={<Switch checked={message.enabled} busy={switching} onChange={toggleMessage} label={`Message des produits introuvables : ${message.enabled ? 'affiché, toucher pour désactiver' : 'désactivé, toucher pour afficher'}`} />}
          onEdit={() => allowed() && setEditMessage(true)}
          editLabel="Modifier le message au client"
        />
      </div>

      {error ? (
        <ErrorPanel message={error} onRetry={() => load()} />
      ) : loading ? (
        <div className="pt-4">
          <SkeletonRows rows={3} />
        </div>
      ) : scope === 'none' ? (
        <EmptyState title="Demandes réservées à l’équipe" body="Elles portent le nom et le contact des clients : connectez-vous pour les lire." />
      ) : requests.length === 0 ? (
        <EmptyState
          title="Aucune demande pour l’instant"
          body="Dès qu’un client cherche un produit absent du catalogue et nous l’indique dans l’application, sa demande arrive ici, avec son nom et de quoi le recontacter."
        />
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2 px-5" role="radiogroup" aria-label="Demandes à afficher">
            {FILTERS.map((f) => {
              const on = filter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setFilter(f.value)}
                  className={cx('press flex h-11 items-center gap-1.5 rounded-full border px-4 text-[13.5px] transition-colors duration-200', on ? 'border-leaf bg-leaf font-extrabold text-on-leaf' : 'border-line bg-surface font-bold text-fg-dim')}
                >
                  {f.label}
                  <span className="tabular opacity-80">{count(f.value)}</span>
                </button>
              );
            })}
            <GhostButton compact className="ml-auto" label="Actualiser" onClick={() => load(true).then(() => toast('Demandes à jour'))} />
          </div>

          {asked.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 px-6 pt-3 text-[12.5px] leading-[18px] text-fg-dim" data-demandes="plus-demandes">
              <span className="font-bold">Les plus demandés :</span>
              {asked.map((g) => (
                <Chip key={g.label} tone="leaf">
                  {g.label} · {g.n}
                </Chip>
              ))}
            </p>
          )}

          {list.length === 0 ? (
            <p className="px-6 pt-5 text-[13.5px] leading-5 text-fg-dim">{filter === 'ouvertes' ? 'Tout est traité : aucune demande en attente.' : 'Aucune demande traitée pour l’instant.'}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2 px-5" data-demandes="liste">
              {list.map((r) => (
                <li key={r.id}>
                  <RuleRow
                    title={r.product}
                    summary={[who(r), r.customer.type === 'pro' ? 'Professionnel' : 'Particulier', r.country, ago(r.created_at)].filter(Boolean).join(' · ')}
                    chips={
                      <>
                        <Chip tone={STATUS_TONE[r.status] ?? 'neutral'}>{requestStatusLabel(r.status)}</Chip>
                        {r.note && <Chip>Note</Chip>}
                      </>
                    }
                    onEdit={() => setOpenId(r.id)}
                    editText={isRequestOpen(r.status) ? 'Traiter' : 'Ouvrir'}
                    editLabel={`${isRequestOpen(r.status) ? 'Traiter' : 'Ouvrir'} la demande : ${r.product}, de ${who(r)}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {!loading && !error && (
        <div className="mx-5 mt-6">
          <Notice tone="star" title="Dans l’application">
            L’application reliée à cette tour affiche ce message quand une recherche ne donne rien dans tout le catalogue, et envoie ici la demande du client, avec le pays de son compte.
            <span className="mt-2.5 flex flex-wrap gap-2.5">
              <a href="/branchement/LISEZ-MOI.txt" target="_blank" rel="noreferrer noopener" className="press flex min-h-11 items-center rounded-full border border-line-strong px-4 text-[13.5px] font-bold text-fg">
                Lire les instructions
              </a>
            </span>
          </Notice>
        </div>
      )}

      <RequestSheet
        request={current}
        onClose={() => setOpenId(null)}
        onChanged={(next) => setRequests((all) => all.map((r) => (r.id === next.id ? next : r)))}
        onRemoved={(id) => setRequests((all) => all.filter((r) => r.id !== id))}
        thanks={message.thanks}
      />
      <MessageBench open={editMessage} onClose={() => setEditMessage(false)} message={message} onSave={saveRequestMessage} />
    </Page>
  );
}

// ───────────── Fiche d'une demande : le client, de quoi le recontacter, l'étape, la note interne

function RequestSheet({ request: r, onClose, onChanged, onRemoved, thanks }: {
  request: ProductRequest | null;
  onClose: () => void;
  onChanged: (next: ProductRequest) => void;
  onRemoved: (id: string) => void;
  /** Ce que le client a lu après son envoi : rappelé à l'équipe, qui doit tenir cette promesse. */
  thanks: string;
}) {
  const { canEdit, isOwner } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<RequestStatus>('nouvelle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [noteError, setNoteError] = useState('');

  const key = r?.id ?? '';
  useEffect(() => {
    setStatus(r?.status ?? 'nouvelle');
    setNote(r?.note ?? '');
    setSure(false);
    setNoteError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const dirty = !!r && (status !== r.status || note.trim() !== r.note);
  const save = async () => {
    if (!r) return;
    setBusy(true);
    try {
      const next = await api<ProductRequest>('/api/orders', { method: 'PUT', body: { request: { id: r.id, status, note } } });
      onChanged(next);
      toast(status !== r.status ? `Demande « ${r.product} » : ${requestStatusLabel(status).toLowerCase()}` : 'Note enregistrée');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields?.note) setNoteError(err.fields.note);
      toast(`Non enregistré. ${messageOf(err)}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!r) return;
    setBusy(true);
    try {
      await api('/api/orders', { method: 'DELETE', body: { requestId: r.id } });
      onRemoved(r.id);
      toast('Demande supprimée');
      onClose();
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const c = r?.customer;
  const hello = r ? `Bonjour${c?.name ? ` ${c.name}` : ''}, vous nous aviez demandé « ${r.product} » dans l’application Tropicaura. ` : '';
  const phone = (c?.whatsapp || c?.phone || '').trim();

  return (
    <Sheet
      open={!!r}
      onClose={() => (busy ? undefined : onClose())}
      title="Produit recherché"
      footer={canEdit && r ? <PrimaryButton label={dirty ? 'Enregistrer' : 'Enregistré'} disabled={!dirty} loading={busy} onClick={save} /> : undefined}
    >
      {r && c && (
        <div data-demande={r.id}>
          <p className="break-words font-display text-[26px] font-semibold leading-8">{r.product}</p>
          {r.details && <p className="mt-2 whitespace-pre-line break-words text-[14.5px] leading-[21px] text-fg-dim">« {r.details} »</p>}
          <p className="mt-2 text-[12.5px] leading-[18px] text-fg-faint">
            Demandé le {when(r.created_at)}
            {r.status !== 'nouvelle' && ` · ${requestStatusLabel(r.status).toLowerCase()} depuis le ${when(r.status_at)}`}
          </p>

          <div className="mt-4 rounded-2xl bg-black/25 p-3.5">
            <p className="text-[12.5px] font-extrabold uppercase tracking-[0.08em] text-fg-faint">Le client</p>
            <p className="mt-1.5 break-words text-[15px] font-bold leading-5">{who(r)}</p>
            <p className="break-words text-[13px] leading-[19px] text-fg-dim">
              {[c.company && c.name ? c.name : '', c.type === 'pro' ? 'Professionnel' : 'Particulier', r.country].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-1 break-all text-[13px] leading-[19px] text-fg-dim">{[c.email, c.phone, c.whatsapp && c.whatsapp !== c.phone ? `WhatsApp ${c.whatsapp}` : ''].filter(Boolean).join(' · ')}</p>
            <div className="mt-2.5 flex flex-wrap gap-2.5">
              {/^(\+|00)/.test(phone) && (
                <a href={waLink(phone, hello)} target="_blank" rel="noreferrer noopener" className={cx(contactLink, 'border-leaf/50 text-leaf')}>
                  WhatsApp
                </a>
              )}
              {c.phone && (
                <a href={`tel:${c.phone.replace(/[^+\d]/g, '')}`} className={contactLink}>
                  Appeler
                </a>
              )}
              {c.email && (
                <a href={`mailto:${c.email}?subject=${encodeURIComponent(`Votre demande : ${r.product}`)}&body=${encodeURIComponent(hello)}`} className={contactLink}>
                  Écrire
                </a>
              )}
            </div>
            <p className="mt-2.5 text-[12.5px] leading-[18px] text-fg-faint">Après son envoi, il a lu : « {thanks} »</p>
          </div>

          <p className="mb-2 mt-5 text-[13px] font-semibold text-fg-dim">Où en est cette demande</p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Étape de la demande">
            {REQUEST_STATUSES.map((s) => {
              const on = status === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!canEdit}
                  onClick={() => setStatus(s.id)}
                  className={cx('press flex min-h-[52px] items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors duration-200', on ? 'border-leaf bg-leaf-wash' : 'border-line bg-surface')}
                >
                  <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', on ? 'border-leaf' : 'border-line-strong')}>{on && <span className="h-2.5 w-2.5 rounded-full bg-leaf" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-bold leading-5">{s.label}</span>
                    <span className="block text-[12.5px] leading-[17px] text-fg-dim">{s.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <TextArea
            label="Note interne"
            optional
            value={note}
            maxLength={600}
            disabled={!canEdit}
            className="!min-h-[92px]"
            placeholder="Fournisseur contacté, arrivage prévu en mai…"
            onValue={(v) => {
              setNote(v);
              setNoteError('');
            }}
            error={noteError || undefined}
            hint="Pour l’équipe seulement : le client ne la voit jamais."
          />

          <div className="mt-4 flex flex-wrap gap-2.5">
            <Link to={`/produits/nouveau?nom=${encodeURIComponent(r.product)}`} className={cx(contactLink, 'border-leaf/50 text-leaf')}>
              Créer la fiche de ce produit
            </Link>
            {isOwner && <GhostButton compact tone="danger" label={sure ? 'Confirmer la suppression' : 'Supprimer la demande'} disabled={busy} onClick={() => (sure ? remove() : setSure(true))} />}
          </div>
          {sure && <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">La demande et le contact du client seront effacés définitivement.</p>}
          {!canEdit && <p className="mt-4 text-[13px] leading-[19px] text-fg-dim">Mode visite : connectez-vous pour traiter cette demande.</p>}
        </div>
      )}
    </Sheet>
  );
}

// ───────────── Le message : réglage à gauche, écran du client à droite

const FIELD_LABEL: Record<RequestMessageKey, string> = {
  title: 'Titre',
  body: 'Message',
  placeholder: 'Texte du champ',
  button: 'Texte du bouton',
  thanks: 'Message de confirmation',
};

function MessageBench({ open, onClose, message, onSave }: { open: boolean; onClose: () => void; message: RequestMessage; onSave: (m: RequestMessage) => Promise<void> }) {
  const toast = useToast();
  const [form, setForm] = useState<RequestMessage>(message);
  const [errors, setErrors] = useState<Partial<Record<RequestMessageKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<'avant' | 'apres'>('avant');

  useEffect(() => {
    if (!open) return;
    setForm(message);
    setErrors({});
    setStage('avant');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (key: RequestMessageKey, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    // Le texte que l'on écrit se voit aussitôt du bon côté de l'aperçu.
    setStage(key === 'thanks' ? 'apres' : 'avant');
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(message);
  const isDefault = (Object.keys(REQUEST_MESSAGE_LIMITS) as RequestMessageKey[]).every((k) => form[k] === DEFAULT_REQUEST_MESSAGE[k]);

  const save = async () => {
    const checked = validateRequestMessage(form);
    setErrors(checked.errors);
    if (Object.keys(checked.errors).length > 0) return;
    setBusy(true);
    try {
      await onSave(checked.value);
      toast(checked.value.enabled ? 'Message enregistré : il s’affiche dans l’application' : 'Message enregistré, désactivé');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast(`Non enregistré. ${messageOf(err)}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const count = (key: RequestMessageKey) => `${form[key].trim().length} / ${REQUEST_MESSAGE_LIMITS[key]}`;

  return (
    <Workbench
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title="Message au client"
      preview={
        <>
          <div className="mx-auto mb-4 max-w-[340px]">
            <p className="label-voice mb-2 text-center text-[12px] text-fg-faint">Aperçu client</p>
            <Choice
              label="Moment montré dans l’aperçu"
              value={stage}
              onChange={setStage}
              options={[
                ['avant', 'Avant l’envoi'],
                ['apres', 'Après l’envoi'],
              ]}
            />
          </div>
          <Phone
            short
            caption={
              form.enabled
                ? stage === 'avant'
                  ? 'Ce que lit le client quand sa recherche ne donne rien. Sa recherche est déjà écrite dans le champ.'
                  : 'Ce qu’il lit une fois sa demande envoyée.'
                : 'Désactivé : la recherche dit seulement qu’il n’y a aucun résultat.'
            }
          >
            <MessagePreview message={form} sent={stage === 'apres'} />
          </Phone>
        </>
      }
      footer={
        <div className="flex items-center gap-3">
          <p className="hidden min-w-0 flex-1 text-[13px] leading-[18px] text-fg-dim sm:block">{dirty ? 'Modifications non enregistrées' : 'Tout est enregistré'}</p>
          <PrimaryButton label="Enregistrer" loading={busy} disabled={!dirty} onClick={save} className="shrink-0 sm:!w-auto sm:min-w-[260px]" />
        </div>
      }
    >
      <div className="card mx-5 p-[18px]">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-5">Proposer d’envoyer une demande</p>
            <p className="mt-0.5 text-[13px] leading-[18px] text-fg-dim">{form.enabled ? 'Affiché quand une recherche ne donne aucun résultat.' : 'Désactivé : l’application ne demande rien au client.'}</p>
          </div>
          <Switch checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} label="Proposer d’envoyer une demande" />
        </div>
      </div>

      <div className="card mx-5 mt-3.5 p-[18px]">
        <h3 className="font-display text-[19px] font-semibold leading-6">Avant l’envoi</h3>
        <p className="mt-1.5 text-[13.5px] leading-5 text-fg-dim">Ce qui demande au client quel produit il recherche.</p>
        <Field label={FIELD_LABEL.title} value={form.title} maxLength={REQUEST_MESSAGE_LIMITS.title} onValue={(v) => set('title', v)} error={errors.title} hint={count('title')} />
        <TextArea label={FIELD_LABEL.body} value={form.body} maxLength={REQUEST_MESSAGE_LIMITS.body} className="!min-h-[104px]" onValue={(v) => set('body', v)} error={errors.body} hint={`${count('body')} · dites-lui que vous reviendrez vers lui.`} />
        <Field label={FIELD_LABEL.placeholder} optional value={form.placeholder} maxLength={REQUEST_MESSAGE_LIMITS.placeholder} onValue={(v) => set('placeholder', v)} error={errors.placeholder} hint="Affiché dans le champ tant qu’il est vide." />
        <Field label={FIELD_LABEL.button} value={form.button} maxLength={REQUEST_MESSAGE_LIMITS.button} onValue={(v) => set('button', v)} error={errors.button} hint={count('button')} />
      </div>

      <div className="card mx-5 mt-3.5 p-[18px]">
        <h3 className="font-display text-[19px] font-semibold leading-6">Après l’envoi</h3>
        <p className="mt-1.5 text-[13.5px] leading-5 text-fg-dim">La confirmation : ce que vous lui promettez.</p>
        <TextArea label={FIELD_LABEL.thanks} value={form.thanks} maxLength={REQUEST_MESSAGE_LIMITS.thanks} className="!min-h-[104px]" onValue={(v) => set('thanks', v)} error={errors.thanks} hint={count('thanks')} />
      </div>

      {!isDefault && (
        <div className="mx-5 mt-4">
          <GhostButton compact label="Reprendre les textes d’origine" onClick={() => setForm((f) => ({ ...DEFAULT_REQUEST_MESSAGE, enabled: f.enabled }))} />
        </div>
      )}
    </Workbench>
  );
}

/** La recherche de l'application, sans résultat : le message, le champ, le bouton — puis la confirmation. */
function MessagePreview({ message: m, sent }: { message: RequestMessage; sent: boolean }) {
  const show = (key: RequestMessageKey) => m[key].trim() || DEFAULT_REQUEST_MESSAGE[key];
  return (
    <div className="px-4 pb-6" data-apercu="introuvable">
      <div className="flex h-10 items-center rounded-full border border-leaf/50 bg-surface px-3.5 text-[13px] font-semibold">papaye</div>
      <p className="mt-5 text-center font-display text-[18px] font-semibold leading-6">Aucun résultat</p>
      <p className="mt-1 text-center text-[12.5px] leading-[18px] text-fg-dim">Rien ne correspond à « papaye » dans le catalogue.</p>
      {m.enabled &&
        (sent ? (
          <div className="mt-5 rounded-[22px] border border-leaf/40 bg-leaf-wash p-4 text-center" data-apercu="merci">
            <span aria-hidden className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-leaf text-[18px] font-extrabold leading-none text-on-leaf">
              ✓
            </span>
            <p className="mt-2.5 break-words text-[13.5px] font-semibold leading-5">{show('thanks')}</p>
          </div>
        ) : (
          <div className="mt-5 rounded-[22px] border border-line bg-surface p-4" data-apercu="demande">
            <p className="break-words font-display text-[17px] font-semibold leading-[22px]">{show('title')}</p>
            <p className="mt-1.5 break-words text-[12.5px] leading-[18px] text-fg-dim">{show('body')}</p>
            <div className="mt-3 flex min-h-11 items-center rounded-2xl border border-line-strong bg-black/25 px-3.5 text-[13.5px] font-semibold">papaye</div>
            <p className="mt-1 px-1 text-[11px] leading-4 text-fg-faint">Champ vide : « {show('placeholder')} »</p>
            <div className="mt-3 flex min-h-11 items-center justify-center rounded-full bg-leaf px-4 text-center text-[13.5px] font-extrabold text-on-leaf">{show('button')}</div>
          </div>
        ))}
    </div>
  );
}
