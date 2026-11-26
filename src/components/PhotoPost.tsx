import { useEffect, useRef, useState } from 'react';
import supabase from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useData, type Product } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { CategoryRound } from './catalog';
import { Field, GhostButton, PrimaryButton, Segmented, Switch, TextArea } from './ui';
import { Phone, Workbench } from './Preview';
import { ApiError, api, messageOf } from '../lib/api';
import { MONTHS } from '../lib/format';
import { cx } from '../lib/ui';
import { ReactionsPanel, type Stats } from './Reactions';

// ───────────── Publications photo : une à dix photos que le client fait défiler, et une description.
// Elles vivent dans l'espace « Publications » de l'application, avec les vidéos : rien n'y mène à un
// produit. Le lien vers un produit (`LinkPicker`, plus bas) est réservé aux annonces du bandeau.

export type Audience = 'tous' | 'particulier' | 'pro';
/** Ce qui se passe quand le client touche la publication. */
export type LinkMode = 'none' | 'button' | 'tap';
export type PhotoImage = { url: string; width: number; height: number };
export type PhotosData = {
  images: PhotoImage[];
  description: string;
  audience: Audience;
  publishedAt: string;
  demo?: boolean;
};
export type PhotosPub = { id: string; kind: 'photos'; data: PhotosData; published: boolean; sort_order: number; created_at?: string; updated_at: string; stats?: Stats; _seal?: 'ok' | 'missing' | 'invalid' };

export const MAX_PHOTOS = 10;
export const DEFAULT_BUTTON = 'Voir le produit';
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SOURCE = 25 * 1024 * 1024;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayText = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? `${d === 1 ? '1er' : d} ${MONTHS[m - 1]} ${y}` : '';
};

/** Une photo dans l'éditeur : déjà en ligne (`url` seule) ou tout juste choisie (`blob` à envoyer). */
export type Shot = { key: string; url: string; width: number; height: number; blob?: Blob };
let shotSeq = 0;
export const shotOf = (image: PhotoImage): Shot => ({ key: `en-ligne-${++shotSeq}`, ...image });

/** Lit une photo choisie et la ramène à 1 600 px de côté au plus : légère à envoyer, nette à l'écran. */
export function readPhoto(file: File, max = 1600): Promise<Shot> {
  return new Promise((resolve, reject) => {
    if (!PHOTO_TYPES.includes(file.type)) return reject(new Error(`« ${file.name} » : format non pris en charge. Choisissez une image JPEG, PNG ou WebP.`));
    if (file.size > MAX_SOURCE) return reject(new Error(`« ${file.name} » est trop lourde : 25 Mo au plus.`));
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error(`« ${file.name} » n’a pas pu être lue. Essayez un autre fichier.`));
    };
    image.onload = () => {
      const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight, 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      URL.revokeObjectURL(source);
      if (!ctx) return reject(new Error('Ce navigateur ne peut pas préparer la photo.'));
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const done = (blob: Blob | null) =>
        blob
          ? resolve({ key: `choisie-${++shotSeq}`, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, blob })
          : reject(new Error(`« ${file.name} » n’a pas pu être préparée.`));
      // WebP quand le navigateur sait l'écrire, JPEG sinon.
      canvas.toBlob((webp) => (webp && webp.type === 'image/webp' ? done(webp) : canvas.toBlob(done, 'image/jpeg', 0.88)), 'image/webp', 0.86);
    };
    image.src = source;
  });
}

/** Envoi direct d'une image vers le stockage, avec une autorisation à usage unique du serveur. */
export async function sendPhoto(blob: Blob) {
  const contentType = blob.type || 'image/jpeg';
  const { path, token, url } = await api<{ path: string; token: string; url: string }>('/api/publications', {
    method: 'POST',
    body: { action: 'upload-url', kind: 'photo', contentType },
  });
  const { error } = await supabase.storage.from('publications').uploadToSignedUrl(path, token, blob, { contentType });
  if (error) throw new Error('L’envoi de la photo a échoué. Vérifiez la connexion, puis réessayez.');
  return url;
}

// ───────────── Annonces : ce que fait un toucher — rien, un bouton, ou l'image elle-même

const LINK_CHOICES: { value: LinkMode; title: string; detail: string }[] = [
  { value: 'none', title: 'Rien : l’image seule', detail: 'Aucun bouton, aucun lien. L’image se suffit à elle-même.' },
  { value: 'button', title: 'Un bouton vers un produit', detail: 'Un bouton s’affiche ; il ouvre la fiche du produit choisi.' },
  { value: 'tap', title: 'Toucher l’image ouvre le produit', detail: 'Pas de bouton : toucher l’image mène directement à la fiche du produit.' },
];

export function LinkPicker({ link, productId, buttonLabel, onChange, products, errors, disabled }: {
  link: LinkMode;
  productId: string;
  buttonLabel: string;
  onChange: (patch: { link?: LinkMode; product_id?: string; button_label?: string }) => void;
  products: Product[];
  errors: Record<string, string>;
  disabled?: boolean;
}) {
  const { photoOf } = useData();
  return (
    <div>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Quand le client touche l’image">
        {LINK_CHOICES.map((c) => {
          const on = link === c.value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange({ link: c.value })}
              className={cx('press flex min-h-[52px] items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors duration-200', on ? 'border-leaf bg-leaf-wash' : 'border-line bg-surface')}
            >
              <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', on ? 'border-leaf' : 'border-line-strong')}>{on && <span className="h-2.5 w-2.5 rounded-full bg-leaf" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-bold leading-5">{c.title}</span>
                <span className="block text-[12.5px] leading-[17px] text-fg-dim">{c.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
      {link !== 'none' && (
        <>
          <p className="mb-1 mt-4 text-[13px] font-semibold text-fg-dim">Produit ouvert</p>
          <div className="no-scrollbar -mx-[18px] flex gap-1 overflow-x-auto px-3 pb-1" role="radiogroup" aria-label="Produit ouvert">
            {products.map((p) => (
              <CategoryRound key={p.id} src={photoOf(p)} ratio={p.photo_ratio} label={p.name} active={productId === p.id} onClick={() => onChange({ product_id: p.id })} />
            ))}
          </div>
          {errors.product_id && (
            <p role="alert" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
              {errors.product_id}
            </p>
          )}
        </>
      )}
      {link === 'button' && (
        <Field
          label="Texte du bouton"
          optional
          value={buttonLabel}
          maxLength={24}
          placeholder={DEFAULT_BUTTON}
          onValue={(v) => onChange({ button_label: v })}
          error={errors.button_label || undefined}
          hint={`Laissé vide : « ${DEFAULT_BUTTON} ».`}
        />
      )}
    </div>
  );
}

// ───────────── Aperçu : la publication telle que le client la fait défiler

export function PostPreview({ shots, description, date, focus }: {
  shots: { key: string; url: string; width: number; height: number }[];
  description: string;
  date: string;
  /** Photo à montrer (celle que l'on vient de choisir ou de déplacer). */
  focus?: number;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = shots.length;
  // Comme sur Instagram : la première photo donne son format à toute la publication.
  const ratio = count > 0 ? Math.max(0.8, Math.min(1.91, shots[0].width / Math.max(1, shots[0].height))) : 1;
  const go = (i: number, smooth = true) => {
    const el = strip.current;
    if (el) el.scrollTo({ left: Math.max(0, Math.min(count - 1, i)) * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  };
  useEffect(() => {
    if (focus !== undefined && focus >= 0) go(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, count]);
  const shown = Math.min(index, Math.max(0, count - 1));
  const arrow = 'press absolute top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center';
  const disc = 'grid h-7 w-7 place-items-center rounded-full bg-black/55 pb-0.5 text-[17px] font-bold leading-none text-fg backdrop-blur-sm';

  return (
    <div data-apercu="publication">
      <div className="flex items-center gap-2.5 px-4 pb-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-strong bg-surface">
          <img aria-hidden alt="" src="/decor/leaf.webp" className="h-4 w-4 object-contain" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-extrabold leading-[18px]">Tropicaura</span>
          <span className="block truncate text-[11px] leading-[15px] text-fg-faint">{dayText(date) || 'Date'}</span>
        </span>
      </div>

      <div className="relative bg-black/40" style={{ aspectRatio: String(ratio) }}>
        {count === 0 ? (
          <span className="absolute inset-3 grid place-items-center rounded-[20px] border border-dashed border-line-strong px-6 text-center text-[12px] font-bold uppercase leading-[18px] tracking-[0.08em] text-fg-faint">Vos photos s’affichent ici</span>
        ) : (
          <div
            ref={strip}
            className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
            onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
            role="group"
            aria-label={`Photos de la publication : ${count}. Faites défiler de côté.`}
            tabIndex={0}
            data-apercu="photos"
          >
            {shots.map((s, i) => (
              <img key={s.key} src={s.url} alt={`Photo ${i + 1} sur ${count}`} className="h-full w-full shrink-0 snap-center object-cover" draggable={false} />
            ))}
          </div>
        )}
        {count > 1 && (
          <>
            <span className="tabular absolute right-2.5 top-2.5 rounded-full bg-black/60 px-2.5 py-1 text-[11.5px] font-bold backdrop-blur-sm" data-apercu="compteur">
              {shown + 1}/{count}
            </span>
            {shown > 0 && (
              <button type="button" onClick={() => go(shown - 1)} aria-label="Photo précédente" className={cx(arrow, 'left-0')}>
                <span className={disc}>‹</span>
              </button>
            )}
            {shown < count - 1 && (
              <button type="button" onClick={() => go(shown + 1)} aria-label="Photo suivante" className={cx(arrow, 'right-0')}>
                <span className={disc}>›</span>
              </button>
            )}
          </>
        )}
      </div>

      {/* Ce que le client peut faire : aimer et commenter. Rien ne mène à un produit. */}
      <div aria-hidden className="flex items-center gap-2 px-4 pt-3" data-apercu="gestes">
        <span className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] font-bold text-fg-dim">
          <span className="text-[15px] leading-none">♡</span> J’aime
        </span>
        <span className="flex h-9 items-center rounded-full border border-line bg-surface px-3 text-[12.5px] font-bold text-fg-dim">Commenter</span>
      </div>

      {count > 1 && (
        <div className="flex justify-center gap-1 pt-2.5" aria-hidden>
          {shots.map((s, i) => (
            <span key={s.key} className={cx('h-[5px] rounded-full transition-all duration-300', i === shown ? 'w-4 bg-leaf' : 'w-[5px] bg-white/30')} />
          ))}
        </div>
      )}

      <p className="whitespace-pre-line break-words px-4 pb-6 pt-3 text-[13px] leading-[19.5px] text-fg-dim" data-apercu="description">
        <span className="font-extrabold text-fg">Tropicaura</span> {description.trim() || 'La description s’affiche ici, sous les photos.'}
      </p>
    </div>
  );
}

// ───────────── Fiche d'une publication photo

type Form = { description: string; audience: Audience; publishedAt: string; published: boolean };
const EMPTY: Form = { description: '', audience: 'tous', publishedAt: today(), published: true };

export function PhotoSheet({ target, onClose, onSaved }: {
  target: PhotosPub | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const isNew = target === 'new';
  const current = target && target !== 'new' ? target : null;
  const [form, setForm] = useState<Form>(EMPTY);
  const [shots, setShots] = useState<Shot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Adresses locales créées pour l'affichage : libérées à la fermeture.
  const local = useRef<string[]>([]);

  const key = target === 'new' ? 'new' : (target?.id ?? '');
  useEffect(() => {
    local.current.forEach((u) => URL.revokeObjectURL(u));
    local.current = [];
    setErrors({});
    setSure(false);
    setStep(null);
    setSelected(null);
    setShots(current ? current.data.images.map(shotOf) : []);
    setForm(
      current
        ? { description: current.data.description, audience: current.data.audience, publishedAt: current.data.publishedAt, published: current.published }
        : { ...EMPTY, publishedAt: today() },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const pick = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (fileInput.current) fileInput.current.value = '';
    if (list.length === 0) return;
    const room = MAX_PHOTOS - shots.length;
    const problems: string[] = [];
    if (list.length > room) problems.push(`${MAX_PHOTOS} photos au plus : ${room > 0 ? `seules les ${room} premières sont ajoutées` : 'retirez-en une pour en ajouter'}.`);
    setReading(true);
    const added: Shot[] = [];
    for (const file of list.slice(0, Math.max(0, room))) {
      try {
        const shot = await readPhoto(file);
        local.current.push(shot.url);
        added.push(shot);
      } catch (err) {
        problems.push(messageOf(err));
      }
    }
    setReading(false);
    if (added.length > 0) {
      setShots((s) => [...s, ...added]);
      setSelected(added[0].key);
    }
    setErrors((e) => ({ ...e, images: problems.join(' ') }));
  };

  const at = shots.findIndex((s) => s.key === selected);
  const moveShot = (delta: -1 | 1) => {
    const to = at + delta;
    if (at < 0 || to < 0 || to >= shots.length) return;
    setShots((s) => {
      const next = [...s];
      [next[at], next[to]] = [next[to], next[at]];
      return next;
    });
  };
  const removeShot = () => {
    if (at < 0) return;
    setShots((s) => s.filter((x) => x.key !== selected));
    setSelected(shots[at + 1]?.key ?? shots[at - 1]?.key ?? null);
  };

  const save = async () => {
    const found: Record<string, string> = {};
    if (shots.length === 0) found.images = 'Ajoutez au moins une photo.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      const images: PhotoImage[] = [];
      const fresh = shots.filter((s) => s.blob).length;
      let sent = 0;
      for (const s of shots) {
        if (s.blob) {
          setStep(`Envoi de la photo ${++sent} sur ${fresh}…`);
          images.push({ url: await sendPhoto(s.blob), width: s.width, height: s.height });
        } else images.push({ url: s.url, width: s.width, height: s.height });
      }
      setStep('Enregistrement…');
      const data = { images, description: form.description, audience: form.audience, publishedAt: form.publishedAt };
      if (current) await api('/api/publications', { method: 'PUT', body: { id: current.id, data, published: form.published } });
      else await api('/api/publications', { method: 'POST', body: { kind: 'photos', data, published: form.published } });
      toast(form.published ? `Publication en ligne · ${images.length} photo${images.length > 1 ? 's' : ''}` : 'Publication enregistrée en brouillon');
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast(`Non enregistré. ${messageOf(err)}`, { tone: 'error' });
    } finally {
      setStep(null);
    }
  };

  const remove = async () => {
    if (!current) return;
    setStep('Suppression…');
    try {
      await api('/api/publications', { method: 'DELETE', body: { id: current.id } });
      toast('Publication supprimée, avec ses photos');
      onSaved();
      onClose();
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setStep(null);
    }
  };

  const caption =
    shots.length === 0
      ? 'Ajoutez vos photos : le client les fait défiler de côté, la description reste dessous.'
      : 'Dans l’application : Favoris › Publications › Photos. Le client peut aimer et commenter ; rien ne mène à un produit.';
  const tile = 'press relative aspect-square overflow-hidden rounded-2xl border-2';

  return (
    <Workbench
      open={!!target}
      onClose={() => (step ? undefined : onClose())}
      title={isNew ? 'Nouvelle publication photo' : 'Publication photo'}
      preview={
        <Phone caption={caption}>
          <PostPreview shots={shots} description={form.description} date={form.publishedAt} focus={at >= 0 ? at : undefined} />
        </Phone>
      }
      footer={
        canEdit ? (
          <div className="flex items-center gap-3">
            <p className="hidden min-w-0 flex-1 text-[13px] leading-[18px] text-fg-dim sm:block">{form.published ? 'Visible dès l’enregistrement.' : 'Brouillon : enregistrée, mais pas publiée.'}</p>
            <PrimaryButton label={isNew ? (form.published ? 'Publier' : 'Enregistrer le brouillon') : 'Enregistrer'} loading={!!step} loadingLabel={step ?? ''} onClick={save} className="shrink-0 sm:!w-auto sm:min-w-[260px]" />
          </div>
        ) : undefined
      }
    >
      <div className="card mx-5 p-[18px]">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display text-[19px] font-semibold leading-6">Photos</h3>
          <span className="tabular text-[12.5px] font-bold text-fg-dim">
            {shots.length} / {MAX_PHOTOS}
          </span>
        </div>
        <p className="mt-1.5 text-[13.5px] leading-5 text-fg-dim">Vos propres images, dans l’ordre où le client les fait défiler. La première sert de couverture et donne son format aux autres.</p>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="Photos de la publication">
          {shots.map((s, i) => (
            <button key={s.key} type="button" onClick={() => setSelected(s.key)} aria-pressed={selected === s.key} aria-label={`Photo ${i + 1} sur ${shots.length}${selected === s.key ? ', sélectionnée' : ''}`} className={cx(tile, selected === s.key ? 'border-leaf' : 'border-transparent')}>
              <img src={s.url} alt="" className="h-full w-full object-cover" />
              <span className="tabular absolute left-1.5 top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-black/65 px-1.5 text-[11.5px] font-extrabold">{i + 1}</span>
              {s.blob && <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] font-bold uppercase tracking-[0.06em] text-leaf">À envoyer</span>}
            </button>
          ))}
          {shots.length < MAX_PHOTOS && canEdit && (
            <button type="button" onClick={() => fileInput.current?.click()} disabled={reading || !!step} className={cx(tile, 'flex flex-col items-center justify-center gap-1 border-dashed border-line-strong bg-white/[0.03]')}>
              {reading ? <span className="spinner text-leaf" /> : <span className="text-[26px] font-bold leading-none text-leaf">+</span>}
              <span className="px-1 text-center text-[11.5px] font-bold leading-[14px]">{reading ? 'Lecture…' : shots.length === 0 ? 'Choisir des photos' : 'Ajouter'}</span>
            </button>
          )}
        </div>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" tabIndex={-1} aria-label="Choisir des photos" onChange={(e) => pick(e.target.files)} />
        {errors.images && (
          <p role="alert" className="mt-2.5 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
            {errors.images}
          </p>
        )}
        {at >= 0 && canEdit ? (
          <div className="mt-3 rounded-2xl bg-black/25 p-3">
            <p className="text-[13px] font-semibold text-fg-dim">
              Photo {at + 1} sur {shots.length}
              {at === 0 ? ' · couverture' : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <GhostButton compact label="← Plus tôt" disabled={at === 0} onClick={() => moveShot(-1)} />
              <GhostButton compact label="Plus tard →" disabled={at === shots.length - 1} onClick={() => moveShot(1)} />
              <GhostButton compact tone="danger" label="Retirer" onClick={removeShot} />
            </div>
          </div>
        ) : (
          <p className="mt-2.5 px-1 text-[12.5px] leading-[18px] text-fg-faint">JPEG, PNG ou WebP · {MAX_PHOTOS} photos au plus. Touchez une photo pour la déplacer ou la retirer.</p>
        )}
        <TextArea label="Description" optional value={form.description} maxLength={600} className="!min-h-[120px]" placeholder="La campagne de mangue Kent commence : premiers cartons expédiés cette semaine." onValue={(v) => setForm((f) => ({ ...f, description: v }))} error={errors.description || undefined} hint={`${form.description.trim().length} / 600 · affichée sous les photos`} />
      </div>

      <div className="card mx-5 mt-3.5 p-[18px]">
        <h3 className="font-display text-[19px] font-semibold leading-6">Diffusion</h3>
        <p className="mb-[7px] mt-3 text-[13px] font-semibold text-fg-dim">Visible par</p>
        <Segmented
          label="Public de la publication"
          full
          value={form.audience}
          onChange={(v) => setForm((f) => ({ ...f, audience: v }))}
          options={[
            { value: 'tous', label: 'Tous' },
            { value: 'particulier', label: 'Particuliers' },
            { value: 'pro', label: 'Pros' },
          ]}
        />
        <Field label="Date affichée" type="date" value={form.publishedAt} onValue={(v) => setForm((f) => ({ ...f, publishedAt: v || today() }))} hint="Les publications sont classées de la plus récente à la plus ancienne." />
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-black/25 p-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-5">Publiée</p>
            <p className="mt-0.5 text-[13px] leading-[18px] text-fg-dim">{form.published ? 'Visible dès l’enregistrement.' : 'Brouillon : enregistrée, mais pas publiée.'}</p>
          </div>
          <Switch checked={form.published} onChange={(v) => setForm((f) => ({ ...f, published: v }))} label="Publication publiée" />
        </div>
      </div>

      {current && <ReactionsPanel id={current.id} className="mx-5 mt-3.5" />}

      {current && canEdit && (
        <div className="mx-5 mt-4">
          <GhostButton compact tone="danger" label={sure ? 'Confirmer la suppression' : 'Supprimer la publication'} disabled={!!step} onClick={() => (sure ? remove() : setSure(true))} />
          {sure && <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">La publication, ses photos et ses statistiques seront effacées définitivement.</p>}
        </div>
      )}
      {!canEdit && <p className="mx-5 mt-4 text-[13px] leading-[19px] text-fg-dim">Mode visite : connectez-vous pour modifier ou publier.</p>}
    </Workbench>
  );
}
