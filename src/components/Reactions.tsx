import { useCallback, useEffect, useState } from 'react';
import { GhostButton } from './ui';
import { api, messageOf } from '../lib/api';
import { MONTHS, plural } from '../lib/format';
import { cx } from '../lib/ui';

// ───────────── Statistiques d'une vidéo ou d'une publication photo : ce que les clients y ont fait

export type Stats = { views: number; likes: number; comments: number };
type Kind = 'view' | 'like' | 'comment';
type Item = { id: number; kind: Kind; who: string; name: string; type: 'particulier' | 'pro'; text: string; at: string };
type Detail = { stats: Stats; items: Item[] };

const EMPTY: Stats = { views: 0, likes: 0, comments: 0 };

/** « 12 vues · 3 J’aime · 2 commentaires », sur les cartes de la liste. */
export function StatLine({ stats }: { stats?: Stats }) {
  const s = stats ?? EMPTY;
  return (
    <span className="tabular block text-[12.5px] font-semibold leading-[18px] text-fg-dim" data-stats="ligne">
      {plural(s.views, 'vue', 'vues')} · {s.likes} J’aime · {plural(s.comments, 'commentaire', 'commentaires')}
    </span>
  );
}

/** « 26 novembre à 13h02 » */
function when(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTHS[d.getMonth()]} à ${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
}
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

const FILTERS: { value: Kind | 'all'; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'comment', label: 'Commentaires' },
  { value: 'like', label: 'J’aime' },
  { value: 'view', label: 'Vues' },
];
const PAGE = 40;

/**
 * Le détail d'une publication : les trois totaux, puis tout ce que les clients ont fait — vues,
 * J'aime, commentaires — du plus récent au plus ancien. `video` règle seulement le vocabulaire.
 */
export function ReactionsPanel({ id, video, className }: { id: string; video?: boolean; className?: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await api<Detail>(`/api/publications?reactions=${encodeURIComponent(id)}`));
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    setDetail(null);
    setFilter('all');
    setShown(PAGE);
    load();
  }, [load]);

  const stats = detail?.stats ?? EMPTY;
  const list = (detail?.items ?? []).filter((i) => filter === 'all' || i.kind === filter);
  const count = (k: Kind | 'all') => (k === 'all' ? stats.views + stats.likes + stats.comments : k === 'view' ? stats.views : k === 'like' ? stats.likes : stats.comments);
  const did = (i: Item) => (i.kind === 'view' ? (video ? 'a regardé la vidéo' : 'a vu la publication') : i.kind === 'like' ? 'a aimé' : 'a commenté');
  const tiles: [string, number][] = [
    ['Vues', stats.views],
    ['J’aime', stats.likes],
    ['Commentaires', stats.comments],
  ];

  return (
    <section className={cx('card p-[18px]', className)} aria-label="Statistiques de la publication" data-stats="panneau">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-[19px] font-semibold leading-6">Statistiques</h3>
        <GhostButton compact label={loading ? 'Lecture…' : 'Actualiser'} disabled={loading} onClick={load} />
      </div>
      {/* Trois tuiles côte à côte — la troisième plus large, pour « Commentaires ». Sur un très petit écran, trois lignes. */}
      <div className="mt-3 grid grid-cols-1 gap-2 min-[360px]:grid-cols-[1fr_1fr_1.45fr]">
        {tiles.map(([label, n]) => (
          <div key={label} className="flex min-w-0 flex-row-reverse items-center justify-between rounded-2xl bg-black/25 px-4 py-2 min-[360px]:block min-[360px]:px-2 min-[360px]:py-3 min-[360px]:text-center">
            <p className="tabular font-display text-[26px] font-semibold leading-8" data-stats={label}>
              {detail ? n : '–'}
            </p>
            <p className="whitespace-nowrap text-[12.5px] font-semibold leading-4 text-fg-dim min-[360px]:text-[12px]">{label}</p>
          </div>
        ))}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[13.5px] font-semibold leading-[19px] text-danger">
          {error}
        </p>
      ) : detail && count('all') === 0 ? (
        <p className="mt-3 text-[13.5px] leading-5 text-fg-dim">
          Aucune activité pour l’instant. Les vues, les J’aime et les commentaires des clients arrivent ici dès qu’ils utilisent l’application, une fois le correctif appliqué.
        </p>
      ) : detail ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Activité à afficher">
            {FILTERS.map((f) => {
              const on = filter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setFilter(f.value);
                    setShown(PAGE);
                  }}
                  className={cx('press flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] transition-colors duration-200', on ? 'border-leaf bg-leaf font-extrabold text-on-leaf' : 'border-line bg-surface font-bold text-fg-dim')}
                >
                  {f.label}
                  <span className="tabular opacity-80">{count(f.value)}</span>
                </button>
              );
            })}
          </div>
          {list.length === 0 ? (
            <p className="mt-3 text-[13.5px] leading-5 text-fg-dim">Rien dans cette catégorie pour l’instant.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2" data-stats="activite">
              {list.slice(0, shown).map((i) => (
                <li key={i.id} className="flex gap-3 rounded-2xl bg-black/20 px-3 py-2.5">
                  <span aria-hidden className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12.5px] font-extrabold', i.kind === 'comment' ? 'bg-leaf-wash text-leaf' : 'bg-surface-strong text-fg-dim')}>
                    {initials(i.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] leading-[19px]">
                      <span className="break-words font-bold">{i.name || 'Compte sans nom'}</span>
                      {i.type === 'pro' && <span className="text-fg-faint"> · professionnel</span>} <span className="text-fg-dim">{did(i)}</span>
                    </span>
                    {i.kind === 'comment' && <span className="mt-1 block whitespace-pre-line break-words text-[14px] leading-5">« {i.text} »</span>}
                    <span className="mt-0.5 block text-[12px] leading-4 text-fg-faint">{when(i.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {list.length > shown && <GhostButton className="mt-3 w-full" label={`Afficher la suite (${list.length - shown})`} onClick={() => setShown((n) => n + PAGE)} />}
          <p className="mt-3 text-[12.5px] leading-[18px] text-fg-faint">
            Une vue compte une fois par compte. Un J’aime retiré ou un commentaire supprimé par le client disparaît d’ici. Les commentaires ne sont pas montrés aux autres clients.
          </p>
        </>
      ) : (
        <p className="mt-3 text-[13.5px] leading-5 text-fg-dim">Lecture des statistiques…</p>
      )}
    </section>
  );
}
