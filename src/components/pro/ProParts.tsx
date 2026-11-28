import { useEffect, useRef, useState } from 'react';
import { Reorder } from 'framer-motion';
import { api, messageOf } from '../../lib/api';
import supabase from '../../lib/supabase';
import { prepareImage } from '../../lib/image';
import { useToast } from '../../contexts/ToastContext';
import { GhostButton, Segmented } from '../ui';
import { cx, glow } from '../../lib/ui';
import { PRO_LIMITS, PRO_MODE_LABEL, proOffersFor, proPriceText, proStatusLabel, type ProMedia, type ProSheet } from '../../../shared/pro.js';

// ───────────── Puces (variétés, calibres)

export function TagInput({ label, values, onChange, placeholder }: { label: string; values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim().replace(/,$/, '').slice(0, PRO_LIMITS.tag);
    if (t && !values.includes(t) && values.length < PRO_LIMITS.tags) onChange([...values, t]);
    setText('');
  };
  return (
    <div className="mt-3.5">
      <p className="mb-1.5 px-1 text-[13px] font-semibold text-fg-dim">{label}</p>
      {values.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label={label}>
          {values.map((v) => (
            <li key={v}>
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Retirer ${v}`} className="press flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-white/[0.06] pl-4 pr-3 text-[13.5px] font-bold">
                {v}
                <span aria-hidden className="text-[17px] leading-none text-fg-dim">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="flex h-12 items-center rounded-full border border-line bg-surface px-4 transition-colors focus-within:border-leaf">
        <span className="sr-only">Ajouter : {label}</span>
        <input
          value={text}
          onChange={(e) => (e.target.value.endsWith(',') ? (setText(e.target.value), setTimeout(add)) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={placeholder}
          maxLength={PRO_LIMITS.tag + 1}
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-fg-faint"
        />
      </label>
    </div>
  );
}

// ───────────── Galerie de la fiche : photos et vidéos, glisser pour l'ordre, légende courte

async function sendFile(kind: 'photo' | 'video', blob: Blob, contentType: string) {
  const { path, token, url } = await api<{ path: string; token: string; url: string }>('/api/publications', { method: 'POST', body: { action: 'upload-url', kind, contentType } });
  const { error } = await supabase.storage.from('publications').uploadToSignedUrl(path, token, blob, { contentType });
  if (error) throw new Error(kind === 'video' ? 'L’envoi de la vidéo a échoué. Réessayez.' : 'L’envoi de la photo a échoué. Réessayez.');
  return url;
}

type Item = ProMedia & { key: string };
const keyed = (list: ProMedia[]): Item[] => list.map((m, i) => ({ ...m, key: `${i}-${m.url}` }));

export function MediaEditor({ media, onChange }: { media: ProMedia[]; onChange: (m: ProMedia[]) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>(() => keyed(media));
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const sig = JSON.stringify(media);
  useEffect(() => setItems((cur) => (JSON.stringify(cur.map(({ key: _k, ...m }) => m)) === sig ? cur : keyed(JSON.parse(sig)))), [sig]);
  const push = (next: Item[]) => {
    setItems(next);
    onChange(next.map(({ key: _k, ...m }) => m));
  };

  const addPhoto = async (file?: File) => {
    if (!file) return;
    setBusy('photo');
    try {
      const prepared = await prepareImage(file);
      const url = await sendFile('photo', prepared.blob, prepared.blob.type || 'image/webp');
      push([...items, { key: url, kind: 'photo', url, caption: '', ratio: prepared.ratio }]);
    } catch (e) {
      toast(messageOf(e), { tone: 'error' });
    } finally {
      setBusy(null);
      if (photoInput.current) photoInput.current.value = '';
    }
  };
  const addVideo = async (file?: File) => {
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) return toast('Vidéo trop lourde : 200 Mo au plus.', { tone: 'error' });
    setBusy('video');
    try {
      const url = await sendFile('video', file, file.type || 'video/mp4');
      push([...items, { key: url, kind: 'video', url, caption: '' }]);
    } catch (e) {
      toast(messageOf(e), { tone: 'error' });
    } finally {
      setBusy(null);
      if (videoInput.current) videoInput.current.value = '';
    }
  };

  return (
    <>
      {items.length > 0 && (
        <Reorder.Group axis="y" values={items} onReorder={push} className="mt-3 flex flex-col gap-2" as="div">
          {items.map((m) => (
            <Reorder.Item key={m.key} value={m} as="div" className="flex cursor-grab items-center gap-3 rounded-[16px] border border-line bg-black/15 p-2.5 active:cursor-grabbing">
              <span className="h-14 w-14 shrink-0 overflow-hidden rounded-[12px] bg-black/30">
                {m.kind === 'video' ? <video src={m.url} muted preload="metadata" className="h-full w-full object-cover" /> : <img src={m.url} alt="" className="h-full w-full object-cover" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-bold uppercase tracking-wide text-fg-faint">{m.kind === 'video' ? 'Vidéo' : 'Photo'}</span>
                <input
                  value={m.caption}
                  maxLength={PRO_LIMITS.caption}
                  onChange={(e) => push(items.map((x) => (x.key === m.key ? { ...x, caption: e.target.value } : x)))}
                  onPointerDown={(e) => e.stopPropagation()}
                  placeholder="Légende courte"
                  aria-label="Légende"
                  className="mt-0.5 h-9 w-full rounded-full border border-line bg-surface px-3 text-[14px] font-semibold outline-none focus:border-leaf"
                />
              </span>
              <button type="button" onClick={() => push(items.filter((x) => x.key !== m.key))} aria-label="Retirer ce média" className="press grid h-11 w-11 shrink-0 place-items-center text-[20px] font-bold text-fg-dim">
                ×
              </button>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      )}
      <div className="mt-3 flex flex-wrap gap-2.5">
        <GhostButton compact tone="leaf" label={busy === 'photo' ? 'Envoi…' : 'Ajouter une photo'} loading={busy === 'photo'} disabled={!!busy || items.length >= PRO_LIMITS.media} onClick={() => photoInput.current?.click()} />
        <GhostButton compact tone="leaf" label={busy === 'video' ? 'Envoi…' : 'Ajouter une vidéo'} loading={busy === 'video'} disabled={!!busy || items.length >= PRO_LIMITS.media} onClick={() => videoInput.current?.click()} />
      </div>
      <input ref={photoInput} type="file" accept="image/png,image/webp,image/jpeg" className="sr-only" tabIndex={-1} aria-label="Choisir une photo" onChange={(e) => addPhoto(e.target.files?.[0])} />
      <input ref={videoInput} type="file" accept="video/mp4,video/webm,video/quicktime" className="sr-only" tabIndex={-1} aria-label="Choisir une vidéo" onChange={(e) => addVideo(e.target.files?.[0])} />
      <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">Glissez une ligne pour changer l’ordre. Vue en défilement horizontal dans l’application ; une vidéo s’ouvre en plein écran.</p>
    </>
  );
}

// ───────────── Badge GlobalG.A.P (texte : le logo officiel n'a pas encore été fourni)

export function GapBadge({ small }: { small?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border border-[#5fb04a]/60 bg-[#5fb04a]/15 font-extrabold text-[#9fdc84]', small ? 'h-7 px-2.5 text-[11.5px]' : 'h-9 px-3.5 text-[13px]')}>
      <span aria-hidden className="h-2 w-2 rounded-full bg-[#9fdc84]" />
      Certifié GlobalG.A.P
    </span>
  );
}

// ───────────── Compte à rebours (statut « Bientôt » + date de début)

export function countdownText(start: string | null, now = Date.now()) {
  if (!start) return null;
  const ms = new Date(`${start}T00:00:00`).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return days > 0 ? `Début dans ${days} j ${hours} h` : `Début dans ${hours} h`;
}

// ───────────── Aperçu pro : la fiche vue sur téléphone, depuis un pays

const VIEWS = [
  { code: 'FR', label: 'France' },
  { code: 'US', label: 'États-Unis' },
  { code: 'MA', label: 'Maroc' },
  { code: 'AE', label: 'Émirats' },
] as const;

export function ProPreview({ name, variety, origin, tint, src, pro, available }: { name: string; variety: string; origin: string; tint: string; src: string | null; pro: ProSheet; available: boolean }) {
  const [country, setCountry] = useState<(typeof VIEWS)[number]['code']>('FR');
  const offers = proOffersFor(pro, country);
  const countdown = pro.status === 'bientot' ? countdownText(pro.campaign.start) : null;
  const unitText = (u: 'kg' | 'conteneur', n: number | null) => (n === null ? '—' : `${n.toLocaleString('fr-FR')} ${u === 'kg' ? 'kg' : n > 1 ? 'conteneurs' : 'conteneur'}`);
  return (
    <div className="mt-3">
      <Segmented label="Vu depuis" full value={country} onChange={setCountry} options={VIEWS.map((v) => ({ value: v.code, label: v.label }))} />
      <div className="mx-auto mt-4 w-full max-w-[340px] overflow-hidden rounded-[34px] border border-line-strong bg-[#0d1009] p-4 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
        <div className="relative grid h-[180px] place-items-center overflow-hidden rounded-[24px]" style={{ backgroundImage: glow(tint || '#7AAA2C', 0.4) }}>
          {src ? <img src={src} alt="" className="max-h-[150px] max-w-[70%] object-contain" /> : <span className="text-[13px] text-fg-faint">Sans photo</span>}
          <span className="absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-[12px] font-extrabold text-star">{proStatusLabel(pro.status)}</span>
        </div>
        {countdown && <p className="mt-2.5 text-center text-[13px] font-extrabold text-star">{countdown}</p>}
        <p className="mt-3 font-display text-[22px] font-semibold leading-7">{name || 'Nom du produit'}</p>
        <p className="text-[13px] text-fg-dim">{[variety, origin].filter(Boolean).join(' · ') || 'Variété · origine'}</p>
        {pro.globalgap && <div className="mt-2"><GapBadge small /></div>}
        {pro.volume && <p className="mt-2 text-[13px] font-bold">Volume annoncé : {pro.volume.amount.toLocaleString('fr-FR')} {pro.volume.unit}</p>}
        {(pro.varieties.length > 0 || pro.calibres.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[...pro.varieties, ...pro.calibres].map((t) => (
              <span key={t} className="rounded-full border border-line px-2.5 py-1 text-[11.5px] font-bold text-fg-dim">{t}</span>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-col gap-2">
          {!available ? (
            <p className="rounded-[16px] border border-line px-3 py-2.5 text-[13px] text-fg-faint">« En vente » est éteint : les acheteurs ne voient pas ce produit.</p>
          ) : offers.length === 0 ? (
            <p className="rounded-[16px] border border-line px-3 py-2.5 text-[13px] text-fg-faint">Rien n’est proposé en {VIEWS.find((v) => v.code === country)!.label} : le produit n’y apparaît pas.</p>
          ) : (
            offers.map((o) => (
              <div key={o.mode} className="rounded-[16px] border border-line-strong px-3.5 py-2.5">
                <p className="text-[13.5px] font-extrabold">{PRO_MODE_LABEL[o.mode]}</p>
                <p className="mt-0.5 text-[13px]">EXW <strong>{proPriceText(o.EXW, o.currency)}</strong>{o.EXW !== null ? ' le kg' : ''}</p>
                <p className="text-[13px]">FOB <strong>{proPriceText(o.FOB, o.currency)}</strong>{o.FOB !== null ? ' le kg' : ''}</p>
                <p className="mt-0.5 text-[11.5px] text-fg-faint">Minimum {unitText(o.unit, o.min)} · palier {unitText(o.unit, o.step)}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
