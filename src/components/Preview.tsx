import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useData, type Product } from '../contexts/DataContext';
import { Backdrop } from './Shell';
import { CategoryRound, ProductArt, SeasonStrip } from './catalog';
import { Segmented } from './ui';
import { MONTHS, amount, currentMonth, euro, isAllYear, isInSeason, nextSeasonStart } from '../lib/format';
import { cx, glow } from '../lib/ui';
import { currencyOf, packPrice, packsFor } from '../../shared/zones.js';
import { countryName, packContent, packCountryRules, packFor, packRange, packRuleText, packTotal, zoneAllows, zoneLabel, type PackAudience, type Packaging, type Zone } from '../../shared/catalog.js';

// ───────────── Atelier : une configuration prend tout l'écran, l'aperçu client à côté

type Bench = { active: string | null; el: HTMLElement | null; open: (id: string) => void };
/** Permet à une section de se déployer dans l'atelier, puis de reprendre sa place. */
export const BenchContext = createContext<Bench | null>(null);
export const useBench = () => useContext(BenchContext);

/**
 * Atelier de configuration : la zone de réglage occupe tout l'écran et l'aperçu client reste
 * visible à côté (sur téléphone : un appui pour passer de l'un à l'autre). « Terminé » la replie.
 */
export function Workbench({ open, onClose, title, children, bodyRef, preview, footer }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  /** Reçoit la zone de réglage : une section de la page peut s'y déployer telle quelle. */
  bodyRef?: (el: HTMLDivElement | null) => void;
  preview: ReactNode;
  footer?: ReactNode;
}) {
  const [pane, setPane] = useState<'form' | 'preview'>('form');
  useEffect(() => {
    if (!open) return;
    setPane('form');
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      // Une fenêtre ouverte par-dessus (nouveau rayon, confirmation) se ferme d'abord.
      if (e.key === 'Escape' && document.querySelectorAll('[role="dialog"]').length <= 1) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // En-tête de la configuration. Il défile avec le contenu : pour sortir, on remonte en haut.
  const top = (
    <div className="mx-auto w-full max-w-[780px] px-4 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }} data-barre="haut">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="label-voice text-[12px] leading-4 text-leaf">Configuration</p>
          <h2 className="truncate font-display text-[21px] font-semibold leading-7">{title}</h2>
        </div>
        <button type="button" onClick={onClose} className="press flex h-11 shrink-0 items-center rounded-full border border-line-strong bg-surface px-5 text-[14px] font-extrabold">
          Terminé
        </button>
      </div>
      {/* Deux volets côte à côte à partir de 1000 px ; en dessous, un seul à la fois. */}
      <div className="pt-3 min-[1000px]:hidden">
        <Segmented
          label="Réglages ou aperçu"
          full
          value={pane}
          onChange={setPane}
          options={[
            { value: 'form', label: 'Réglages' },
            { value: 'preview', label: 'Aperçu client' },
          ]}
        />
      </div>
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={`Configuration : ${title}`}
          className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-bg"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <Backdrop />
          {/* Rien n'est fixé : le titre et « Terminé » sont en tête, l'enregistrement tout en bas des réglages. */}
          <motion.div
            className="relative z-10 grid min-h-0 flex-1 grid-cols-1 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          >
            <div className={cx('min-h-0 overflow-y-auto overscroll-contain lg:px-4', pane === 'preview' && 'hidden min-[1000px]:block')} data-volet="reglages">
              {top}
              <div ref={bodyRef} className="mx-auto w-full max-w-[780px]">
                {children}
              </div>
              {footer ? (
                <div className="mx-auto w-full max-w-[780px] px-4 pt-7" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 22px)' }} data-barre="enregistrer">
                  {footer}
                </div>
              ) : (
                <div className="h-12" />
              )}
            </div>
            <aside className={cx('min-h-0 overflow-y-auto overscroll-contain pb-8 min-[1000px]:border-l min-[1000px]:border-line min-[1000px]:bg-black/25 min-[1000px]:pt-5', pane === 'form' && 'hidden min-[1000px]:block')} aria-label="Aperçu client">
              <div className="min-[1000px]:hidden">{top}</div>
              <div className="px-4 lg:px-6">{preview}</div>
            </aside>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ───────────── Téléphone : ce que le client a sous les yeux

export function Phone({ children, caption, label = 'Aperçu de l’écran du client', short }: { children: ReactNode; caption?: ReactNode; label?: string; short?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-[340px]">
      <div role="group" aria-label={label} className="clip relative rounded-[40px] border border-line-strong bg-bg shadow-[0_28px_60px_rgba(0,0,0,0.55)]">
        <span aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-[300px] w-[300px]" style={{ backgroundImage: glow('#33501C', 0.5) }} />
        <span aria-hidden className="pointer-events-none absolute -right-28 top-40 h-[320px] w-[320px]" style={{ backgroundImage: glow('#5E4E1F', 0.4) }} />
        <span aria-hidden className="absolute left-1/2 top-2.5 z-10 h-[5px] w-[72px] -translate-x-1/2 rounded-full bg-white/15" />
        <div className={cx('no-scrollbar relative overflow-y-auto overscroll-contain pt-8', short ? 'h-[470px] lg:h-[560px] lg:max-h-[calc(100dvh-240px)] lg:min-h-[380px]' : 'h-[690px] max-h-[calc(100dvh-64px)] min-h-[380px] min-[1000px]:max-h-[calc(100dvh-200px)]')}>{children}</div>
      </div>
      {caption && <p className="mt-3 px-2 text-center text-[12.5px] leading-[18px] text-fg-dim">{caption}</p>}
    </div>
  );
}

/** Le sac du panier de l'application, dessiné en traits : aucune image. */
function Bag({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cx('relative mt-1 block h-[13px] w-[16px] rounded-[4px] border-[1.6px] border-current', className)}>
      <span className="absolute -top-[6px] left-1/2 h-[5.5px] w-[7px] -translate-x-1/2 rounded-t-full border-[1.6px] border-b-0 border-current" />
    </span>
  );
}

// ───────────── Accueil de l'application : bandeau d'annonces (ou rien), rayons, « En ce moment »

export type Slide = {
  key: string;
  product: Product | null;
  accent: string;
  body: string;
  /** Image de l'équipe à la place du modèle. Chaîne vide : image pas encore choisie. */
  image?: string | null;
  link?: 'none' | 'button' | 'tap';
  buttonLabel?: string;
};

/**
 * Annonce faite d'une image de l'équipe : l'image occupe tout le bandeau. Le texte et le bouton
 * sont facultatifs — sans eux, il ne reste que l'image.
 */
export function ImageBanner({ image, body, link, buttonLabel, large }: { image: string; body: string; link: 'none' | 'button' | 'tap'; buttonLabel?: string; large?: boolean }) {
  return (
    <>
      {image ? (
        <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-3 grid place-items-center rounded-[18px] border border-dashed border-line-strong px-5 text-center text-[11.5px] font-bold uppercase leading-[17px] tracking-[0.08em] text-fg-faint">Votre image s’affiche ici</span>
      )}
      {(body || link === 'button') && <span aria-hidden className="absolute inset-x-0 bottom-0 h-[68%] bg-gradient-to-t from-black/85 via-black/45 to-transparent" />}
      <div className={cx('absolute inset-x-0 bottom-0 flex flex-col items-start', large ? 'gap-2.5 p-5' : 'gap-2 p-4 pb-5')}>
        {body && <span className={cx('line-clamp-2 max-w-[88%] font-semibold text-fg', large ? 'text-[14px] leading-5' : 'text-[11.5px] leading-[16px]')}>{body}</span>}
        {link === 'button' && (
          <span className={cx('flex w-fit max-w-full items-center gap-1.5 rounded-full border border-line-strong bg-black/50 font-bold backdrop-blur-sm', large ? 'min-h-10 pl-[15px] pr-3 text-[13.5px]' : 'h-8 pl-3 pr-2.5 text-[11.5px]')} data-apercu="bouton-annonce">
            <span className="truncate">{buttonLabel?.trim() || 'Voir le produit'}</span>
            <span className="text-leaf">›</span>
          </span>
        )}
      </div>
    </>
  );
}

function PhoneHero({ slide, count, index, onIndex }: { slide: Slide; count: number; index: number; onIndex: (i: number) => void }) {
  const p = slide.product;
  const months = p?.months ?? [];
  const kicker = !p ? 'Produit à choisir' : months.length === 0 ? 'Saison à renseigner' : isInSeason(months) ? 'Campagne en cours' : `Campagne à venir · dès ${MONTHS[nextSeasonStart(months) - 1]}`;
  const name = p?.name ?? 'Produit';
  const article = /^[aeiouyéèêh]/i.test(name) ? 'l’' : name.endsWith('e') ? 'la ' : 'le ';
  const dots = count > 1 && (
    <span className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
          {Array.from({ length: count }, (_, i) => (
            <button key={i} type="button" onClick={() => onIndex(i)} aria-label={`Annonce ${i + 1} sur ${count}`} className="grid h-6 w-6 place-items-center">
              <span className={cx('h-[5px] rounded-full transition-all duration-300', i === index ? 'w-4 bg-leaf' : 'w-[5px] bg-white/30')} />
            </button>
          ))}
        </span>
  );
  if (slide.image !== null && slide.image !== undefined) {
    return (
      <div className="card-lit relative mx-4 h-[196px] overflow-hidden !rounded-[26px]" data-apercu="bandeau">
        <ImageBanner image={slide.image} body={slide.body} link={slide.link ?? 'button'} buttonLabel={slide.buttonLabel} />
        {dots}
      </div>
    );
  }
  return (
    <div className="card-lit relative mx-4 h-[196px] overflow-hidden !rounded-[26px]" data-apercu="bandeau">
      <span aria-hidden className="absolute -right-10 -top-6 h-[230px] w-[240px]" style={{ backgroundImage: glow(p?.tint ?? '#7AAA2C', 0.5) }} />
      {p && (
        <span aria-hidden className="float absolute -right-2 bottom-4">
          <ProductArt product={p} size={132} variant="full" halo={0} />
        </span>
      )}
      <div className="relative flex h-full max-w-[62%] flex-col justify-center pl-4">
        <span className="truncate text-[9.5px] font-extrabold uppercase leading-[13px] tracking-[0.13em] text-leaf">{kicker}</span>
        <span className="mt-1.5 block font-display text-[23px] font-semibold leading-[27px]">
          <span className="block truncate">{name}</span>
          <span className="block truncate font-light italic text-[#DDD9C9]">{slide.accent || '\u00A0'}</span>
        </span>
        <span className="mt-1.5 line-clamp-2 text-[11.5px] leading-[16px] text-fg-dim">{slide.body || 'Texte de l’annonce'}</span>
        <span className="mt-2.5 flex h-8 w-fit max-w-full items-center gap-1.5 rounded-full border border-line-strong bg-white/[0.07] pl-3 pr-2.5 text-[11.5px] font-bold">
          <span className="truncate">Voir {article}{name.toLowerCase()}</span>
          <span className="text-leaf">›</span>
        </span>
      </div>
      {dots}
    </div>
  );
}

/**
 * L'accueil tel que le client le voit. Sans annonce en cours, le bandeau n'existe pas : les
 * rayons remontent sous la recherche.
 */
export function HomePreview({ slides, focus }: { slides: Slide[]; focus?: string }) {
  const { products, categories, artOf, photoOf } = useData();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const count = slides.length;
  const focused = focus ? slides.findIndex((s) => s.key === focus) : -1;
  useEffect(() => {
    if (focused >= 0) setIndex(focused);
  }, [focused, count]);
  useEffect(() => {
    if (reduced || count < 2 || focused >= 0) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), 4200);
    return () => window.clearInterval(id);
  }, [reduced, count, focused]);
  const month = currentMonth();
  const shown = products.filter((p) => !p.archived && p.available && p.retail?.price);
  const seasonal = shown.filter((p) => p.months.includes(month) && photoOf(p)).slice(0, 6);
  const stall = shown.filter((p) => photoOf(p)).slice(0, 4);
  const unitOf = (p: Product) => (p.retail ? (p.retail.unit === 'kg' ? 'le kg' : p.retail.unitLabel.split(' ').slice(0, 2).join(' ')) : '');
  const slide = count > 0 ? slides[Math.min(index, count - 1)] : null;

  return (
    <div>
      <div className="flex items-center gap-2 px-4">
        <span className="grid h-10 w-[68px] shrink-0 place-items-center rounded-[14px] border border-dashed border-line-strong text-[9px] font-bold tracking-[0.18em] text-fg-faint">LOGO</span>
        <span className="flex h-10 min-w-0 flex-1 items-center rounded-full border border-line bg-surface px-3.5 text-[12.5px] text-fg-faint">
          <span className="truncate">Mangue, melon…</span>
        </span>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-surface">
          <Bag />
        </span>
      </div>

      <AnimatePresence initial={false} mode="popLayout">
        {slide && (
          <motion.div key="bandeau" className="pt-3.5" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.28 }}>
            <PhoneHero slide={slide} count={count} index={Math.min(index, count - 1)} onIndex={setIndex} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="no-scrollbar mt-4 flex gap-0.5 overflow-x-auto px-2.5">
        <CategoryRound src="/categories/tout.webp" ratio={1.018} label="Tout" active scale={0.86} />
        {seasonal[0] && <CategoryRound src={photoOf(seasonal[0])} ratio={seasonal[0].photo_ratio} label="De saison" scale={0.86} />}
        {categories.slice(0, 5).map((c) => {
          const art = artOf(c);
          return <CategoryRound key={c.id} src={art.src} ratio={art.ratio} label={c.label} scale={0.86} />;
        })}
      </div>

      <div className="mt-4 flex items-center justify-between px-4">
        <span className="font-display text-[18px] font-semibold">En ce moment</span>
        <span className="rounded-full bg-leaf-wash px-2.5 py-1 text-[11px] font-extrabold capitalize text-leaf">{MONTHS[month - 1]}</span>
      </div>
      {/* « En ce moment » : une rangée qui défile de côté, comme dans l'application */}
      <div className="no-scrollbar mt-2.5 flex gap-2.5 overflow-x-auto px-4" data-apercu="moment">
        {seasonal.map((p) => (
          <div key={p.id} className="card flex w-[200px] shrink-0 items-center gap-3 !rounded-[22px] p-3">
            <ProductArt product={p} size={56} />
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-bold leading-[19px]">{p.name}</span>
              <span className="block truncate text-[11.5px] leading-[16px] text-fg-faint">{p.origin}</span>
              <span className="mt-1 block truncate">
                <span className="tabular text-[13.5px] font-extrabold">{p.retail?.price ? euro(p.retail.price) : ''}</span> <span className="text-[11px] text-fg-faint">{unitOf(p)}</span>
              </span>
            </span>
          </div>
        ))}
      </div>

      {/* « Tout l'étal » : la grille de produits */}
      {stall.length > 0 && (
        <>
          <div className="mt-5 flex items-baseline justify-between px-4">
            <span className="font-display text-[18px] font-semibold">Tout l’étal</span>
            <span className="text-[12px] font-semibold text-fg-dim">{shown.length} produit{shown.length > 1 ? 's' : ''}</span>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-x-2.5 gap-y-12 px-4" data-apercu="etal">
            {stall.map((p) => (
              <div key={p.id} className="card relative !rounded-[22px] px-3 pb-3 pt-[62px]">
                <span aria-hidden className="absolute inset-x-0 -top-10 grid place-items-center">
                  <ProductArt product={p} size={96} variant="full" halo={0} />
                </span>
                <span className="block truncate text-[14px] font-bold leading-[19px]">{p.name}</span>
                <span className="block truncate text-[11.5px] leading-[16px] text-fg-faint">{p.origin}</span>
                <span className="mt-2 flex items-end justify-between gap-1">
                  <span className="min-w-0">
                    <span className="tabular block text-[14.5px] font-extrabold leading-[18px]">{p.retail?.price ? euro(p.retail.price) : ''}</span>
                    <span className="block truncate text-[10.5px] leading-[14px] text-fg-faint">{unitOf(p)}</span>
                  </span>
                  <span aria-hidden className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[16px] leading-none max-[380px]:hidden">♡</span>
                    <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-leaf text-[18px] font-medium leading-none text-on-leaf">+</span>
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Barre d'onglets de l'application */}
      <div aria-hidden className="sticky bottom-3 z-10 mx-auto mt-5 flex h-[52px] w-[88%] items-center justify-between rounded-full border border-line-strong bg-[rgba(26,31,20,0.94)] pl-1.5 pr-5 shadow-[0_12px_28px_rgba(0,0,0,0.5)] backdrop-blur-md" data-apercu="onglets">
        <span className="flex h-10 items-center gap-2 rounded-full bg-surface-strong pl-1 pr-3.5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-leaf text-[15px] font-bold leading-none text-on-leaf">⌂</span>
          <span className="text-[12.5px] font-extrabold">Marché</span>
        </span>
        <span className="text-[17px] leading-none text-fg-dim">♡</span>
        <Bag className="!mt-0.5 text-fg-dim" />
        <span className="text-[15px] leading-none text-fg-dim">▤</span>
        <span className="h-[15px] w-[15px] rounded-full border-[1.6px] border-fg-dim" />
      </div>
      <div className="h-3" />
    </div>
  );
}

// ───────────── Fiche d'un produit, avec ses emballages

export type PreviewProduct = {
  name: string;
  variety: string;
  origin: string;
  description: string;
  tint: string;
  src: string | null;
  rayon: string;
  bio: boolean;
  months: number[];
  available: boolean;
  /** Prix particulier, ou null : non vendu aux particuliers ou prix non fixé. */
  price: number | null;
  unit: string;
  /** Pays qui ont leur propre prix particulier ; ailleurs, `price` (le prix global) s'applique. */
  countryPrices?: { countries: string[]; price: number }[];
  /** Règle de quantité de la vente au détail (le prix global), ou null : non vendu aux particuliers. */
  retail?: { unit: 'kg' | 'unit'; step: number; min: number | null; max: number | null; noun: [string, string] } | null;
  packs: Packaging[];
  /** Particuliers : 'emballe' (vendu par ses emballages, prix par zone) ou 'frais'. */
  kind?: 'emballe' | 'frais';
  /** Pays où le produit s'affiche. */
  zone?: Zone;
};

const forAudience = (p: Packaging, audience: 'particuliers' | 'pros') => p.available && (p.audience === 'tous' || p.audience === audience);
export const AUDIENCE_TEXT: Record<PackAudience, string> = { tous: 'Tous les clients', particuliers: 'Particuliers', pros: 'Professionnels' };

/** « 500 g », « 1,5 kg », comme le sélecteur de quantité de l'application. */
const kiloLabel = (q: number) => (q < 1 ? `${Math.round(q * 1000)}\u00A0g` : `${String(Math.round(q * 100) / 100).replace('.', ',')}\u00A0kg`);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** Sans maximum saisi, l'application s'arrête à vingt paliers. */
const APP_MAX_STEPS = 20;

/**
 * La fiche produit telle que l'application la compose : barre haute (retour, panier), cœur,
 * grande photo, étiquettes, nom, prix, description, saison, puis le quai d'achat — quantité,
 * total, « Ajouter ». Le choix de l'emballage prend la place du sélecteur d'offres de l'application.
 */
export function ProductPreview({ product: raw, focusPack }: { product: PreviewProduct; focusPack?: string | null }) {
  const [audience, setAudience] = useState<'particuliers' | 'pros'>('particuliers');
  // Pays depuis lequel on regarde : chaine vide, « un autre pays » — le prix global.
  const [from, setFrom] = useState('');
  // Pays qui ont quelque chose à eux : un prix particulier, ou un réglage d'emballage.
  const priced = [
    ...new Set([
      ...(audience === 'particuliers' ? (raw.countryPrices ?? []).flatMap((g) => g.countries) : []),
      ...raw.packs.flatMap((k) => packCountryRules(k).flatMap((g) => g.countries)),
    ]),
  ];
  // Produit emballé : vu depuis l'un de ces pays, dans sa devise, sur l'emballage par défaut de ce pays.
  const packed = raw.kind === 'emballe' && audience === 'particuliers';
  const views = ['SN', 'CI', 'FR', 'US', 'MA'];
  const here = packed ? (views.includes(from) ? from : 'SN') : priced.includes(from) ? from : '';
  const own = here && !packed && audience === 'particuliers' ? (raw.countryPrices ?? []).find((g) => g.countries.includes(here)) : undefined;
  // Vu de ce pays : son prix, et seuls les emballages qui y sont proposés, chacun à son prix dans ce pays.
  const p = packed
    ? { ...raw, price: null, retail: null, packs: packsFor(raw.packs, here).map((k) => ({ ...k, price: packPrice(k, currencyOf(here)), currency: currencyOf(here) as Packaging['currency'] })) }
    : { ...raw, price: own ? own.price : raw.price, packs: raw.packs.flatMap((k) => packFor(k, here) ?? []) };
  // Afficher le produit dans un pays est un autre réglage : s'il ne l'est pas, ce client ne voit pas la fiche.
  const notShownHere = !!here && !!raw.zone && !zoneAllows(raw.zone, here);
  const packs = p.packs.filter((k) => forAudience(k, audience));
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (focusPack) setPicked(focusPack);
  }, [focusPack]);
  const chosen = packs.find((k) => k.id === picked) ?? (packed ? (packs[0] ?? null) : null);
  const retail = audience === 'particuliers' ? (p.retail ?? null) : null;

  // Nombre d'emballages choisi dans l'aperçu : toujours ramené dans la règle de l'emballage.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const range = chosen ? packRange(chosen) : null;
  const count = (() => {
    if (!chosen || !range) return 1;
    const wanted = Math.max(range.min, Math.min(counts[chosen.id] ?? range.min, range.max ?? Infinity));
    return range.min + Math.round((wanted - range.min) / range.step) * range.step;
  })();

  // Quantité au détail : palier, minimum et maximum de « Prix particuliers », comme dans l'application.
  const [loose, setLoose] = useState<number | null>(null);
  const rStep = retail && retail.step > 0 ? retail.step : 1;
  const rMin = retail ? (retail.min ?? rStep) : 1;
  const rMax = retail ? Math.max(retail.max ?? rStep * APP_MAX_STEPS, rMin) : 1;
  const qty = round3(Math.max(rMin, Math.min(loose ?? rMin, rMax)));

  const move = (dir: 1 | -1) => {
    if (chosen && range) setCounts((c) => ({ ...c, [chosen.id]: count + dir * range.step }));
    else if (retail) setLoose(round3(qty + dir * rStep));
  };
  const canMinus = chosen && range ? count > range.min : retail ? qty > rMin : false;
  const canPlus = chosen && range ? range.max === null || count < range.max : retail ? qty < rMax : false;
  const stepLabel = chosen ? String(count) : retail ? (retail.unit === 'kg' ? kiloLabel(qty) : String(qty)) : '—';
  const over = chosen
    ? count > 1 ? 'Emballages' : 'Emballage'
    : retail && retail.unit === 'unit'
      ? `Quantité · ${retail.noun[qty > 1 ? 1 : 0] || 'pièce'}`
      : 'Quantité';
  const total = chosen
    ? chosen.price !== null ? Math.round(chosen.price * count * 100) / 100 : null
    : retail && p.price !== null ? Math.round(p.price * qty * 100) / 100 : null;

  const hiddenCount = raw.packs.length - packs.length;
  const base = audience === 'pros' ? 'Prix selon l’offre' : p.price !== null ? euro(p.price) : 'Prix à confirmer';
  const priceText = chosen ? (chosen.price !== null ? amount(chosen.price, chosen.currency) : 'Prix à confirmer') : base;
  const priceUnit = chosen ? (chosen.price !== null ? `· ${chosen.label || 'l’emballage'}` : '') : audience === 'pros' || p.price === null ? '' : p.unit;
  const allYear = isAllYear(p.months);
  const inSeason = isInSeason(p.months);
  const seasonStatus = p.months.length === 0 ? 'Saison à renseigner' : allYear ? 'Disponible toute l’année' : inSeason ? 'En pleine saison' : `Retour en ${MONTHS[nextSeasonStart(p.months) - 1]}`;
  const totalText = total !== null ? amount(total, chosen?.currency) : 'À confirmer';
  // Comme dans l'application, le total rétrécit quand il s'allonge : il n'est jamais coupé.
  const totalSize = totalText.length <= 7 ? 'text-[17px] max-[380px]:text-[15px]' : totalText.length <= 9 ? 'text-[15px] max-[380px]:text-[13px]' : 'text-[13px] max-[380px]:text-[11.5px]';
  const sheet = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const box = sheet.current?.parentElement;
    if (!box) return;
    const onScroll = () => setScrolled(box.scrollTop > 190);
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => box.removeEventListener('scroll', onScroll);
  }, []);
  const glass = 'grid h-10 w-10 place-items-center rounded-full border border-line bg-white/[0.09] backdrop-blur-md';
  const rows = [
    ...(retail ? [{ id: null as string | null, photo: null as string | null, title: 'Au détail', sub: `Prix global · ${p.unit}`, price: p.price !== null ? euro(p.price) : 'À confirmer' }] : []),
    ...packs.map((k) => ({ id: k.id as string | null, photo: k.photo_url || null, title: k.label || 'Emballage sans nom', sub: packContent(k) ? `Contient ${packContent(k)}` : 'Contenu à préciser', price: k.price !== null ? amount(k.price, k.currency) : 'À confirmer' })),
  ];

  return (
    <>
      <div className="mx-auto mb-4 max-w-[340px]">
        <p className="label-voice mb-2 text-center text-[12px] text-fg-faint">Aperçu client · vu par un</p>
        <Segmented
          label="Client simulé"
          full
          value={audience}
          onChange={(v) => {
            setAudience(v);
            setPicked(null);
          }}
          options={[
            { value: 'particuliers', label: 'Particulier' },
            { value: 'pros', label: 'Professionnel' },
          ]}
        />
      </div>
      {(packed || priced.length > 0) && (
        <div className="mx-auto mb-4 max-w-[340px]" data-apercu="pays">
          <p className="label-voice mb-2 text-center text-[12px] text-fg-faint">Vu depuis</p>
          <div className="flex flex-wrap justify-center gap-2" role="radiogroup" aria-label="Pays du client simulé">
            {(packed ? views : ['', ...priced]).map((code) => {
              const on = here === code;
              return (
                <button
                  key={code || 'ailleurs'}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setFrom(code);
                    setPicked(null);
                  }}
                  className={cx('press flex h-11 items-center rounded-full border px-4 text-[13px] transition-colors duration-200', on ? 'border-leaf bg-leaf font-extrabold text-on-leaf' : 'border-line bg-surface font-bold text-fg-dim')}
                >
                  {code ? countryName(code) : 'Autres pays'}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <Phone
        caption={
          !p.available
            ? 'Produit non commercialisé : les clients ne voient pas cette fiche pour l’instant.'
            : packed
              ? packs.length === 0
                ? `${countryName(here)} : aucun emballage n’y est vendu (pas de prix dans cette zone), le client ne voit pas ce produit.`
                : `${countryName(here)} : ouvert sur « ${packs[0].label} », ${packs[0].price !== null ? amount(packs[0].price, currencyOf(here)) : 'prix à confirmer'}.`
            : notShownHere
              ? `${countryName(here)} : le produit n’y est pas affiché (rubrique « Pays »), ce client ne voit donc pas cette fiche. Voici ce qu’il verra dès que vous l’y afficherez : les réglages de ce pays sont gardés.`
            : here && hiddenCount > 0
              ? `${countryName(here)} : ${hiddenCount} emballage${hiddenCount > 1 ? 's' : ''} non affiché${hiddenCount > 1 ? 's' : ''} à ce client (non proposé dans ce pays, masqué, ou réservé à l’autre public).`
            : here
              ? `${countryName(here)} : le produit y est affiché, avec les prix et les emballages de ce pays.`
            : p.zone && p.zone.mode !== 'all'
              ? p.zone.mode === 'sn'
                ? 'Affiché au Sénégal uniquement : ailleurs, les clients ne voient pas cette fiche.'
                : `${zoneLabel(p.zone, p.zone.except.length > 3)} : les clients de ${p.zone.except.length > 1 ? 'ces pays' : 'ce pays'} ne voient pas cette fiche.`
            : hiddenCount > 0
              ? `${hiddenCount} emballage${hiddenCount > 1 ? 's' : ''} non affiché${hiddenCount > 1 ? 's' : ''} à ce client (masqué, réservé à l’autre public, ou non proposé dans son pays).`
              : packs.length > 0
                ? 'Même composition que la fiche de l’application. Le bloc « Emballage » n’y existe pas encore : il est montré ici à la place qu’il prendrait.'
                : 'Même composition que la fiche de l’application. Elle se met à jour pendant que vous saisissez.'
        }
      >
        <div ref={sheet} className="relative -mt-8" data-apercu="fiche">
          {/* Barre haute de l'application : retour à gauche, panier à droite. Elle reste en place. */}
          <div aria-hidden className="sticky -top-8 z-20 h-0">
            <span className={cx('absolute inset-x-0 top-0 h-[96px] bg-gradient-to-b from-bg from-65% to-transparent transition-opacity duration-200', scrolled ? 'opacity-100' : 'opacity-0')} />
            <div className="absolute inset-x-4 top-[22px] flex items-center justify-between gap-3">
              <span className={cx(glass, 'shrink-0 pb-0.5 text-[22px] leading-none')}>‹</span>
              <span className={cx('min-w-0 flex-1 truncate text-center font-display text-[15.5px] font-semibold transition-opacity duration-200', scrolled ? 'opacity-100' : 'opacity-0')}>{p.name}</span>
              <span className={cx(glass, 'shrink-0')}>
                <Bag />
              </span>
            </div>
          </div>
          {/* Scène : lumière à la couleur du produit, feuilles, grande photo */}
          <div className="clip relative h-[292px]">
            <span aria-hidden className="absolute inset-x-[-20%] top-[-30px] h-[380px]" style={{ backgroundImage: glow(p.tint, 0.5) }} />
            <img aria-hidden alt="" src="/decor/leaf-blur.webp" className="absolute -left-14 top-[150px] w-[130px] rotate-[118deg] opacity-80" />
            <img aria-hidden alt="" src="/decor/leaf-soft.webp" className="absolute -right-4 top-[128px] w-[76px] -rotate-[42deg] opacity-80" />
            <img aria-hidden alt="" src="/decor/leaf.webp" className="absolute left-7 top-[84px] w-[32px] rotate-[28deg]" />
            <div className="absolute inset-x-0 bottom-3 top-[62px] grid place-items-center">
              {chosen?.photo_url ? (
                // Emballage choisi : sa photo — celle du pays regardé, s'il a la sienne.
                <img src={chosen.photo_url} alt="" className="max-h-[206px] max-w-[84%] rounded-[20px] object-contain drop-shadow-[0_18px_26px_rgba(0,0,0,0.45)]" data-apercu="photo-emballage" />
              ) : p.src ? (
                <img src={p.src} alt="" className="float max-h-[206px] max-w-[84%] object-contain drop-shadow-[0_18px_26px_rgba(0,0,0,0.45)]" />
              ) : (
                <span className="grid h-[130px] w-[130px] place-items-center rounded-full border border-dashed border-line-strong text-[11px] font-bold uppercase tracking-[0.1em] text-fg-faint">Sans photo</span>
              )}
            </div>
            <span aria-hidden className={cx(glass, 'absolute right-4 top-[74px] text-[19px] leading-none')}>♡</span>
          </div>

          <div className="px-[21px]">
            <div className="flex flex-wrap gap-1.5">
              {p.bio && (
                <span className="flex h-[26px] items-center gap-1 rounded-full border border-line bg-surface px-2.5 text-[11px] font-bold text-fg-dim">
                  <img aria-hidden alt="" src="/decor/leaf.webp" className="h-3 w-3 object-contain opacity-80" />
                  Bio
                </span>
              )}
              <span className="flex h-[26px] items-center rounded-full border border-line bg-surface px-2.5 text-[11px] font-bold text-fg-dim">{audience === 'pros' ? 'Espace professionnel' : p.rayon || 'Rayon'}</span>
            </div>
            <p className="mt-3.5 break-words font-display text-[31px] font-semibold leading-[36px] tracking-[-0.3px]">{p.name || 'Nom du produit'}</p>
            <p className="mt-1 text-[13px] font-semibold leading-[18px] text-fg-dim">{[p.variety, p.origin].filter(Boolean).join(' · ') || 'Variété · origine'}</p>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-1.5">
              <span className="tabular text-[21px] font-extrabold leading-7" data-apercu="prix">{priceText}</span>
              {priceUnit && <span className="min-w-0 truncate text-[12.5px] font-medium text-fg-dim">{priceUnit}</span>}
            </p>

            {packs.length > 0 && (
              <div className="mt-3.5 rounded-[24px] border border-line bg-surface p-[15px]" data-apercu="emballages">
                <p className="font-display text-[16.5px] font-semibold leading-[21px]">Emballage</p>
                <div className="mt-2.5 flex flex-col gap-1.5" role="radiogroup" aria-label="Emballage choisi dans l’aperçu">
                  {rows.map((r) => {
                    const on = (chosen?.id ?? null) === r.id && (r.id !== null || retail !== null);
                    return (
                      <button
                        key={r.id ?? 'detail'}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setPicked(r.id === null || (on && !retail) ? null : r.id)}
                        className={cx('press flex min-h-11 items-center gap-2.5 rounded-[16px] border px-3 py-2 text-left transition-colors duration-200', on ? 'border-leaf bg-leaf-wash' : 'border-line bg-black/20')}
                      >
                        <span className={cx('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2', on ? 'border-leaf' : 'border-line-strong')}>
                          {on && <span className="h-2 w-2 rounded-full bg-leaf" />}
                        </span>
                        {r.photo && <img src={r.photo} alt="" className="h-8 w-8 shrink-0 rounded-lg border border-line bg-black/30 object-contain" data-apercu="vignette-emballage" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold leading-[17px]">{r.title}</span>
                          <span className="block truncate text-[11px] leading-[15px] text-fg-faint">{r.sub}</span>
                        </span>
                        <span className="tabular shrink-0 text-[12.5px] font-extrabold">{r.price}</span>
                      </button>
                    );
                  })}
                </div>
                {chosen && (
                  <p className="mt-2.5 text-[11.5px] leading-[16px] text-fg-faint">
                    {packTotal(chosen, count) && (
                      <span className="block text-[12px] text-fg-dim" data-apercu="contenu">
                        {count} × {packContent(chosen)} = <span className="font-bold text-fg">{packTotal(chosen, count)}</span>
                      </span>
                    )}
                    {packRuleText(chosen)}
                  </p>
                )}
              </div>
            )}

            {chosen?.description && (
              <p className="mt-4 break-words text-[13.5px] font-bold leading-[21px] text-fg" data-apercu="description-emballage">
                {chosen.description}
              </p>
            )}
            <p className="mt-4 text-[13.5px] font-medium leading-[21.5px] text-fg-dim">{p.description || 'La description du produit s’affiche ici.'}</p>

            <div className="mt-3.5 rounded-[24px] border border-line bg-surface p-[15px]">
              <div className="mb-3.5 flex items-center justify-between gap-2.5">
                <p className="font-display text-[16.5px] font-semibold leading-[21px]">Saison</p>
                <p className={cx('flex min-w-0 items-center gap-1.5 text-[11.5px] font-bold', inSeason && p.months.length > 0 ? 'text-leaf' : 'text-fg-dim')}>
                  <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', inSeason && p.months.length > 0 ? 'bg-leaf' : 'bg-fg-faint')} />
                  <span className="truncate">{seasonStatus}</span>
                </p>
              </div>
              <SeasonStrip months={p.months} tint={p.tint} />
            </div>
          </div>
          <div className="h-10" />
        </div>

        {/* Quai d'achat de l'application : quantité, total, « Ajouter » */}
        <div className="sticky bottom-0 z-10" data-apercu="quai">
          <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-16 bottom-0 bg-gradient-to-t from-bg from-50% via-bg/90 via-70% to-transparent" />
          <div className="relative flex items-center gap-2.5 pb-2 pl-4 max-[380px]:gap-2 max-[380px]:pl-3">
            <div data-apercu="quantite">
              <p className="mb-1.5 ml-1 max-w-[112px] truncate text-[11px] font-semibold leading-[14px] text-fg-dim" data-apercu="nombre">{over}</p>
              <div className="flex items-center rounded-full border border-line bg-surface p-1">
                <button type="button" onClick={() => move(-1)} disabled={!canMinus} aria-label="Un palier de moins" className="press relative grid h-[30px] w-[30px] place-items-center rounded-full text-[17px] font-bold leading-none before:absolute before:-inset-2 disabled:opacity-30">
                  −
                </button>
                <span className="tabular min-w-[46px] px-1 text-center text-[12.5px] font-bold max-[380px]:min-w-[38px]" aria-live="polite" data-apercu="valeur">{stepLabel}</span>
                <button type="button" onClick={() => move(1)} disabled={!canPlus} aria-label="Un palier de plus" className="press relative grid h-[30px] w-[30px] place-items-center rounded-full bg-surface-strong text-[17px] font-bold leading-none before:absolute before:-inset-2 disabled:opacity-30">
                  +
                </button>
              </div>
            </div>
            <div className="min-w-0 flex-1 rounded-[20px] border border-line bg-tile px-3 py-[11px] max-[380px]:px-2">
              <p className="ml-1 text-[11px] font-semibold leading-[14px] text-fg-dim">Total</p>
              <p className={cx('tabular ml-1 mt-1 whitespace-nowrap font-extrabold leading-[22px]', totalSize)} data-apercu="total">{totalText}</p>
            </div>
            <div aria-hidden className="flex h-[120px] w-[58px] shrink-0 flex-col items-center rounded-l-[29px] bg-gradient-to-b from-[#BDE365] to-[#86B833] pt-2 shadow-[0_10px_28px_rgba(0,0,0,0.5)]">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#F8F6EC] text-[22px] font-medium leading-none text-on-leaf">+</span>
              <span className="grid w-full flex-1 place-items-center overflow-hidden">
                <span className="-rotate-90 whitespace-nowrap text-[13.5px] font-extrabold tracking-[0.2px] text-on-leaf">Ajouter</span>
              </span>
            </div>
          </div>
        </div>
      </Phone>
    </>
  );
}
