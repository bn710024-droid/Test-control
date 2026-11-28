import crypto from 'node:crypto';
import supabase from './db-client.js';
import { preflight, requireAdmin, optionalAdmin, readBody, log, serverError } from './_lib.js';
import { loadSeals, stateOf, sealRows, unseal , spaceOf, rowSpace } from './_seal.js';
import { tooMany } from './_limit.js';
import { annonceState } from '../shared/orders.js';

/**
 * Publications de l'équipe.
 *
 *  - Vidéos de l'espace « Découvrir » : `GET /api/publications?public=videos` répond au format
 *    attendu par `fetchTeamVideos` (lib/videos.ts) — c'est l'adresse à donner à `VIDEOS_ENDPOINT`.
 *  - Annonces du bandeau d'accueil : `GET /api/publications?public=annonces` répond au format de
 *    `CAMPAIGNS` (lib/data.ts) : `{ id: produit, accent, body, startsAt, endsAt }`. Seules les annonces
 *    en cours y figurent (activées, commencées, pas terminées) : sans annonce en cours, la liste
 *    est vide et l'application n'affiche pas de bandeau.
 *  - Publications photo (une à dix photos que le client fait défiler, avec une description) :
 *    `GET /api/publications?public=photos`. Comme les vidéos, elles vivent dans l'espace
 *    « Publications » de l'application : rien n'y mène à un produit. Les liens vers un produit
 *    sont réservés aux annonces du bandeau d'accueil.
 *  - Statistiques des vidéos et des publications photo : l'application envoie ce que chaque
 *    compte a fait (vues, J'aime, commentaires) à `POST /api/publications?public=reactions`.
 *    `GET /api/publications` donne les totaux de chaque publication (`stats`) ;
 *    `GET /api/publications?reactions=<id>` donne le détail, réservé à l'équipe.
 *  - Une annonce peut porter l'image de l'équipe (`imageUrl`) à la place du modèle, avec le même
 *    choix `link`. Sans lien, elle n'a pas de produit : son `id` vaut alors `null`.
 *  - Sans paramètre : toutes les publications, brouillons compris, pour l'administration.
 *
 * Les fichiers (vidéo, image d'aperçu) partent directement du navigateur vers le stockage, avec
 * une autorisation d'envoi à usage unique délivrée ici aux seuls comptes autorisés.
 */
const BUCKET = 'publications';
const TYPES = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
const AUDIENCES = ['tous', 'particulier', 'pro'];
const LINKS = ['none', 'button', 'tap'];
const MAX_PHOTOS = 10;

const base = () => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
const pathOf = (url) => (typeof url === 'string' && url.startsWith(base()) ? url.slice(base().length) : null);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const today = () => new Date().toISOString().slice(0, 10);

function validateVideo(src) {
  const errors = {};
  const title = str(src.title);
  if (!title) errors.title = 'Donnez un titre à la vidéo.';
  else if (title.length > 80) errors.title = 'Titre : 80 caractères au plus.';
  const description = str(src.description);
  if (description.length > 220) errors.description = 'Description : 220 caractères au plus.';
  const audience = AUDIENCES.includes(src.audience) ? src.audience : 'tous';
  const publishedAt = /^\d{4}-\d{2}-\d{2}$/.test(str(src.publishedAt)) ? str(src.publishedAt) : today();
  const videoUrl = str(src.videoUrl);
  if (!pathOf(videoUrl)) errors.videoUrl = 'Choisissez un fichier vidéo : il doit être envoyé depuis cette page.';
  const posterUrl = str(src.posterUrl);
  if (posterUrl && !pathOf(posterUrl)) errors.posterUrl = 'Image d’aperçu invalide.';
  const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : 0);
  return {
    errors,
    value: {
      title,
      description,
      audience,
      publishedAt,
      durationSec: Math.round(num(src.durationSec, 3600)),
      videoUrl,
      posterUrl,
      width: Math.round(num(src.width, 8000)),
      height: Math.round(num(src.height, 8000)),
      demo: src.demo === true,
    },
  };
}

/** Ce qui se passe quand le client touche une publication : rien, un bouton, ou la photo elle-même. */
function validateLink(src, productIds, errors, fallback) {
  const link = LINKS.includes(src.link) ? src.link : fallback;
  const productId = link === 'none' ? '' : str(src.product_id);
  if (link !== 'none') {
    if (!productId) errors.product_id = 'Choisissez le produit à ouvrir.';
    else if (!productIds.includes(productId)) errors.product_id = 'Ce produit n’existe plus au catalogue.';
  }
  const label = link === 'button' ? str(src.button_label) : '';
  if (label.length > 24) errors.button_label = 'Texte du bouton : 24 caractères au plus.';
  return { link, product_id: productId, button_label: label };
}

function validateAnnonce(src, productIds) {
  const errors = {};
  const imageUrl = str(src.image_url);
  if (imageUrl && !pathOf(imageUrl)) errors.image_url = 'Image invalide : elle doit être envoyée depuis cette page.';
  const accent = imageUrl ? '' : str(src.accent);
  if (accent.length > 40) errors.accent = 'Accroche : 40 caractères au plus.';
  // Surtitre et titre (annonce au modèle), facultatifs : vides, l'application les déduit du produit.
  const kicker = imageUrl ? '' : str(src.kicker);
  if (kicker.length > 40) errors.kicker = 'Surtitre : 40 caractères au plus.';
  const title = imageUrl ? '' : str(src.title);
  if (title.length > 40) errors.title = 'Titre : 40 caractères au plus.';
  const body = str(src.body);
  // Le modèle a toujours un produit et un bouton ; une image peut se suffire à elle-même.
  const target = validateLink(imageUrl ? src : { ...src, link: 'button', button_label: '' }, productIds, errors, 'button');
  if (errors.product_id && !imageUrl && !str(src.product_id)) errors.product_id = 'Choisissez le produit mis en avant.';
  if (!body && !imageUrl) errors.body = 'Écrivez le texte de l’annonce.';
  else if (body.length > 120) errors.body = 'Texte : 120 caractères au plus (deux lignes dans le bandeau).';
  // Durée d'affichage : un début (par défaut, tout de suite) et une fin (facultative).
  const date = (v) => {
    const t = typeof v === 'string' && v ? new Date(v).getTime() : NaN;
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  };
  const startsAt = date(src.starts_at);
  const endsAt = date(src.ends_at);
  if (src.ends_at && !endsAt) errors.ends_at = 'Date de fin illisible.';
  else if (endsAt && startsAt && new Date(endsAt) <= new Date(startsAt)) errors.ends_at = 'La fin doit venir après le début.';
  return { errors, value: { ...target, accent, ...(kicker ? { kicker } : null), ...(title ? { title } : null), body, image_url: imageUrl, demo: src.demo === true, starts_at: startsAt, ends_at: endsAt } };
}

function validatePhotos(src) {
  const errors = {};
  const list = Array.isArray(src.images) ? src.images : [];
  const dim = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 12000 ? Math.round(v) : 0);
  const images = list
    .map((i) => ({ url: str(i?.url), width: dim(i?.width), height: dim(i?.height) }))
    .filter((i) => i.url);
  if (images.length === 0) errors.images = 'Ajoutez au moins une photo.';
  else if (images.length > MAX_PHOTOS) errors.images = `${MAX_PHOTOS} photos au plus par publication.`;
  else if (images.some((i) => !pathOf(i.url))) errors.images = 'Photo invalide : elle doit être envoyée depuis cette page.';
  else if (new Set(images.map((i) => i.url)).size !== images.length) errors.images = 'La même photo figure deux fois.';
  const description = str(src.description);
  if (description.length > 600) errors.description = 'Description : 600 caractères au plus.';
  // Aucun lien vers un produit : c'est le rôle des annonces, pas des publications.
  const audience = AUDIENCES.includes(src.audience) ? src.audience : 'tous';
  const publishedAt = /^\d{4}-\d{2}-\d{2}$/.test(str(src.publishedAt)) ? str(src.publishedAt) : today();
  return { errors, value: { images, description, audience, publishedAt, demo: false } };
}

// ───────────── Statistiques : ce que les clients ont fait sur les vidéos et les publications photo

const REACTIONS = 'publication_reactions';
const REACTION_KINDS = ['view', 'like', 'comment'];
/** Les annonces n'ont pas de statistiques : seulement les vidéos et les publications photo. */
const hasStats = (row) => row.kind === 'video' || row.kind === 'photos';

/** Toutes les lignes d'une requête, page par page (une lecture est plafonnée à 1 000 lignes). */
async function readAll(build, max = 20000) {
  const rows = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

/** Totaux par publication : `{ [id]: { views, likes, comments } }`. */
async function loadStats() {
  const rows = await readAll(() => supabase.from(REACTIONS).select('publication_id, kind, account_id, client_id').order('id', { ascending: true }));
  const out = {};
  const seen = new Set();
  for (const r of rows) {
    // Une vue, un J'aime et un commentaire ne comptent qu'une fois par compte, même reçus en double.
    const key = `${r.publication_id}|${r.kind}|${r.account_id}|${r.client_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const s = (out[r.publication_id] ??= { views: 0, likes: 0, comments: 0 });
    if (r.kind === 'view') s.views += 1;
    else if (r.kind === 'like') s.likes += 1;
    else if (r.kind === 'comment') s.comments += 1;
  }
  return out;
}

/**
 * L'application envoie l'état d'un compte : les publications qu'il a vues, celles qu'il aime, ses
 * commentaires. On aligne ce qui est enregistré sur cet état. Renvoyer deux fois la même chose ne
 * change rien : l'application peut donc réessayer sans risque après une coupure.
 */
async function receiveReactions(req, body, rows, seals, res) {
  if (await tooMany(req, res, 'reactions', 20, 60)) return;
  const account = body.account && typeof body.account === 'object' ? body.account : {};
  const accountId = str(account.id);
  if (accountId.length < 4 || accountId.length > 80) return res.status(400).json({ error: 'Compte manquant.' });
  const name = str(account.name).replace(/\s+/g, ' ').slice(0, 60);
  const type = account.type === 'pro' ? 'pro' : 'particulier';
  const ids = (v) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x.length <= 60))].slice(0, 500);
  // Seules comptent les vidéos et publications photo publiées et validées.
  const open = new Set(rows.filter((r) => hasStats(r) && r.published && stateOf('publications', r, seals) === 'ok').map((r) => r.id));
  const views = ids(body.views).filter((id) => open.has(id));
  const likes = new Set(ids(body.likes));
  const comments = (Array.isArray(body.comments) ? body.comments : [])
    .slice(0, 300)
    .map((c) => ({
      publication_id: str(c?.publicationId),
      client_id: str(c?.id).slice(0, 40),
      body: str(c?.text).slice(0, 300),
      at: Number.isFinite(c?.at) && c.at > 0 && c.at <= Date.now() + 60000 ? new Date(c.at).toISOString() : new Date().toISOString(),
    }))
    .filter((c) => c.client_id && c.body);
  const sentComments = new Set(comments.map((c) => `${c.publication_id}|${c.client_id}`));

  const mine = await readAll(() => supabase.from(REACTIONS).select('id, publication_id, kind, client_id, account_name, account_type').eq('account_id', accountId).order('id', { ascending: true }), 5000);
  const has = (kind, pub, clientId = '') => mine.some((r) => r.kind === kind && r.publication_id === pub && r.client_id === clientId);
  // La date est toujours écrite : dans un envoi groupé, une colonne absente d'une ligne vaudrait « vide ».
  const stamp = new Date().toISOString();
  const row = (kind, pub, extra = {}) => ({ publication_id: pub, kind, account_id: accountId, account_name: name, account_type: type, body: '', client_id: '', at: stamp, ...extra });

  const add = [
    ...views.filter((id) => !has('view', id)).map((id) => row('view', id)),
    ...[...likes].filter((id) => open.has(id) && !has('like', id)).map((id) => row('like', id)),
    ...comments.filter((c) => open.has(c.publication_id) && !has('comment', c.publication_id, c.client_id)).map((c) => row('comment', c.publication_id, { body: c.body, client_id: c.client_id, at: c.at })),
  ];
  // Un J'aime retiré ou un commentaire supprimé dans l'application disparaît ici aussi. Une vue reste.
  const drop = mine.filter((r) => (r.kind === 'like' && !likes.has(r.publication_id)) || (r.kind === 'comment' && !sentComments.has(`${r.publication_id}|${r.client_id}`))).map((r) => r.id);

  if (add.length > 0) {
    // Frein simple contre un envoi en rafale.
    const since = new Date(Date.now() - 60000).toISOString();
    const { count, error: countError } = await supabase.from(REACTIONS).select('id', { count: 'exact', head: true }).gt('created_at', since);
    if (countError) throw countError;
    if ((count ?? 0) + add.length > 1500) return res.status(429).json({ error: 'Trop d’envois en une minute. Réessayez dans un instant.' });
    const { error } = await supabase.from(REACTIONS).insert(add);
    if (error) throw error;
  }
  if (drop.length > 0) {
    const { error } = await supabase.from(REACTIONS).delete().in('id', drop);
    if (error) throw error;
  }
  // Le compte a changé de nom : ses lignes suivent.
  if (name && mine.some((r) => !drop.includes(r.id) && (r.account_name !== name || r.account_type !== type))) {
    const { error } = await supabase.from(REACTIONS).update({ account_name: name, account_type: type }).eq('account_id', accountId);
    if (error) throw error;
  }
  return res.status(200).json({ ok: true, added: add.length, removed: drop.length });
}

const KINDS = ['video', 'annonce', 'photos'];
const PREFIX = { video: 'v', annonce: 'a', photos: 'p' };
const firstWords = (text) => (text.length > 40 ? `${text.slice(0, 40).trim()}…` : text);
const nameOf = (kind, data) =>
  kind === 'video'
    ? `Vidéo « ${data.title} »`
    : kind === 'photos'
      ? `Publication photo${data.description ? ` « ${firstWords(data.description)} »` : ` (${data.images.length} photo${data.images.length > 1 ? 's' : ''})`}`
      : `Annonce « ${data.product_id || 'image seule'} »`;
/** Fichiers du stockage qu'une publication utilise. */
const filesOf = (kind, data) =>
  (kind === 'video' ? [data?.videoUrl, data?.posterUrl] : kind === 'photos' ? (data?.images ?? []).map((i) => i.url) : [data?.image_url]).filter(Boolean);

async function check(kind, data) {
  if (kind === 'video') return validateVideo(data);
  if (kind === 'photos') return validatePhotos(data);
  const products = await supabase.from('products').select('id');
  if (products.error) throw products.error;
  return validateAnnonce(data, products.data.map((p) => p.id));
}

/**
 * Une annonce activée commence tout de suite si aucun début n'est fixé. Une annonce dont la durée
 * est écoulée ne peut pas être réactivée telle quelle : il faut lui donner une nouvelle durée.
 */
function scheduleAnnonce(value, published, now) {
  if (!published) return null;
  if (value.ends_at && new Date(value.ends_at).getTime() <= new Date(now).getTime()) {
    return 'Cette annonce est terminée : choisissez une nouvelle durée avant de la réactiver.';
  }
  if (!value.starts_at) value.starts_at = now;
  return null;
}

async function removeFiles(urls) {
  const paths = urls.map(pathOf).filter(Boolean);
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    // Le fichier reste dans le stockage : sans conséquence pour ce qui est publié.
  }
}

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  try {
    const [all, seals] = await Promise.all([
      supabase.from('publications').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false }),
      loadSeals(),
    ]);
    if (all.error) throw all.error;

    // Envoi de l'application : ce qu'un compte a vu, aimé et commenté. Aucune connexion requise.
    if (req.method === 'POST' && req.query?.public === 'reactions') {
      return await receiveReactions(req, readBody(req), all.data, seals, res);
    }

    // Chaque espace a ses publications : ce qui est publié côté Pros n'apparaît que chez les pros.
    const space = spaceOf(req);
    all.data = all.data.filter((r) => rowSpace(r) === space);

    if (req.method === 'GET') {
      const pub = req.query?.public;
      const live = (kind) => all.data.filter((r) => r.kind === kind && r.published && stateOf('publications', r, seals) === 'ok');
      // Cache court, comme le catalogue : une vidéo publiée est servie à l'application en quelques secondes.
      if (pub === 'videos') {
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=5');
        return res.status(200).json(
          live('video')
            .map((r) => ({
              id: r.id,
              title: r.data.title,
              description: r.data.description,
              publishedAt: r.data.publishedAt,
              durationSec: r.data.durationSec,
              videoUrl: r.data.videoUrl,
              posterUrl: r.data.posterUrl,
              audience: r.data.audience,
            }))
            .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
        );
      }
      if (pub === 'photos') {
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=5');
        return res.status(200).json(
          live('photos')
            // De la plus récente à la plus ancienne ; le même jour, la dernière créée d'abord.
            .sort((a, b) => b.data.publishedAt.localeCompare(a.data.publishedAt) || String(b.created_at).localeCompare(String(a.created_at)))
            .map((r) => ({ id: r.id, images: r.data.images, description: r.data.description, publishedAt: r.data.publishedAt, audience: r.data.audience })),
        );
      }
      if (pub === 'annonces') {
        const products = await supabase.from('products').select('id').eq('archived', false).eq('available', true);
        if (products.error) throw products.error;
        const ids = new Set(products.data.map((p) => p.id));
        // Cache court : une annonce activée, désactivée ou arrivée à son terme se voit en quelques secondes.
        res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=5');
        return res.status(200).json(
          live('annonce')
            .filter((r) => (r.data.product_id ? ids.has(r.data.product_id) : !!r.data.image_url) && annonceState(r) === 'live')
            .map((r) => ({
              id: r.data.product_id || null,
              accent: r.data.accent,
              body: r.data.body,
              startsAt: r.data.starts_at ?? null,
              endsAt: r.data.ends_at ?? null,
              imageUrl: r.data.image_url || null,
              link: r.data.image_url ? r.data.link : 'button',
              buttonLabel: r.data.image_url && r.data.link === 'button' ? r.data.button_label || 'Voir le produit' : null,
            })),
        );
      }
      // Détail d'une publication : qui a vu, aimé, commenté. Réservé à l'équipe.
      const detail = str(req.query?.reactions);
      if (detail) {
        const admin = await optionalAdmin(req);
        if (!admin) return res.status(401).json({ error: 'Connectez-vous pour voir le détail des statistiques.' });
        const target = all.data.find((r) => r.id === detail && hasStats(r));
        if (!target) return res.status(404).json({ error: 'Publication introuvable.' });
        const raw = await readAll(() => supabase.from(REACTIONS).select('id, kind, account_id, account_name, account_type, body, client_id, at, created_at').eq('publication_id', detail).order('at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }), 5000);
        const seen = new Set();
        const list = raw.filter((r) => {
          const key = `${r.kind}|${r.account_id}|${r.client_id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const stats = { views: 0, likes: 0, comments: 0 };
        for (const r of list) stats[r.kind === 'view' ? 'views' : r.kind === 'like' ? 'likes' : 'comments'] += REACTION_KINDS.includes(r.kind) ? 1 : 0;
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
          stats,
          items: list
            .filter((r) => REACTION_KINDS.includes(r.kind))
            .map((r) => ({
              id: r.id,
              kind: r.kind,
              // Repère stable d'un compte, sans exposer son identifiant.
              who: crypto.createHash('sha256').update(r.account_id).digest('hex').slice(0, 12),
              name: r.account_name || '',
              type: r.account_type === 'pro' ? 'pro' : 'particulier',
              text: r.kind === 'comment' ? r.body : '',
              at: r.at ?? r.created_at,
            })),
        });
      }
      const stats = await loadStats();
      return res.status(200).json(
        all.data.map((r) => ({ ...r, _seal: stateOf('publications', r, seals), ...(hasStats(r) ? { stats: stats[r.id] ?? { views: 0, likes: 0, comments: 0 } } : null) })),
      );
    }

    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const body = readBody(req);
    const now = new Date().toISOString();

    if (req.method === 'POST') {
      // Autorisation d'envoi d'un fichier, à usage unique.
      if (body.action === 'upload-url') {
        const ext = TYPES[body.contentType];
        const isVideo = String(body.contentType).startsWith('video/');
        if (!ext || (body.kind === 'video') !== isVideo) {
          return res.status(400).json({
            error: body.kind === 'video' ? 'Format non accepté : vidéo MP4, WebM ou MOV.' : 'Format non accepté : image WebP, JPEG ou PNG.',
          });
        }
        const path = `${isVideo ? 'videos' : body.kind === 'photo' ? 'photos' : 'apercus'}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
        const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
        if (error) throw error;
        return res.status(200).json({ path, token: data.token, url: base() + path });
      }

      if (!KINDS.includes(body.kind)) return res.status(400).json({ error: 'Type de publication inconnu.' });
      const checked = await check(body.kind, body.data || {});
      if (Object.keys(checked.errors).length > 0) {
        return res.status(400).json({ error: Object.values(checked.errors)[0], fields: checked.errors });
      }
      if (body.kind === 'annonce') {
        const late = scheduleAnnonce(checked.value, body.published === true, now);
        if (late) return res.status(400).json({ error: late, fields: { ends_at: late } });
      }
      const last = Math.max(0, ...all.data.filter((r) => r.kind === body.kind).map((r) => r.sort_order ?? 0));
      const { data, error } = await supabase
        .from('publications')
        .insert({
          space,
          id: `${PREFIX[body.kind]}-${crypto.randomBytes(7).toString('hex')}`,
          kind: body.kind,
          data: checked.value,
          published: body.published === true,
          sort_order: last + 10,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();
      if (error) throw error;
      await sealRows('publications', [data]);
      await log(admin, 'create', 'publication', data.id, `${nameOf(body.kind, checked.value)} ${data.published ? 'publiée' : 'enregistrée en brouillon'}`);
      return res.status(201).json({ ...data, _seal: 'ok' });
    }

    if (req.method === 'PUT') {
      // Ordre des annonces dans le bandeau.
      if (Array.isArray(body.order)) {
        const rows = all.data.filter((r) => r.kind === 'annonce');
        const order = body.order.filter((id) => rows.some((r) => r.id === id));
        if (order.length !== rows.length || new Set(order).size !== rows.length) {
          return res.status(409).json({ error: 'La liste des annonces a changé entre-temps. Rechargez la page avant de réordonner.' });
        }
        const toSeal = [];
        for (let i = 0; i < order.length; i++) {
          const current = rows.find((r) => r.id === order[i]);
          const position = (i + 1) * 10;
          if (current.sort_order === position) continue;
          const { data, error } = await supabase.from('publications').update({ sort_order: position, updated_at: now }).eq('id', current.id).select().single();
          if (error) throw error;
          if (stateOf('publications', current, seals) === 'ok') toSeal.push(data);
        }
        await sealRows('publications', toSeal);
        await log(admin, 'update', 'publication', null, 'Ordre des annonces modifié');
        return res.status(200).json({ ok: true });
      }

      const current = all.data.find((r) => r.id === body.id);
      if (!current) return res.status(404).json({ error: 'Publication introuvable : elle a peut-être été supprimée.' });
      const merged = { ...current.data, ...(body.data && typeof body.data === 'object' ? body.data : {}) };
      const checked = await check(current.kind, merged);
      if (Object.keys(checked.errors).length > 0) {
        return res.status(400).json({ error: Object.values(checked.errors)[0], fields: checked.errors });
      }
      const published = typeof body.published === 'boolean' ? body.published : current.published;
      if (current.kind === 'annonce') {
        const late = scheduleAnnonce(checked.value, published, now);
        if (late) return res.status(400).json({ error: late, fields: { ends_at: late } });
      }
      const { data, error } = await supabase
        .from('publications')
        .update({ data: checked.value, published, updated_at: now })
        .eq('id', current.id)
        .select()
        .single();
      if (error) throw error;
      await sealRows('publications', [data]);
      // Fichiers remplacés : les anciens ne servent plus.
      const kept = filesOf(current.kind, checked.value);
      await removeFiles(filesOf(current.kind, current.data).filter((u) => !kept.includes(u)));
      const name = nameOf(current.kind, checked.value);
      const change = published !== current.published ? (published ? (current.kind === 'annonce' ? 'activée' : 'publiée') : current.kind === 'annonce' ? 'désactivée' : 'retirée de la publication') : 'modifiée';
      await log(admin, 'update', 'publication', data.id, `${name} ${change}`);
      return res.status(200).json({ ...data, _seal: 'ok' });
    }

    if (req.method === 'DELETE') {
      const current = all.data.find((r) => r.id === body.id);
      if (!current) return res.status(404).json({ error: 'Publication introuvable : elle a peut-être déjà été supprimée.' });
      const { error } = await supabase.from('publications').delete().eq('id', current.id);
      if (error) throw error;
      await unseal('publications', current.id);
      await removeFiles(filesOf(current.kind, current.data));
      await log(admin, 'delete', 'publication', current.id, `${nameOf(current.kind, current.data)} supprimée`);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}
