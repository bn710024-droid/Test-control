import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import supabase from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useData, type Product } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { CategoryRound, ProductArt } from '../components/catalog';
import { Chip, EmptyState, ErrorPanel, Field, GhostButton, Notice, Page, PageHeader, PrimaryButton, RoundButton, Segmented, Sheet, SkeletonRows, Switch, TextArea } from '../components/ui';
import { ApiError, api, messageOf } from '../lib/api';
import { MONTHS, isInSeason, nextSeasonStart, plural } from '../lib/format';
import { add, arrowDown, arrowUp } from '../lib/glyphs';
import { cx, glow } from '../lib/ui';
import { HomePreview, ImageBanner, Phone, Workbench, type Slide } from '../components/Preview';
import { LinkPicker, PhotoSheet, readPhoto, sendPhoto, type LinkMode, type PhotosPub, type Shot } from '../components/PhotoPost';
import { ReactionsPanel, StatLine, type Stats } from '../components/Reactions';
import { annonceState, type AnnonceState } from '../../shared/orders.js';

type Audience = 'tous' | 'particulier' | 'pro';
type VideoData = { title: string; description: string; audience: Audience; publishedAt: string; durationSec: number; videoUrl: string; posterUrl: string; width: number; height: number; demo?: boolean };
type AnnonceData = {
  product_id: string;
  accent: string;
  body: string;
  demo?: boolean;
  starts_at?: string | null;
  ends_at?: string | null;
  /** Image de l'équipe à la place du modèle, et ce qui se passe quand on la touche. */
  image_url?: string;
  link?: LinkMode;
  button_label?: string;
};
type Base = { id: string; published: boolean; sort_order: number; updated_at: string; _seal?: 'ok' | 'missing' | 'invalid' };
type VideoPub = Base & { kind: 'video'; data: VideoData; stats?: Stats };
type AnnoncePub = Base & { kind: 'annonce'; data: AnnonceData };
type Pub = VideoPub | AnnoncePub | PhotosPub;
type View = 'videos' | 'photos' | 'annonces';

/** Une annonce a besoin d'un produit, sauf quand c'est une image seule, sans lien. */
const needsProduct = (d: AnnonceData) => !d.image_url || (d.link ?? 'button') !== 'none';
/** Le bandeau d'une annonce, ou `null` si elle ne peut pas s'afficher (produit retiré de la vente). */
function slideOf(a: AnnoncePub, byId: Map<string, Product>): Slide | null {
  const product = byId.get(a.data.product_id) ?? null;
  if (needsProduct(a.data) && (!product || !product.available || product.archived)) return null;
  return { key: a.id, product, accent: a.data.accent, body: a.data.body, image: a.data.image_url || null, link: a.data.link ?? 'button', buttonLabel: a.data.button_label };
}

const VIEW_TEXT: Record<View, { add: string; emptyTitle: string; emptyBody: string; where: string; intro: string }> = {
  videos: {
    add: 'Publier une vidéo',
    emptyTitle: 'Aucune vidéo',
    emptyBody: 'Publiez la première vidéo de l’équipe. Tant qu’il n’y en a pas, l’application montre ses vidéos de démonstration.',
    where: 'Espace Publications de l’application · Favoris › Publications › Vidéos',
    intro: 'Les vidéos de l’équipe. Le client les regarde, les aime et les commente : rien n’y mène à un produit. Les statistiques de chaque vidéo sont sur sa carte et dans sa fiche.',
  },
  photos: {
    add: 'Publier des photos',
    emptyTitle: 'Aucune publication photo',
    emptyBody: 'Créez la première : une à dix de vos photos, que le client fait défiler de côté, avec une description dessous.',
    where: 'Espace Publications de l’application · Favoris › Publications › Photos',
    intro: 'Vos propres photos, que le client fait défiler de côté, avec une description dessous. Il peut les aimer et les commenter : rien n’y mène à un produit. Les statistiques de chaque publication sont sur sa carte et dans sa fiche.',
  },
  annonces: {
    add: 'Créer une annonce',
    emptyTitle: 'Aucune annonce',
    emptyBody: 'Créez la première annonce du bandeau d’accueil : avec le modèle, ou avec votre propre image.',
    where: 'Bandeau en haut de l’accueil de l’application',
    intro: 'À part des publications : une annonce ne s’affiche que dans le bandeau d’accueil, jamais dans l’espace Publications. C’est ici, et seulement ici, qu’un bouton ou une image peut mener à un produit. Vous fixez sa durée et pouvez la désactiver à tout moment. Pas de statistiques pour les annonces.',
  },
};

const AUDIENCE: Record<Audience, string> = { tous: 'Tous les clients', particulier: 'Particuliers', pro: 'Professionnels' };
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_VIDEO = 50 * 1024 * 1024;

const duration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1).replace('.', ',')}\u00A0Mo`;
const dayText = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? `${d === 1 ? '1er' : d} ${MONTHS[m - 1]} ${y}` : '';
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ───────────── Lecture d'une vidéo choisie : durée, dimensions, image d'aperçu

type Picked = { file: File; url: string; duration: number; width: number; height: number; poster: Blob | null; posterUrl: string | null };

function readVideo(file: File): Promise<Picked> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let done = false;
    const fail = () => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      reject(new Error('Cette vidéo n’est pas lisible par ce navigateur. Préférez un fichier MP4 (H.264).'));
    };
    const finish = (poster: Blob | null) => {
      if (done) return;
      done = true;
      resolve({
        file,
        url,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth,
        height: video.videoHeight,
        poster,
        posterUrl: poster ? URL.createObjectURL(poster) : null,
      });
    };
    // L'image d'aperçu est prise dans la vidéo elle-même, 720 px de côté au plus.
    const snap = () => {
      try {
        const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight, 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return finish(null);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob), 'image/webp', 0.82);
      } catch {
        finish(null);
      }
    };
    video.onerror = fail;
    video.onloadeddata = () => {
      const at = Math.min(0.8, (Number.isFinite(video.duration) ? video.duration : 1) * 0.25);
      if (at <= 0.05) return snap();
      video.onseeked = snap;
      video.currentTime = at;
    };
    window.setTimeout(() => (video.videoWidth ? finish(null) : fail()), 9000);
    video.src = url;
  });
}

/** Envoi direct d'un fichier vers le stockage, avec une autorisation à usage unique du serveur. */
async function upload(kind: 'video' | 'poster', blob: Blob, contentType: string) {
  const { path, token, url } = await api<{ path: string; token: string; url: string }>('/api/publications', {
    method: 'POST',
    body: { action: 'upload-url', kind, contentType },
  });
  const { error } = await supabase.storage.from('publications').uploadToSignedUrl(path, token, blob, { contentType });
  if (error) throw new Error(kind === 'video' ? 'L’envoi de la vidéo a échoué. Vérifiez la connexion, puis réessayez.' : 'L’envoi de l’aperçu a échoué. Réessayez.');
  return url;
}

// ───────────── Aperçu d'une annonce, aux cotes du bandeau d'accueil (components/HomeHero.tsx)

function HeroPreview({ product, accent, body, image, link, buttonLabel }: { product: Product | null; accent: string; body: string; image?: string | null; link?: LinkMode; buttonLabel?: string }) {
  if (image !== null && image !== undefined) {
    return (
      <div className="card-lit relative h-[236px] overflow-hidden" aria-hidden>
        <ImageBanner image={image} body={body} link={link ?? 'button'} buttonLabel={buttonLabel} large />
      </div>
    );
  }
  const months = product?.months ?? [];
  const kicker = !product
    ? 'Produit à choisir'
    : months.length === 0
      ? 'Saison à renseigner'
      : isInSeason(months)
        ? 'Campagne en cours'
        : `Campagne à venir · dès ${MONTHS[nextSeasonStart(months) - 1]}`;
  const name = product?.name ?? 'Produit';
  const article = /^[aeiouyéèêh]/i.test(name) ? 'l’' : name.endsWith('e') ? 'la ' : 'le ';
  return (
    <div className="card-lit relative h-[236px] overflow-hidden" aria-hidden>
      <span className="absolute -right-12 -top-6 h-[280px] w-[300px]" style={{ backgroundImage: glow(product?.tint ?? '#7AAA2C', 0.5) }} />
      {product && (
        <span className="float absolute -right-1 bottom-3">
          <ProductArt product={product} size={168} variant="full" halo={0} />
        </span>
      )}
      <div className="relative flex h-full max-w-[60%] flex-col justify-center pl-5">
        <span className="truncate text-[11.5px] font-extrabold uppercase leading-4 tracking-[0.13em] text-leaf">{kicker}</span>
        <span className="mt-2 block font-display text-[29px] font-semibold leading-[34px] tracking-[-0.01em]">
          <span className="block truncate">{name}</span>
          <span className="block truncate font-light italic text-[#DDD9C9]">{accent || '\u00A0'}</span>
        </span>
        <span className="mt-2 line-clamp-2 text-[13.5px] leading-[19px] text-fg-dim">{body || 'Texte de l’annonce'}</span>
        <span className="mt-3 flex min-h-10 w-fit max-w-full items-center gap-1.5 rounded-full border border-line-strong bg-white/[0.07] pl-[15px] pr-3 text-[13.5px] font-bold">
          <span className="truncate">Voir {article}{name.toLowerCase()}</span>
          <span className="text-leaf">›</span>
        </span>
      </div>
    </div>
  );
}

// ───────────── Durée d'affichage d'une annonce

const DAY = 86_400_000;
const DURATIONS = [
  { value: '1', label: '24 h' },
  { value: '3', label: '3 jours' },
  { value: '7', label: '7 jours' },
  { value: '15', label: '15 jours' },
  { value: '30', label: '30 jours' },
  { value: 'none', label: 'Sans limite' },
  { value: 'date', label: 'Jusqu’au…' },
] as const;
type DurationChoice = (typeof DURATIONS)[number]['value'] | 'keep';

/** « le 2 décembre à 14h05 » */
function whenText(iso: string) {
  const d = new Date(iso);
  return `le ${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTHS[d.getMonth()]} à ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Temps restant, en clair : « encore 3 jours », « encore 5 h », « encore 12 min ». */
function leftText(iso: string, now: number) {
  const ms = new Date(iso).getTime() - now;
  if (ms >= 2 * DAY) return `encore ${Math.floor(ms / DAY)} jours`;
  if (ms >= 2 * 3_600_000) return `encore ${Math.floor(ms / 3_600_000)} h`;
  return `encore ${Math.max(1, Math.round(ms / 60_000))} min`;
}

const STATE_TONE: Record<AnnonceState, 'leaf' | 'star' | 'neutral'> = { live: 'leaf', scheduled: 'star', ended: 'star', off: 'neutral' };
function stateText(a: AnnoncePub, now: number) {
  const state = annonceState(a, now);
  if (state === 'off') return 'Désactivée';
  if (state === 'ended') return `Terminée ${a.data.ends_at ? whenText(a.data.ends_at) : ''}`.trim();
  if (state === 'scheduled') return `Programmée ${a.data.starts_at ? whenText(a.data.starts_at) : ''}`.trim();
  return a.data.ends_at ? `En ligne · ${leftText(a.data.ends_at, now)}` : 'En ligne · sans limite';
}

/** L'heure courante, relue régulièrement : une annonce arrivée à son terme change d'état seule. */
function useNow(every = 20_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(id);
  }, [every]);
  return now;
}

/** `<input type="datetime-local">` attend l'heure locale, sans fuseau. */
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function StateChips({ pub }: { pub: Pub }) {
  return (
    <>
      <Chip tone={pub.published ? 'leaf' : 'neutral'}>{pub.published ? 'Publiée' : 'Brouillon'}</Chip>
      {pub._seal && pub._seal !== 'ok' && <Chip tone="danger">À valider</Chip>}
      {pub.data.demo && <Chip>Exemple de l’application</Chip>}
    </>
  );
}

// ───────────── Page

export default function Publications() {
  const { canEdit } = useAuth();
  const { products, photoOf } = useData();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const vue = params.get('vue');
  const view: View = vue === 'annonces' || vue === 'photos' ? vue : 'videos';

  const [items, setItems] = useState<Pub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editVideo, setEditVideo] = useState<VideoPub | 'new' | null>(null);
  const [editAnnonce, setEditAnnonce] = useState<AnnoncePub | 'new' | null>(null);
  const [editPhotos, setEditPhotos] = useState<PhotosPub | 'new' | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  // Une annonce tout juste mise en ligne compte aussitôt, sans attendre le prochain battement de l'horloge.
  const now = Math.max(useNow(), loadedAt);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setItems(await api<Pub[]>('/api/publications'));
      setLoadedAt(Date.now());
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

  const videos = useMemo(() => items.filter((p): p is VideoPub => p.kind === 'video').sort((a, b) => b.data.publishedAt.localeCompare(a.data.publishedAt)), [items]);
  const photos = useMemo(() => items.filter((p): p is PhotosPub => p.kind === 'photos').sort((a, b) => b.data.publishedAt.localeCompare(a.data.publishedAt) || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))), [items]);
  const annonces = useMemo(() => items.filter((p): p is AnnoncePub => p.kind === 'annonce').sort((a, b) => a.sort_order - b.sort_order), [items]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  /** Mode visite : rien n'est envoyé au serveur, qui refuserait de toute façon. */
  const allowed = () => {
    if (canEdit) return true;
    toast('Mode visite, en lecture seule : connectez-vous pour publier.', { tone: 'error' });
    return false;
  };

  const toggle = async (pub: Pub, published: boolean) => {
    if (!allowed()) return;
    setBusyId(pub.id);
    try {
      await api('/api/publications', { method: 'PUT', body: { id: pub.id, published } });
      toast(pub.kind === 'annonce' ? (published ? 'Annonce activée : elle s’affiche sur l’accueil' : 'Annonce désactivée : elle n’est plus affichée') : published ? 'Publiée' : 'Retirée de la publication, gardée en brouillon');
      await load(true);
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const move = async (index: number, delta: -1 | 1) => {
    if (!allowed()) return;
    const ids = annonces.map((a) => a.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusyId(annonces[index].id);
    try {
      await api('/api/publications', { method: 'PUT', body: { order: ids } });
      await load(true);
      toast(`Annonce placée en position ${target + 1}`);
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Adresse copiée');
    } catch {
      toast('Copie impossible : sélectionnez l’adresse à la main.', { tone: 'error' });
    }
  };

  const list: Pub[] = view === 'videos' ? videos : view === 'photos' ? photos : annonces;
  const live = view === 'annonces' ? annonces.filter((a) => annonceState(a, now) === 'live').length : list.filter((p) => p.published).length;
  const text = VIEW_TEXT[view];
  const openNew = () => (view === 'videos' ? setEditVideo('new') : view === 'photos' ? setEditPhotos('new') : setEditAnnonce('new'));
  const linkable = products.filter((p) => !p.archived && photoOf(p));
  // Ce que l'accueil de l'application montre en ce moment : les annonces en cours, dans l'ordre.
  const liveSlides: Slide[] = annonces.filter((a) => annonceState(a, now) === 'live').flatMap((a) => slideOf(a, byId) ?? []);
  const address = `${window.location.origin}/api/publications?public=${view}`;

  return (
    <Page>
      <PageHeader
        title="Publications"
        subtitle={loading ? 'Lecture des publications…' : view !== 'annonces' ? `${plural(live, 'publiée', 'publiées')} · ${plural(list.length - live, 'brouillon', 'brouillons')}` : live === 0 ? 'Aucune annonce en ligne : le bandeau n’apparaît pas chez les clients.' : `${plural(live, 'annonce en ligne', 'annonces en ligne')} sur ${list.length}`}
        right={
          <RoundButton
            icon={add}
            label={text.add}
            solid
            size={48}
            onClick={() => allowed() && openNew()}
          />
        }
      />

      <div className="px-5">
        <Segmented
          label="Type de publication"
          full
          value={view}
          onChange={(v) => setParams(v === 'videos' ? {} : { vue: v }, { replace: true })}
          options={[
            { value: 'videos', label: 'Vidéos' },
            { value: 'photos', label: 'Photos' },
            { value: 'annonces', label: 'Annonces' },
          ]}
        />
        <p className="px-1 pt-3 text-[12px] font-extrabold uppercase leading-[17px] tracking-[0.07em] text-leaf" data-espace={view}>
          {text.where}
        </p>
        <p className="px-1 pt-1 text-[13px] leading-[19px] text-fg-dim">{text.intro}</p>
      </div>

      <div className={cx(view === 'annonces' && !loading && !error && 'lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start')}>
      {view === 'annonces' && !loading && !error && (
        <aside className="px-5 pt-4 lg:sticky lg:top-24 lg:order-last lg:pl-0" aria-label="Aperçu de l’accueil chez les clients">
          <p className="label-voice mb-3 text-center text-[12px] text-fg-faint">Ce que voient les clients maintenant</p>
          <Phone short caption={liveSlides.length === 0 ? 'Aucune annonce en cours : pas de bandeau, les rayons remontent sous la recherche.' : `${plural(liveSlides.length, 'annonce défile', 'annonces défilent')} dans le bandeau.`}>
            <HomePreview slides={liveSlides} />
          </Phone>
        </aside>
      )}
      <div className="min-w-0">
      {error ? (
        <ErrorPanel message={error} onRetry={() => load()} />
      ) : loading ? (
        <div className="pt-4">
          <SkeletonRows rows={4} />
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          title={text.emptyTitle}
          body={text.emptyBody}
          cta={canEdit ? text.add : undefined}
          onPress={canEdit ? openNew : undefined}
        />
      ) : view === 'videos' ? (
        <ul className="mt-4 grid grid-cols-1 gap-3 px-5 lg:grid-cols-2 xl:grid-cols-3">
          {videos.map((v, i) => (
            <motion.li key={v.id} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 260, damping: 26, delay: i < 9 ? i * 0.03 : 0 }}>
              <article className="card flex gap-3.5 p-3">
                <button type="button" onClick={() => setEditVideo(v)} aria-label={`Ouvrir la vidéo ${v.data.title}`} className="press relative aspect-[9/16] w-[96px] shrink-0 overflow-hidden rounded-[18px] bg-black/40">
                  {v.data.posterUrl ? (
                    <img src={v.data.posterUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full place-items-center px-2 text-center text-[10.5px] font-bold uppercase tracking-[0.06em] text-fg-faint">Sans aperçu</span>
                  )}
                  {v.data.durationSec > 0 && (
                    <span className="tabular absolute bottom-1.5 right-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold">{duration(v.data.durationSec)}</span>
                  )}
                </button>
                <div className="flex min-w-0 flex-1 flex-col">
                  <button type="button" onClick={() => setEditVideo(v)} className="press min-h-11 text-left">
                    <span className="line-clamp-2 text-[15.5px] font-bold leading-5">{v.data.title}</span>
                    {v.data.description && <span className="mt-1 line-clamp-2 text-[12.5px] leading-[17px] text-fg-dim">{v.data.description}</span>}
                  </button>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    <Chip>{AUDIENCE[v.data.audience]}</Chip>
                    <StateChips pub={v} />
                  </span>
                  <span className="mt-2">
                    <StatLine stats={v.stats} />
                  </span>
                  <span className="mt-auto flex items-center justify-between gap-2 pt-2.5">
                    <span className="min-w-0 truncate text-[12px] text-fg-faint">{dayText(v.data.publishedAt)}</span>
                    <Switch checked={v.published} busy={busyId === v.id} onChange={(next) => toggle(v, next)} label={`${v.data.title} : ${v.published ? 'publiée, toucher pour retirer' : 'brouillon, toucher pour publier'}`} />
                  </span>
                </div>
              </article>
            </motion.li>
          ))}
        </ul>
      ) : view === 'photos' ? (
        <ul className="mt-4 grid grid-cols-1 gap-3 px-5 lg:grid-cols-2 xl:grid-cols-3">
          {photos.map((ph, i) => {
            const count = ph.data.images.length;
            const title = ph.data.description || `${plural(count, 'photo', 'photos')}, sans description`;
            return (
              <motion.li key={ph.id} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 260, damping: 26, delay: i < 9 ? i * 0.03 : 0 }}>
                <article className="card flex gap-3.5 p-3">
                  <button type="button" onClick={() => setEditPhotos(ph)} aria-label={`Ouvrir la publication : ${title}`} className="press relative h-[104px] w-[104px] shrink-0 self-start overflow-hidden rounded-[18px] bg-black/40">
                    {ph.data.images[0] && <img src={ph.data.images[0].url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
                    <span className="tabular absolute bottom-1.5 right-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold">{plural(count, 'photo', 'photos')}</span>
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <button type="button" onClick={() => setEditPhotos(ph)} className="press min-h-11 text-left">
                      <span className={cx('line-clamp-3 break-words text-[14px] leading-[19px]', ph.data.description ? 'font-semibold' : 'text-fg-faint')}>{title}</span>
                    </button>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      <Chip>{AUDIENCE[ph.data.audience]}</Chip>
                      <StateChips pub={ph} />
                    </span>
                    <span className="mt-2">
                      <StatLine stats={ph.stats} />
                    </span>
                    <span className="mt-auto flex items-center justify-between gap-2 pt-2.5">
                      <span className="min-w-0 truncate text-[12px] text-fg-faint">{dayText(ph.data.publishedAt)}</span>
                      <Switch checked={ph.published} busy={busyId === ph.id} onChange={(next) => toggle(ph, next)} label={`Publication photo : ${ph.published ? 'publiée, toucher pour retirer' : 'brouillon, toucher pour publier'}`} />
                    </span>
                  </div>
                </article>
              </motion.li>
            );
          })}
        </ul>
      ) : (
        <ol className="mt-4 grid grid-cols-1 gap-3 px-5 xl:grid-cols-2">
          {annonces.map((a, i) => {
            const product = byId.get(a.data.product_id) ?? null;
            return (
              <motion.li key={a.id} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 260, damping: 26, delay: i * 0.04 }}>
                <article>
                  <button type="button" onClick={() => setEditAnnonce(a)} aria-label={`Modifier l’annonce ${product?.name ?? (a.data.image_url ? 'faite de votre image' : a.data.product_id)}`} className="press block w-full text-left">
                    <HeroPreview product={product} accent={a.data.accent} body={a.data.body} image={a.data.image_url || null} link={a.data.link} buttonLabel={a.data.button_label} />
                  </button>
                  <div className="mt-2 flex items-center gap-2 px-1">
                    <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                      <Chip tone={STATE_TONE[annonceState(a, now)]}>{stateText(a, now)}</Chip>
                      <Chip>Position {i + 1}</Chip>
                      {a._seal && a._seal !== 'ok' && <Chip tone="danger">À valider</Chip>}
                      {a.data.demo && <Chip>Exemple de l’application</Chip>}
                      {a.data.image_url && <Chip>{(a.data.link ?? 'button') === 'none' ? 'Image seule' : `${a.data.link === 'tap' ? 'Toucher l’image' : 'Bouton'} → ${product?.name ?? '?'}`}</Chip>}
                      {!product && needsProduct(a.data) && <Chip tone="star">Produit introuvable</Chip>}
                      {product && (!product.available || product.archived) && <Chip tone="star">Produit non commercialisé</Chip>}
                    </span>
                    <RoundButton icon={arrowUp} label="Monter cette annonce" size={44} disabled={i === 0 || busyId !== null} onClick={() => move(i, -1)} className={cx(i === 0 && 'opacity-30')} />
                    <RoundButton icon={arrowDown} label="Descendre cette annonce" size={44} disabled={i === annonces.length - 1 || busyId !== null} onClick={() => move(i, 1)} className={cx(i === annonces.length - 1 && 'opacity-30')} />
                    <Switch
                      checked={a.published && annonceState(a, now) !== 'ended'}
                      busy={busyId === a.id}
                      onChange={(next) => {
                        // Durée écoulée : on ne réactive pas à l'aveugle, on redonne une durée.
                        if (next && annonceState(a, now) === 'ended') {
                          toast('Cette annonce est terminée : choisissez une nouvelle durée.');
                          setEditAnnonce(a);
                        } else toggle(a, next);
                      }}
                      label={`Annonce ${product?.name ?? ''} : ${a.published && annonceState(a, now) !== 'ended' ? 'activée, toucher pour désactiver' : 'désactivée, toucher pour activer'}`}
                    />
                  </div>
                </article>
              </motion.li>
            );
          })}
        </ol>
      )}
      </div>
      </div>

      {!loading && !error && (
        <div className="mx-5 mt-5">
          <Notice tone={view === 'annonces' ? 'neutral' : 'star'} title={view === 'annonces' ? 'Annonces dans l’application' : 'Dans l’application'}>
            {view === 'annonces'
              ? 'Seules les annonces en cours sont envoyées, avec leur date de fin ; sans annonce en cours, pas de bandeau. L’application les relit toutes les minutes. Une annonce faite de votre image s’affiche en fond du bandeau, avec le bouton vers son produit ; une image sans produit n’est pas encore affichée par l’application.'
              : view === 'photos'
                ? 'L’application n’affiche pas encore les publications photo : l’écran reste à ajouter. Elles sont enregistrées et publiées ici, prêtes pour cette mise à jour.'
                : 'L’application reliée lit ces vidéos (Favoris › Découvrir) et envoie ici les vues, les J’aime et les commentaires, sans le nom du compte pour l’instant.'}
            <span className="mt-2.5 flex items-center gap-2 rounded-2xl border border-line bg-black/25 p-1.5 pl-3.5">
              <code className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{address}</code>
              <button type="button" onClick={() => copy(address)} className="press grid h-11 shrink-0 place-items-center rounded-full bg-surface-strong px-4 text-[13px] font-bold text-fg">
                Copier
              </button>
            </span>
            {(
              <span className="mt-2.5 flex flex-wrap gap-2.5">
                <a href="/branchement/LISEZ-MOI.txt" target="_blank" rel="noreferrer noopener" className="press flex min-h-11 items-center rounded-full border border-line-strong px-4 text-[13.5px] font-bold text-fg">
                  Lire les instructions
                </a>
              </span>
            )}
          </Notice>
        </div>
      )}

      <VideoSheet target={editVideo} onClose={() => setEditVideo(null)} onSaved={() => load(true)} />
      <PhotoSheet target={editPhotos} onClose={() => setEditPhotos(null)} onSaved={() => load(true)} />
      <AnnonceSheet
        target={editAnnonce}
        onClose={() => setEditAnnonce(null)}
        onSaved={() => load(true)}
        products={linkable}
        byId={byId}
        others={annonces}
      />
    </Page>
  );
}

// ───────────── Fiche d'une vidéo

function VideoSheet({ target, onClose, onSaved }: { target: VideoPub | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const isNew = target === 'new';
  const current = target && target !== 'new' ? target : null;
  const [form, setForm] = useState({ title: '', description: '', audience: 'tous' as Audience, publishedAt: today(), published: true });
  const [picked, setPicked] = useState<Picked | null>(null);
  const [reading, setReading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const key = target === 'new' ? 'new' : (target?.id ?? '');
  useEffect(() => {
    setPicked(null);
    setErrors({});
    setSure(false);
    setStep(null);
    setForm(
      current
        ? { title: current.data.title, description: current.data.description, audience: current.data.audience, publishedAt: current.data.publishedAt, published: current.published }
        : { title: '', description: '', audience: 'tous', publishedAt: today(), published: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(
    () => () => {
      if (picked) {
        URL.revokeObjectURL(picked.url);
        if (picked.posterUrl) URL.revokeObjectURL(picked.posterUrl);
      }
    },
    [picked],
  );

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErrors((e) => ({ ...e, videoUrl: '' }));
    if (!VIDEO_TYPES.includes(file.type)) {
      setErrors((e) => ({ ...e, videoUrl: 'Format non pris en charge : choisissez une vidéo MP4, WebM ou MOV.' }));
    } else if (file.size > MAX_VIDEO) {
      setErrors((e) => ({ ...e, videoUrl: `Vidéo trop lourde (${megabytes(file.size)}) : 50 Mo au plus. Raccourcissez-la ou réduisez sa qualité.` }));
    } else {
      setReading(true);
      try {
        setPicked(await readVideo(file));
      } catch (err) {
        setErrors((e) => ({ ...e, videoUrl: messageOf(err) }));
      } finally {
        setReading(false);
      }
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const save = async () => {
    const found: Record<string, string> = {};
    if (!form.title.trim()) found.title = 'Donnez un titre à la vidéo.';
    if (isNew && !picked) found.videoUrl = 'Choisissez d’abord le fichier vidéo.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      const data: Partial<VideoData> = { title: form.title, description: form.description, audience: form.audience, publishedAt: form.publishedAt };
      if (picked) {
        setStep(`Envoi de la vidéo (${megabytes(picked.file.size)})…`);
        data.videoUrl = await upload('video', picked.file, picked.file.type);
        data.posterUrl = '';
        if (picked.poster) {
          setStep('Envoi de l’aperçu…');
          data.posterUrl = await upload('poster', picked.poster, picked.poster.type || 'image/png');
        }
        data.durationSec = Math.round(picked.duration);
        data.width = picked.width;
        data.height = picked.height;
        data.demo = false;
      }
      setStep('Enregistrement…');
      if (current) await api('/api/publications', { method: 'PUT', body: { id: current.id, data, published: form.published } });
      else await api('/api/publications', { method: 'POST', body: { kind: 'video', data, published: form.published } });
      toast(form.published ? `Vidéo « ${form.title.trim()} » publiée` : 'Vidéo enregistrée en brouillon');
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
      toast('Vidéo supprimée, avec son fichier');
      onSaved();
      onClose();
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setStep(null);
    }
  };

  const src = picked?.url ?? current?.data.videoUrl ?? null;
  const poster = picked ? (picked.posterUrl ?? undefined) : current?.data.posterUrl || undefined;
  const width = picked?.width ?? current?.data.width ?? 0;
  const height = picked?.height ?? current?.data.height ?? 0;
  const seconds = picked ? picked.duration : (current?.data.durationSec ?? 0);

  return (
    <Sheet
      open={!!target}
      onClose={() => (step ? undefined : onClose())}
      title={isNew ? 'Nouvelle vidéo' : 'Vidéo'}
      footer={canEdit ? <PrimaryButton label={isNew ? (form.published ? 'Publier la vidéo' : 'Enregistrer le brouillon') : 'Enregistrer'} loading={!!step} loadingLabel={step ?? ''} onClick={save} /> : undefined}
    >
      {src ? (
        <video key={src} src={src} poster={poster} controls playsInline preload="metadata" className="mx-auto max-h-[320px] max-w-full rounded-[18px] bg-black" />
      ) : (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={reading}
          className="press flex min-h-[150px] w-full flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-line-strong bg-white/[0.03] px-5 text-center"
        >
          {reading ? <span className="spinner text-leaf" /> : <span className="text-[30px] font-bold leading-none text-leaf">+</span>}
          <span className="text-[15px] font-bold">{reading ? 'Lecture de la vidéo…' : 'Choisir une vidéo'}</span>
          <span className="text-[12.5px] leading-[18px] text-fg-faint">MP4, WebM ou MOV · 50 Mo au plus · format vertical conseillé</span>
        </button>
      )}
      <input ref={fileInput} type="file" accept="video/mp4,video/webm,video/quicktime" className="sr-only" tabIndex={-1} aria-label="Choisir un fichier vidéo" onChange={(e) => pick(e.target.files?.[0])} />
      {src && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {seconds > 0 && <Chip>{duration(seconds)}</Chip>}
          {width > 0 && <Chip>{width} × {height} px</Chip>}
          {picked && <Chip>{megabytes(picked.file.size)}</Chip>}
          {picked && <Chip tone="leaf">Prête à l’envoi</Chip>}
          {current?.data.demo && !picked && <Chip>Exemple de l’application</Chip>}
        </div>
      )}
      {width > height && height > 0 && (
        <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-star">Vidéo horizontale : l’espace Découvrir s’affiche en plein écran vertical, elle y paraîtra petite. Préférez un format vertical (9:16).</p>
      )}
      {picked && !picked.poster && <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-star">L’image d’aperçu n’a pas pu être extraite : la vidéo sera publiée sans vignette.</p>}
      {errors.videoUrl && (
        <p role="alert" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
          {errors.videoUrl}
        </p>
      )}
      {src && canEdit && <GhostButton compact className="mt-3" label={reading ? 'Lecture…' : 'Remplacer le fichier'} disabled={reading || !!step} onClick={() => fileInput.current?.click()} />}

      <Field label="Titre" value={form.title} maxLength={80} placeholder="Mangue du Sénégal : la campagne arrive" onValue={(v) => setForm((f) => ({ ...f, title: v }))} error={errors.title || undefined} />
      <TextArea label="Description" optional value={form.description} maxLength={220} className="!min-h-[92px]" onValue={(v) => setForm((f) => ({ ...f, description: v }))} error={errors.description || undefined} hint={`${form.description.trim().length} / 220 caractères`} />
      <p className="mb-[7px] mt-4 text-[13px] font-semibold text-fg-dim">Visible par</p>
      <Segmented
        label="Public de la vidéo"
        full
        value={form.audience}
        onChange={(v) => setForm((f) => ({ ...f, audience: v }))}
        options={[
          { value: 'tous', label: 'Tous' },
          { value: 'particulier', label: 'Particuliers' },
          { value: 'pro', label: 'Pros' },
        ]}
      />
      <Field label="Date affichée" type="date" value={form.publishedAt} onValue={(v) => setForm((f) => ({ ...f, publishedAt: v || today() }))} hint="Les vidéos sont classées de la plus récente à la plus ancienne." />
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-black/25 p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-5">Publiée</p>
          <p className="mt-0.5 text-[13px] leading-[18px] text-fg-dim">{form.published ? 'Visible dès l’enregistrement.' : 'Brouillon : enregistrée, mais pas publiée.'}</p>
        </div>
        <Switch checked={form.published} onChange={(v) => setForm((f) => ({ ...f, published: v }))} label="Vidéo publiée" />
      </div>
      {current && <ReactionsPanel id={current.id} video className="mt-4 !bg-transparent" />}
      {current && canEdit && (
        <div className="mt-5 border-t border-line pt-4">
          <GhostButton compact tone="danger" label={sure ? 'Confirmer la suppression' : 'Supprimer la vidéo'} disabled={!!step} onClick={() => (sure ? remove() : setSure(true))} />
          {sure && <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">La vidéo, son fichier et ses statistiques seront effacés définitivement.</p>}
        </div>
      )}
      {!canEdit && <p className="mt-4 text-[13px] leading-[19px] text-fg-dim">Mode visite : connectez-vous pour modifier ou publier.</p>}
    </Sheet>
  );
}

// ───────────── Fiche d'une annonce

function AnnonceSheet({ target, onClose, onSaved, products, byId, others }: {
  target: AnnoncePub | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
  products: Product[];
  byId: Map<string, Product>;
  /** Toutes les annonces : l'aperçu montre le bandeau tel qu'il sera, les autres comprises. */
  others: AnnoncePub[];
}) {
  const { canEdit } = useAuth();
  const { photoOf } = useData();
  const toast = useToast();
  const now = useNow(15_000);
  const isNew = target === 'new';
  const current = target && target !== 'new' ? target : null;
  const [form, setForm] = useState({ mode: 'modele' as 'modele' | 'image', link: 'button' as LinkMode, button_label: '', product_id: '', accent: '', body: '', published: true, duration: '7' as DurationChoice, until: '' });
  const [shot, setShot] = useState<Shot | null>(null);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);

  const key = target === 'new' ? 'new' : (target?.id ?? '');
  useEffect(() => {
    setErrors({});
    setSure(false);
    const ended = current ? annonceState(current) === 'ended' : false;
    setShot(current?.data.image_url ? { key: 'en-ligne', url: current.data.image_url, width: 0, height: 0 } : null);
    setForm(
      current
        ? { mode: current.data.image_url ? 'image' : 'modele', link: current.data.image_url ? (current.data.link ?? 'button') : 'button', button_label: current.data.button_label ?? '', product_id: current.data.product_id, accent: current.data.accent, body: current.data.body, published: current.published && !ended, duration: ended ? '7' : 'keep', until: toLocalInput(Date.now() + 7 * DAY) }
        : { mode: 'modele', link: 'button', button_label: '', product_id: '', accent: '', body: '', published: true, duration: '7', until: toLocalInput(Date.now() + 7 * DAY) },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /** Fin d'affichage qui sera enregistrée, d'après la durée choisie. `null` : sans limite. */
  const endsAt = (from = now): string | null => {
    if (form.duration === 'keep') return current?.data.ends_at ?? null;
    if (form.duration === 'none') return null;
    if (form.duration === 'date') {
      const t = new Date(form.until).getTime();
      return Number.isFinite(t) ? new Date(t).toISOString() : null;
    }
    return new Date(from + Number(form.duration) * DAY).toISOString();
  };
  const end = endsAt();
  const endPassed = !!end && new Date(end).getTime() <= now;
  const willShow = form.published && !endPassed;

  const withImage = form.mode === 'image';
  /** Une image seule, sans lien, n'a pas de produit. */
  const hasProduct = !withImage || form.link !== 'none';

  const pickImage = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    setReading(true);
    try {
      setShot(await readPhoto(file));
      setErrors((e) => ({ ...e, image_url: '' }));
    } catch (err) {
      setErrors((e) => ({ ...e, image_url: messageOf(err) }));
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    const found: Record<string, string> = {};
    if (withImage && !shot) found.image_url = 'Choisissez votre image.';
    if (hasProduct && !form.product_id) found.product_id = withImage ? 'Choisissez le produit à ouvrir.' : 'Choisissez le produit mis en avant.';
    if (!withImage && !form.body.trim()) found.body = 'Écrivez le texte de l’annonce.';
    if (form.duration === 'date' && !Number.isFinite(new Date(form.until).getTime())) found.ends_at = 'Indiquez la date et l’heure de fin.';
    else if (form.published && endPassed) found.ends_at = 'Cette date de fin est déjà passée : choisissez une durée à venir.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const start = Date.now();
      // Une nouvelle durée repart de maintenant ; sinon le début d'origine est conservé.
      const starts_at = form.duration === 'keep' ? (current?.data.starts_at ?? null) : form.published ? new Date(start).toISOString() : null;
      let image_url = '';
      if (withImage && shot) {
        image_url = shot.blob ? await sendPhoto(shot.blob) : shot.url;
        // Envoyée une fois : un nouvel essai d'enregistrement ne la renvoie pas.
        if (shot.blob) setShot({ ...shot, url: image_url, blob: undefined });
      }
      const data = {
        product_id: hasProduct ? form.product_id : '',
        accent: withImage ? '' : form.accent,
        body: form.body,
        image_url,
        link: withImage ? form.link : ('button' as LinkMode),
        button_label: withImage && form.link === 'button' ? form.button_label : '',
        demo: false,
        starts_at,
        ends_at: endsAt(start),
      };
      if (current) await api('/api/publications', { method: 'PUT', body: { id: current.id, data, published: form.published } });
      else await api('/api/publications', { method: 'POST', body: { kind: 'annonce', data, published: form.published } });
      toast(form.published ? (data.ends_at ? `Annonce en ligne jusqu’au ${whenText(data.ends_at).slice(3)}` : 'Annonce en ligne, sans date de fin') : 'Annonce enregistrée, désactivée');
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast(`Non enregistré. ${messageOf(err)}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await api('/api/publications', { method: 'DELETE', body: { id: current.id } });
      toast('Annonce supprimée');
      onSaved();
      onClose();
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // Le bandeau tel qu'il sera après enregistrement : les autres annonces en cours, et celle-ci
  // à sa place si elle est activée et dans sa durée.
  const selfKey = current?.id ?? 'nouvelle';
  const ordered = current ? others : [...others, null];
  const self: Slide = {
    key: selfKey,
    product: hasProduct ? (byId.get(form.product_id) ?? null) : null,
    accent: form.accent,
    body: form.body,
    image: withImage ? (shot?.url ?? '') : null,
    link: withImage ? form.link : 'button',
    buttonLabel: form.button_label,
  };
  const slides: Slide[] = ordered.flatMap((a): Slide[] => {
    if (a === null || a.id === current?.id) return willShow ? [self] : [];
    const other = annonceState(a, now) === 'live' ? slideOf(a, byId) : null;
    return other ? [other] : [];
  });
  const caption = !form.published
    ? 'Désactivée : cette annonce n’est pas affichée.' + (slides.length === 0 ? ' Sans autre annonce, il n’y a pas de bandeau.' : '')
    : endPassed
      ? 'Durée écoulée : cette annonce n’est plus affichée.'
      : end
        ? `Affichée jusqu’au ${whenText(end).slice(3)}, puis retirée automatiquement.`
        : 'Affichée sans date de fin, jusqu’à ce que vous la désactiviez.';

  return (
    <Workbench
      open={!!target}
      onClose={() => (busy ? undefined : onClose())}
      title={isNew ? 'Nouvelle annonce' : 'Annonce'}
      preview={
        <Phone caption={caption}>
          <HomePreview slides={slides} focus={willShow ? selfKey : undefined} />
        </Phone>
      }
      footer={
        canEdit ? (
          <div className="flex items-center gap-3">
            <p className="hidden min-w-0 flex-1 text-[13px] leading-[18px] text-fg-dim sm:block">{caption}</p>
            <PrimaryButton label={isNew ? (form.published ? 'Mettre en ligne' : 'Enregistrer') : 'Enregistrer'} loading={busy} onClick={save} className="shrink-0 sm:!w-auto sm:min-w-[260px]" />
          </div>
        ) : undefined
      }
    >
      <div className="card mx-5 p-[18px]">
        <p className="mb-[7px] text-[13px] font-semibold text-fg-dim">Présentation</p>
        <Segmented
          label="Présentation de l’annonce"
          full
          value={form.mode}
          onChange={(v) => {
            setForm((f) => ({ ...f, mode: v }));
            setErrors({});
          }}
          options={[
            { value: 'modele', label: 'Modèle' },
            { value: 'image', label: 'Votre image' },
          ]}
        />
        <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">
          {withImage ? 'L’image que vous avez créée occupe tout le bandeau. Texte, bouton et lien sont facultatifs.' : 'Le bandeau est composé pour vous : photo du produit, nom, accroche, texte et bouton.'}
        </p>
        {withImage ? (
          <>
            {shot ? (
              <img src={shot.url} alt="Image de l’annonce" className="mt-3 aspect-[16/10] w-full rounded-[18px] bg-black/40 object-cover" />
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={reading}
                className="press mt-3 flex min-h-[150px] w-full flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-line-strong bg-white/[0.03] px-5 text-center"
              >
                {reading ? <span className="spinner text-leaf" /> : <span className="text-[30px] font-bold leading-none text-leaf">+</span>}
                <span className="text-[15px] font-bold">{reading ? 'Lecture de l’image…' : 'Choisir votre image'}</span>
                <span className="text-[12.5px] leading-[18px] text-fg-faint">JPEG, PNG ou WebP · format horizontal conseillé, 1 600 × 1 000 px environ</span>
              </button>
            )}
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Choisir l’image de l’annonce" onChange={(e) => pickImage(e.target.files?.[0])} />
            {errors.image_url && (
              <p role="alert" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
                {errors.image_url}
              </p>
            )}
            {shot && canEdit && <GhostButton compact className="mt-3" label={reading ? 'Lecture…' : 'Remplacer l’image'} disabled={reading || busy} onClick={() => fileInput.current?.click()} />}
            {shot && <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">Le bandeau est horizontal : les bords d’une image trop haute sont rognés. Gardez l’essentiel au centre.</p>}
            <TextArea label="Texte sur l’image" optional value={form.body} maxLength={120} className="!min-h-[76px]" placeholder="La campagne de mangue commence en mai." onValue={(v) => setForm((f) => ({ ...f, body: v }))} error={errors.body || undefined} hint={`${form.body.trim().length} / 120 · en bas de l’image. Laissez vide si le texte est déjà dans votre image.`} />
            <p className="mb-2 mt-4 text-[13px] font-semibold text-fg-dim">Quand le client touche l’annonce</p>
            <LinkPicker
              link={form.link}
              productId={form.product_id}
              buttonLabel={form.button_label}
              products={products}
              errors={errors}
              onChange={(patch) => {
                setForm((f) => ({ ...f, ...patch }));
                setErrors((e) => (e.product_id ? { ...e, product_id: '' } : e));
              }}
            />
          </>
        ) : (
          <>
            <p className="mt-3 text-[13px] font-semibold text-fg-dim">Produit mis en avant</p>
            <div className="no-scrollbar -mx-[18px] mt-2 flex gap-1 overflow-x-auto px-3 pb-1" role="radiogroup" aria-label="Produit mis en avant">
              {products.map((p) => (
                <CategoryRound key={p.id} src={photoOf(p)} ratio={p.photo_ratio} label={p.name} active={form.product_id === p.id} onClick={() => setForm((f) => ({ ...f, product_id: p.id }))} />
              ))}
            </div>
            {errors.product_id && (
              <p role="alert" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
                {errors.product_id}
              </p>
            )}
            <Field label="Accroche" optional value={form.accent} maxLength={40} placeholder="du Sénégal" onValue={(v) => setForm((f) => ({ ...f, accent: v }))} error={errors.accent || undefined} hint="En italique, sous le nom du produit." />
            <TextArea label="Texte" value={form.body} maxLength={120} className="!min-h-[92px]" placeholder="Kent et Keitt, récoltées de mai à octobre." onValue={(v) => setForm((f) => ({ ...f, body: v }))} error={errors.body || undefined} hint={`${form.body.trim().length} / 120 · deux lignes dans le bandeau`} />
          </>
        )}
      </div>

      <div className="card mx-5 mt-3.5 p-[18px]">
        <h3 className="font-display text-[19px] font-semibold leading-6">Durée d’affichage</h3>
        {current && form.duration === 'keep' && (
          <p className="mt-2 text-[13.5px] leading-5 text-fg-dim">
            {current.data.ends_at ? `Fin prévue ${whenText(current.data.ends_at)}.` : 'Sans date de fin pour l’instant.'} Choisissez une durée pour repartir de maintenant.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Durée d’affichage de l’annonce">
          {DURATIONS.map((d) => {
            const on = form.duration === d.value;
            return (
              <button
                key={d.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setForm((f) => ({ ...f, duration: d.value }));
                  setErrors((e) => (e.ends_at ? { ...e, ends_at: '' } : e));
                }}
                className={cx('press flex h-11 items-center rounded-full border px-4 text-[13.5px] transition-colors duration-200', on ? 'border-leaf bg-leaf font-extrabold text-on-leaf' : 'border-line bg-surface font-bold text-fg-dim')}
              >
                {d.label}
              </button>
            );
          })}
        </div>
        {form.duration === 'date' && (
          <label className="mt-3 block">
            <span className="mb-[7px] block text-[13px] font-semibold text-fg-dim">Afficher jusqu’au</span>
            <input type="datetime-local" className="field" value={form.until} min={toLocalInput(now)} onChange={(e) => setForm((f) => ({ ...f, until: e.target.value }))} aria-invalid={errors.ends_at ? true : undefined} />
          </label>
        )}
        {errors.ends_at && (
          <p role="alert" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
            {errors.ends_at}
          </p>
        )}
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-black/25 p-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-5">Annonce activée</p>
            <p className="mt-0.5 text-[13px] leading-[18px] text-fg-dim">{form.published ? 'Affichée sur l’accueil pendant la durée choisie.' : 'Désactivée : enregistrée, mais pas affichée.'}</p>
          </div>
          <Switch checked={form.published} onChange={(v) => setForm((f) => ({ ...f, published: v }))} label="Annonce activée" />
        </div>
      </div>

      {current && canEdit && (
        <div className="mx-5 mt-4">
          <GhostButton compact tone="danger" label={sure ? 'Confirmer la suppression' : 'Supprimer l’annonce'} disabled={busy} onClick={() => (sure ? remove() : setSure(true))} />
        </div>
      )}
    </Workbench>
  );
}
