import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Sheet } from './ui';
import { cx, glow } from '../lib/ui';
import { SPACES, useSpace, type Space } from '../lib/space';

/**
 * Fond d'écran (components/Backdrop.tsx) : noir végétal traversé d'une lueur olive, lueur mousse
 * en haut à gauche — « comme un étal éclairé de nuit ».
 */
export function Backdrop({ tint }: { tint?: string }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-bg">
      <span className="absolute left-1/2 top-[12%] h-[70vh] w-[170vw] max-w-[1500px] -translate-x-1/2">
        <span className="ambient-a absolute inset-0" style={{ backgroundImage: glow(tint ?? '#5E4E1F', tint ? 0.3 : 0.62) }} />
      </span>
      <span
        className="ambient-b absolute aspect-square w-[min(120vw,820px)]"
        style={{ left: 'max(-55vw, -330px)', top: 'max(-50vw, -340px)', backgroundImage: glow('#33501C', 0.42) }}
      />
    </div>
  );
}

/** Nom de la marque dans sa voix « étiquette », suivi du nom de l'espace. */
export function Wordmark({ compact, responsive }: { compact?: boolean; responsive?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className={cx('poster-voice leading-none tracking-[0.1em]', compact ? 'text-[25px]' : 'text-[30px]')}>Tropicaura</span>
      <span className={cx('h-px w-[22px] shrink-0 bg-line-strong', responsive && 'hidden min-[1360px]:block')} />
      <span className={cx('label-voice truncate text-leaf', compact ? 'text-[12.5px]' : 'text-[13.5px]', responsive && 'hidden min-[1360px]:block')}>Tour de contrôle</span>
    </span>
  );
}

export type Tab = { to: string; label: string; end: boolean; hint: string };
const TABS: Tab[] = [
  { to: '/', label: 'Contrôle', end: true, hint: 'État du catalogue et tâches' },
  { to: '/produits', label: 'Produits', end: false, hint: 'Fiches, photos, commercialisation' },
  { to: '/prix', label: 'Prix', end: false, hint: 'Prix et disponibilités, en série' },
  { to: '/rayons', label: 'Rayons', end: false, hint: 'Les rayons du catalogue' },
  { to: '/introuvables', label: 'Introuvables', end: false, hint: 'Demandes des clients' },
  { to: '/publications', label: 'Publications', end: false, hint: 'Vidéos, photos et annonces' },
  { to: '/reglages', label: 'Réglages', end: false, hint: 'Compte, équipe, règles, publication' },
];

/** Largeur de la fenêtre, suivie en direct. */
function useWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

/**
 * Une barre courte et ordonnée : les destinations de tous les jours dans la barre, le reste sous
 * « Plus », et l'espace commandes toujours à l'extrémité droite.
 *  - grand écran (1100 px et plus) : les six destinations ;
 *  - en dessous : Contrôle, Produits, Prix + « Plus » ;
 *  - très petit téléphone (moins de 360 px) : Contrôle, Produits + « Plus ».
 */
function useNav() {
  const width = useWidth();
  const { pathname } = useLocation();
  const { to } = useSpace();
  const tabs = TABS.map((t) => ({ ...t, to: to(t.to) }));
  const shown = width >= 1100 ? tabs.length : width >= 360 ? 3 : 2;
  const more = tabs.slice(shown);
  return { home: to('/'), bar: tabs.slice(0, shown), more, moreActive: more.some((t) => pathname === t.to || pathname.startsWith(`${t.to}/`)) };
}

/** Panneau « Plus » : les autres écrans, en liste. */
export function MoreSheet({ open, onClose, tabs }: { open: boolean; onClose: () => void; tabs: Tab[] }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <Sheet open={open} onClose={onClose} title="Plus">
      <div className="overflow-hidden rounded-[22px] border border-line bg-surface">
        {tabs.map((tab) => {
          const on = pathname === tab.to || pathname.startsWith(`${tab.to}/`);
          return (
            <button
              key={tab.to}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => {
                onClose();
                navigate(tab.to);
              }}
              className="row-tap flex min-h-[60px] w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-b-0"
            >
              <span className={cx('h-2 w-2 shrink-0 rounded-full', on ? 'bg-leaf' : 'bg-transparent')} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] font-bold leading-5">{tab.label}</span>
                <span className="block truncate text-[12.5px] text-fg-faint">{tab.hint}</span>
              </span>
              <span aria-hidden className="shrink-0 text-[20px] leading-none text-fg-faint">
                ›
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

const TAB = 'relative flex h-11 items-center justify-center rounded-full px-2.5 text-[13px] transition-colors duration-300 min-[430px]:px-3.5 min-[430px]:text-[13.5px] max-[383px]:px-[7px] max-[383px]:text-[12px]';
const pillMotion = { type: 'spring', stiffness: 420, damping: 34 } as const;

/** Téléphone : barre flottante en bas d'écran (components/TabBar.tsx). */
function TabBar({ badge }: { badge: number }) {
  const { bar, more, moreActive, home } = useNav();
  const { to } = useSpace();
  const [open, setOpen] = useState(false);
  return (
    <nav
      aria-label="Navigation principale"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-2 lg:hidden"
      style={{ paddingBottom: 'calc(max(env(safe-area-inset-bottom), 14px))' }}
    >
      <span className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-bg via-bg/85 to-transparent" />
      <div className="pointer-events-auto relative flex max-w-full items-center rounded-full border border-line-strong bg-bar p-1.5 max-[383px]:p-1">
        {bar.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className="press press-deep block min-w-11 shrink-0 rounded-full">
            {({ isActive }) => (
              <span className={cx(TAB, isActive ? 'font-extrabold text-on-leaf' : 'font-bold text-fg-dim')}>
                {isActive && <motion.span layoutId="onglet-actif" initial={false} className="absolute inset-0 bg-leaf" style={{ borderRadius: 9999 }} transition={pillMotion} />}
                <span className="relative">{tab.label}</span>
                {/* Tâches en attente : un point, sans chiffre, pour ne pas charger la barre. */}
                {tab.to === home && badge > 0 && !isActive && <span className="absolute right-1 top-1.5 h-2 w-2 rounded-full bg-leaf" aria-label={`${badge} à traiter`} role="img" />}
              </span>
            )}
          </NavLink>
        ))}
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Plus d’écrans" className="press press-deep block min-w-11 shrink-0 rounded-full">
          <span className={cx(TAB, moreActive ? 'font-extrabold text-on-leaf' : 'font-bold text-fg-dim')}>
            {moreActive && <motion.span layoutId="onglet-actif" initial={false} className="absolute inset-0 bg-leaf" style={{ borderRadius: 9999 }} transition={pillMotion} />}
            <span className="relative">Plus</span>
          </span>
        </button>
        {/* Espace commandes : à l'extrémité droite de la barre, sur chaque page. */}
        <Link
          to={to('/commandes')}
          aria-label="Ouvrir l’espace commandes"
          className="press press-deep ml-1.5 flex h-11 shrink-0 items-center rounded-full bg-star px-3 text-[13px] font-extrabold text-bg-deep min-[430px]:px-4 min-[430px]:text-[13.5px] max-[383px]:ml-1 max-[383px]:text-[12.5px]"
        >
          Commandes
        </Link>
      </div>
      <MoreSheet open={open} onClose={() => setOpen(false)} tabs={more} />
    </nav>
  );
}

/** Grand écran : barre du haut (components/DesktopBar.tsx) — la marque, les écrans, les commandes. */
function DesktopBar({ badge, flow }: { badge: number; flow?: boolean }) {
  const { bar, more, moreActive, home } = useNav();
  const { to } = useSpace();
  const [open, setOpen] = useState(false);
  const link = 'press relative flex h-11 shrink-0 items-center gap-2 rounded-full px-3 min-[1360px]:px-4';
  const underline = <motion.span layoutId="trait-actif" initial={false} className="absolute inset-x-[18px] bottom-[3px] h-0.5 bg-leaf" style={{ borderRadius: 2 }} transition={pillMotion} />;
  return (
    <header className={cx('z-30 hidden h-[76px] items-center justify-center border-b border-line bg-[rgba(11,14,9,0.86)] backdrop-blur-md lg:flex', flow ? 'relative' : 'sticky top-0')} data-barre="menu">
      <div className="flex w-full max-w-[1400px] items-center gap-3 px-5 min-[1100px]:gap-6 min-[1100px]:px-8">
        <NavLink to={home} className="flex min-h-11 shrink-0 items-center" aria-label="Tropicaura, tour de contrôle : accueil">
          <Wordmark responsive />
        </NavLink>
        <SpaceSwitch />
        <nav aria-label="Navigation principale" className="flex min-w-0 flex-1 items-center justify-center gap-1">
          {bar.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end} className={link}>
              {({ isActive }) => (
                <>
                  <span className={cx('text-[14.5px]', isActive ? 'font-bold text-fg' : 'font-semibold text-fg-dim')}>{tab.label}</span>
                  {tab.to === home && badge > 0 && (
                    <span className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-leaf px-[5px] text-[11px] font-extrabold text-on-leaf">{badge}</span>
                  )}
                  {isActive && underline}
                </>
              )}
            </NavLink>
          ))}
          {more.length > 0 && (
            <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Plus d’écrans" className={link}>
              <span className={cx('text-[14.5px]', moreActive ? 'font-bold text-fg' : 'font-semibold text-fg-dim')}>Plus</span>
              {moreActive && underline}
            </button>
          )}
        </nav>
        {/* Espace commandes : à l'extrémité droite de la barre, sur chaque page. */}
        <Link to={to('/commandes')} aria-label="Ouvrir l’espace commandes" className="press flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-star px-4 text-[13.5px] font-extrabold text-bg-deep">
          Commandes <span aria-hidden>→</span>
        </Link>
      </div>
      <MoreSheet open={open} onClose={() => setOpen(false)} tabs={more} />
    </header>
  );
}

/**
 * Commutateur d'espace : le nom de l'espace ouvert, bien visible, dans son accent (vert
 * Particuliers, or Pros) ; un toucher ouvre l'autre espace, à la même page.
 */
export function SpaceSwitch({ className }: { className?: string }) {
  const { space } = useSpace();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const other: Space = space === 'b2c' ? 'b2b' : 'b2c';
  const go = () => {
    // Même page dans l'autre espace ; une fiche produit n'y existe pas : on ouvre la liste.
    const rest = pathname.replace(/^\/(particuliers|pros)/, '').replace(/^\/produits\/.+/, '/produits');
    navigate(`/${SPACES[other].slug}${rest}`);
  };
  return (
    <span className={cx('flex shrink-0 items-center gap-1 rounded-full border border-line-strong bg-surface p-1', className)} role="group" aria-label="Espace de la tour">
      {(['b2c', 'b2b'] as Space[]).map((s) => {
        const on = s === space;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={on ? undefined : go}
            className={cx(
              'press flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] transition-colors',
              on ? (s === 'b2b' ? 'bg-star font-extrabold text-bg-deep' : 'bg-[#a8d54f] font-extrabold text-[#11180a]') : 'font-bold text-fg-dim',
            )}
          >
            {on && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
            {s === 'b2b' ? (on ? SPACES.b2b.label : SPACES.b2b.short) : SPACES.b2c.label}
          </button>
        );
      })}
    </span>
  );
}

/** Cadre commun aux écrans de l'administration. */
export function Layout({ badge }: { badge: number }) {
  const { pathname } = useLocation();
  // Une fiche produit est une page « pleine », comme dans l'application : sa propre barre du bas.
  const inEditor = /^\/(particuliers|pros)\/produits\/.+/.test(pathname);
  const { loading } = useData();
  const { canEdit } = useAuth();
  return (
    <div className="relative min-h-dvh">
      <Backdrop />
      {/* Sur une fiche produit, le menu ne suit pas le défilement : toute la hauteur va à la fiche. */}
      <DesktopBar badge={badge} flow={inEditor} />
      <main
        className={cx('relative z-10 mx-auto w-full max-w-[720px] lg:max-w-[1400px] lg:px-3', inEditor ? '' : 'pb-[124px] lg:pb-20')}
        aria-busy={loading || undefined}
      >
        {!canEdit && (
          <div
            className="mx-5 flex min-h-12 items-center gap-2.5 rounded-full border border-line bg-surface pl-4 pr-1 text-[13px] leading-[17px] text-fg-dim lg:mt-4"
            style={{ marginTop: 'calc(env(safe-area-inset-top) + 10px)' }}
            role="note"
          >
            <span className="min-w-0 flex-1">
              <strong className="font-bold text-fg">Mode visite</strong> · lecture seule, rien n’est enregistré
            </span>
            <Link to="/connexion" className="press flex min-h-11 shrink-0 items-center rounded-full bg-leaf px-4 text-[13px] font-extrabold text-on-leaf">
              Se connecter
            </Link>
          </div>
        )}
        {/* Téléphone : le nom de l'espace et son commutateur, en tête de chaque écran. */}
        {!inEditor && (
          <div className="flex justify-center px-5 lg:hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
            <SpaceSwitch />
          </div>
        )}
        <Outlet />
      </main>
      {!inEditor && <TabBar badge={badge} />}
      <ScrollRestoration />
    </div>
  );
}
