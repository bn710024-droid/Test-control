import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { add } from '../lib/glyphs';
import { Icon } from './Icon';
import { Chip, Switch } from './ui';
import { useData, type Category, type Product } from '../contexts/DataContext';
import { MONTHS, MONTH_INITIALS, currentMonth, euro, unitTiny } from '../lib/format';
import { cx, fit, glow, roundSize } from '../lib/ui';
import type { Mode, ProductRow } from '../../shared/catalog.js';
import { zoneLabel } from '../../shared/catalog.js';


/** Photo détourée d'un produit sur son halo de teinte — jamais déformée, jamais sur fond plein. */
export function ProductArt({ product, size, variant = 'thumb', halo = 0.6, src: forced, ratio: forcedRatio, eager }: {
  product: Pick<ProductRow, 'photo_url' | 'photo_asset' | 'photo_ratio' | 'tint'>;
  size: number;
  variant?: 'thumb' | 'full';
  halo?: number;
  /** Aperçu d'une photo pas encore enregistrée. */
  src?: string | null;
  ratio?: number;
  eager?: boolean;
}) {
  const { photoOf } = useData();
  const src = forced !== undefined ? forced : photoOf(product, variant);
  const box = fit(forcedRatio ?? product.photo_ratio ?? 1, size * 0.86, size * 0.86);
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {halo > 0 && <span className="absolute inset-0" style={{ backgroundImage: glow(product.tint || '#7AAA2C', halo) }} />}
      {src ? (
        <img
          src={src}
          alt=""
          width={box.width}
          height={box.height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          className="relative object-contain"
          style={{ width: box.width, height: box.height }}
        />
      ) : (
        <span
          className="relative grid place-items-center rounded-[14px] border border-dashed border-line-strong text-fg-faint"
          style={{ width: size * 0.7, height: size * 0.7 }}
        >
          <span className="text-center text-[9.5px] font-bold uppercase leading-[11px] tracking-[0.06em] text-fg-faint">Sans<br />photo</span>
        </span>
      )}
    </span>
  );
}

/** Rayon rond illustré sur fond sombre — HomeScreen.tsx (filter, filterIcon, filterLabel). */
export function CategoryRound({ src, ratio, label, active, onClick, badge, to, scale = 1, sub, roomy }: {
  src: string | null;
  ratio: number;
  label: string;
  active?: boolean;
  onClick?: () => void;
  to?: string;
  badge?: number;
  scale?: number;
  sub?: string;
  /** Version aérée : plus large, et le nom passe sur deux lignes au lieu d'être coupé. */
  roomy?: boolean;
}) {
  const dim = roundSize(ratio, scale);
  const disc = Math.round(58 * scale);
  const inner = (
    <>
      <span
        className={cx(
          'relative grid place-items-center rounded-full transition-colors duration-150',
          active ? 'border-2 border-leaf bg-[rgba(168,213,79,0.2)]' : 'border border-line bg-surface',
        )}
        style={{ width: disc, height: disc }}
      >
        {src ? (
          <img src={src} alt="" loading="lazy" decoding="async" draggable={false} width={dim.width} height={dim.height} className="object-contain" style={dim} />
        ) : (
          <span className="text-center text-[9.5px] font-bold uppercase leading-[11px] tracking-[0.06em] text-fg-faint">Sans<br />photo</span>
        )}
        {badge !== undefined && (
          <span className="tabular absolute -right-1.5 -top-1 grid h-5 min-w-5 place-items-center rounded-full border-2 border-bg bg-tile px-1 text-[10.5px] font-extrabold leading-none text-fg">
            {badge}
          </span>
        )}
      </span>
      <span className={cx('w-full text-center text-[12px]', roomy ? 'line-clamp-2 break-words leading-[15px] lg:text-[13px] lg:leading-4' : 'truncate', active ? 'font-extrabold text-fg' : 'font-semibold text-fg-dim')}>
        {label}
      </span>
      {sub && <span className="-mt-1.5 w-full truncate text-center text-[10.5px] text-fg-faint">{sub}</span>}
    </>
  );
  const cls = cx('press flex shrink-0 flex-col items-center gap-2', roomy && 'w-[84px] lg:w-[92px]');
  const style = roomy ? undefined : { width: Math.round(76 * scale) };
  if (to) {
    return (
      <Link to={to} className={cls} style={style} aria-label={`Rayon ${label}${badge !== undefined ? `, ${badge} produits` : ''}`}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-label={`Rayon ${label}`} className={cls} style={style}>
      {inner}
    </button>
  );
}

/** Rangée défilante des rayons, « Tout » en tête, comme sur l'accueil de l'application. */
export function CategoryRail({ value, onChange, counts, total, linkTo, roomy }: {
  value?: string;
  onChange?: (id: string) => void;
  counts?: Record<string, number>;
  total?: number;
  linkTo?: (id: string) => string;
  roomy?: boolean;
}) {
  const { categories, artOf, filterOf } = useData();
  const all = filterOf('tout');
  return (
    <div className={cx('no-scrollbar flex overflow-x-auto px-3.5 pb-1 pt-1', roomy && 'gap-x-1.5 lg:flex-wrap lg:gap-y-4 lg:overflow-visible')} role={onChange ? 'group' : undefined} aria-label="Rayons">
      <CategoryRound
        src={all.src}
        ratio={all.ratio}
        label={all.label}
        active={value === 'tout'}
        onClick={onChange ? () => onChange('tout') : undefined}
        to={linkTo?.('tout')}
        badge={total}
        roomy={roomy}
      />
      {categories.map((c: Category) => {
        const art = artOf(c);
        return (
          <CategoryRound
            key={c.id}
            src={art.src}
            ratio={art.ratio}
            label={c.label}
            active={value === c.id}
            onClick={onChange ? () => onChange(c.id) : undefined}
            to={linkTo?.(c.id)}
            badge={counts ? (counts[c.id] ?? 0) : undefined}
            roomy={roomy}
          />
        );
      })}
    </div>
  );
}

/** Calendrier de saison (components/SeasonStrip.tsx). Avec `onToggle`, chaque mois se touche. */
export function SeasonStrip({ months, tint, onToggle }: { months: number[]; tint: string; onToggle?: (month: number) => void }) {
  const now = currentMonth();
  return (
    <div className={onToggle ? 'grid grid-cols-6 gap-x-[5px] gap-y-2.5 sm:grid-cols-12 lg:grid-cols-6 xl:grid-cols-12' : 'flex gap-[5px]'} role={onToggle ? 'group' : 'img'} aria-label={onToggle ? 'Mois de disponibilité' : `Mois de saison : ${months.length === 12 ? 'toute l’année' : months.map((m) => MONTHS[m - 1]).join(', ') || 'aucun'}`}>
      {MONTH_INITIALS.map((letter, i) => {
        const month = i + 1;
        const on = months.includes(month);
        const current = month === now;
        const cell = (
          <>
            <span
              className={cx('block h-[34px] w-full rounded-lg transition-colors duration-150', !on && 'bg-white/[0.07]', current && 'border-2 border-fg')}
              style={on ? { backgroundColor: tint } : undefined}
            />
            <span className={cx('text-[11.5px]', current ? 'font-extrabold text-fg' : on ? 'font-semibold text-fg-dim' : 'font-semibold text-fg-faint')}>
              {letter}
            </span>
          </>
        );
        return onToggle ? (
          <button
            key={month}
            type="button"
            aria-pressed={on}
            aria-label={`${MONTHS[month - 1]}${current ? ' (mois en cours)' : ''}`}
            onClick={() => onToggle(month)}
            className="press flex min-h-[58px] flex-col items-center gap-[7px]"
          >
            {cell}
          </button>
        ) : (
          <span key={month} className="flex flex-1 flex-col items-center gap-[7px]">
            {cell}
          </span>
        );
      })}
    </div>
  );
}

/** Prix affiché d'un produit dans l'administration. Rien n'est inventé : un prix absent se dit. */
export function priceInfo(p: Product): { text: string; unit: string; missing: boolean } {
  if (p.retail && p.retail.price !== null) {
    return { text: euro(p.retail.price), unit: p.retail.unit === 'kg' ? 'le kg' : unitTiny(p.retail.unitLabel), missing: false };
  }
  if (p.retail) return { text: 'Prix à fixer', unit: '', missing: true };
  if (p.wholesale.length > 0) return { text: 'Pro uniquement', unit: '', missing: false };
  return { text: 'Aucun prix', unit: '', missing: true };
}

export function StatusChips({ product, max = 5 }: { product: Product; max?: number }) {
  const { issuesOf } = useData();
  const issues = issuesOf(product);
  const chips: ReactNode[] = [];
  if (product._seal && product._seal !== 'ok') chips.push(<Chip key="seal" tone="danger">À valider</Chip>);
  if (product.archived) chips.push(<Chip key="arch">Archivé</Chip>);
  // Où le produit s'affiche : toujours écrit, pour le lire sans ouvrir la fiche.
  if (product.zone) chips.push(<Chip key="zone" tone={product.zone.mode === 'all' ? 'neutral' : 'leaf'}>{zoneLabel(product.zone, true)}</Chip>);
  if ((product.retail?.countryPrices?.length ?? 0) > 0 || product.wholesale.some((o) => (o.countryPrices?.length ?? 0) > 0)) chips.push(<Chip key="prix-pays">Prix par pays</Chip>);
  if (issues.length > 0) chips.push(<Chip key="todo" tone="star">À compléter · {issues.length}</Chip>);
  if (product.is_example) chips.push(<Chip key="ex">Exemple</Chip>);
  if (chips.length === 0) return null;
  return <span className="mt-2 flex flex-wrap gap-1.5">{chips.slice(0, max)}</span>;
}

/** Ligne de la liste des produits : photo, nom, prix, état — et l'interrupteur de visibilité. */
export function ProductRowCard({ product: p, onToggle, busy }: { product: Product; onToggle: (next: boolean) => void; busy?: boolean }) {
  const price = priceInfo(p);
  const modes = p.wholesale.map((o) => o.mode).filter((m): m is Mode => !!m);
  const sub = [p.variety, p.origin].filter(Boolean).join(' · ');
  return (
    <article className={cx('card flex items-center gap-1 p-2.5 pr-3.5', p.archived && 'opacity-70')}>
      <Link to={`/produits/${p.id}`} className="press flex min-w-0 flex-1 items-center gap-3" aria-label={`Ouvrir la fiche ${p.name}`}>
        <ProductArt product={p} size={74} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15.5px] font-bold leading-5">{p.name}</span>
            {p.bio && <span className="shrink-0 rounded-full bg-leaf-wash px-1.5 py-px text-[10px] font-extrabold uppercase tracking-[0.05em] text-leaf">Bio</span>}
          </span>
          <span className={cx('mt-px block truncate text-[12.5px]', sub ? 'text-fg-faint' : 'italic text-fg-faint')}>
            {sub || 'Variété et origine à renseigner'}
          </span>
          <span className="mt-1.5 flex items-center gap-2">
            <span className={cx('tabular text-[14.5px] font-extrabold', price.missing && 'text-star')}>{price.text}</span>
            {price.unit && <span className="truncate text-[12px] text-fg-faint">{price.unit}</span>}
            {modes.map((m) => (
              <span key={m} className="shrink-0 text-[11.5px] font-bold text-fg-dim">· {m}</span>
            ))}
          </span>
          <StatusChips product={p} />
        </span>
      </Link>
      {!p.archived && (
        <span className="flex shrink-0 flex-col items-center gap-1.5 pl-1">
          <Switch
            checked={p.available}
            onChange={onToggle}
            busy={busy}
            label={`${p.name} : ${p.available ? 'visible dans l’application, toucher pour masquer' : 'masqué, toucher pour rendre visible'}`}
          />
          <span className={cx('text-[11px] font-bold', p.available ? 'text-leaf' : 'text-fg-faint')} aria-hidden>
            {p.available ? 'Visible' : 'Masqué'}
          </span>
        </span>
      )}
    </article>
  );
}

/**
 * Aperçu de la carte du catalogue des particuliers (components/ProductCard.tsx) : mêmes cotes,
 * même photo qui dépasse du haut de la carte. Décoratif : les boutons ne font rien.
 */
export function CardPreview({ name, origin, tint, src, ratio, price, unit, width = 172 }: {
  name: string;
  origin: string;
  tint: string;
  src: string | null;
  ratio: number;
  price: string | null;
  unit: string;
  width?: number;
}) {
  const LIFT = 54;
  const IMG_H = 128;
  const box = fit(ratio, width - 12, IMG_H);
  return (
    <div className="relative" style={{ width }} aria-hidden>
      <div className="card-lit" style={{ marginTop: LIFT }}>
        <div style={{ height: IMG_H - LIFT + 8 }} />
        <div className="px-3.5 pb-3.5">
          <p className="truncate text-[16px] font-bold leading-[21px]">{name || 'Nom du produit'}</p>
          <p className="mt-0.5 truncate text-[12.5px] leading-[17px] text-fg-faint">{origin || 'Origine'}</p>
          <div className="mt-3 flex min-h-9 items-center pr-[71px]">
            <div className="min-w-0">
              <p className={cx('tabular truncate font-extrabold', price ? 'text-[16.5px] leading-[21px]' : 'text-[13px] leading-[17px] text-star')}>
                {price ?? 'Prix à fixer'}
              </p>
              {price && <p className="truncate text-[11.5px] leading-[15px] text-fg-faint">{unit}</p>}
            </div>
          </div>
        </div>
      </div>
      <span className="absolute left-0.5" style={{ top: -7, width: width - 4, height: IMG_H + 14, backgroundImage: glow(tint, 0.42) }} />
      <span className="absolute left-1.5 top-0 grid place-items-center" style={{ width: width - 12, height: IMG_H }}>
        {src ? (
          <img src={src} alt="" draggable={false} className="object-contain" style={{ width: box.width, height: box.height }} />
        ) : (
          <span className="grid h-[84px] w-[84px] place-items-center rounded-[18px] border border-dashed border-line-strong text-fg-faint">
            <span className="text-center text-[9.5px] font-bold uppercase leading-[11px] tracking-[0.06em] text-fg-faint">Sans<br />photo</span>
          </span>
        )}
      </span>
      <span className="absolute bottom-[15px] right-[15px] flex h-9 items-center gap-0.5">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-leaf text-on-leaf">
          <Icon src={add} size={22} />
        </span>
      </span>
    </div>
  );
}
