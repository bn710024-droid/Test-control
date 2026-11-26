import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { alertCircleOutline, arrowForward, close, refreshOutline } from '../lib/glyphs';
import { Icon } from './Icon';
import { cx, glow } from '../lib/ui';

// ───────────── Boutons (components/Buttons.tsx)

type PrimaryProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  trailing?: string;
  icon?: string;
  loading?: boolean;
  loadingLabel?: string;
};

export function PrimaryButton({ label, trailing, icon, loading, loadingLabel, disabled, className, type = 'button', ...rest }: PrimaryProps) {
  const shown = loading ? (loadingLabel ?? label) : label;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'press flex min-h-[58px] w-full items-center justify-between gap-3 rounded-full bg-leaf py-2 pl-6 pr-2 text-on-leaf',
        disabled && 'opacity-40',
        loading && 'opacity-85',
        className,
      )}
      {...rest}
    >
      <span className="flex min-w-0 items-center gap-[9px]">
        {icon && !loading && <Icon src={icon} size={19} />}
        <span className="truncate text-[16px] font-extrabold">{shown}</span>
      </span>
      {loading ? (
        <span className="grid h-[42px] w-[42px] place-items-center">
          <span className="spinner" />
        </span>
      ) : trailing ? (
        <span className="tabular grid h-[42px] shrink-0 place-items-center rounded-full bg-on-leaf px-4 text-[15px] font-extrabold text-leaf">
          {trailing}
        </span>
      ) : (
        <span className="grid h-[42px] w-[42px] shrink-0 place-items-center">
          <Icon src={arrowForward} size={19} />
        </span>
      )}
    </button>
  );
}

type GhostProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  icon?: string;
  tone?: 'default' | 'danger' | 'leaf';
  loading?: boolean;
  compact?: boolean;
};

export function GhostButton({ label, icon, tone = 'default', loading, compact, disabled, className, type = 'button', ...rest }: GhostProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'press flex items-center justify-center gap-2 rounded-full border px-5 font-bold',
        compact ? 'min-h-[44px] text-[14px]' : 'min-h-[50px] text-[15px]',
        tone === 'danger'
          ? 'border-danger/40 text-danger'
          : tone === 'leaf'
            ? 'border-leaf/50 text-leaf'
            : 'border-line-strong text-fg',
        disabled && 'opacity-40',
        className,
      )}
      {...rest}
    >
      {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : icon ? <Icon src={icon} size={17} /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
}

type RoundProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: string;
  label: string;
  size?: number;
  badge?: number;
  solid?: boolean;
};

export function RoundButton({ icon, label, size = 46, badge, solid, className, type = 'button', ...rest }: RoundProps) {
  return (
    <button
      type={type}
      aria-label={badge ? `${label}, ${badge}` : label}
      title={label}
      className={cx(
        'press press-deep relative grid shrink-0 place-items-center rounded-full border',
        solid ? 'border-transparent bg-leaf text-on-leaf' : 'border-line bg-white/[0.09] text-fg',
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon src={icon} size={21} />
      {!!badge && (
        <span className="absolute -right-[3px] -top-[3px] grid h-5 min-w-5 place-items-center rounded-full border-2 border-bg bg-leaf px-[5px] text-[10.5px] font-extrabold leading-none text-on-leaf">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

// ───────────── Champs (components/Field.tsx)

type FieldBase = {
  label: string;
  optional?: boolean;
  error?: string;
  hint?: ReactNode;
  suffix?: string;
  onValue?: (value: string) => void;
  compact?: boolean;
  wrapClassName?: string;
};

function FieldFrame({ id, label, optional, error, hint, children, className }: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-[7px] mt-3.5 block text-[13px] font-semibold text-fg-dim">
        {label}
        {optional && <span className="font-medium text-fg-faint"> · facultatif</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} role="alert" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-msg`} className="mt-[7px] px-1 text-[12.5px] leading-[18px] text-fg-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Field({ label, optional, error, hint, suffix, onValue, compact, wrapClassName, id, className, ...input }: FieldBase & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldFrame id={fid} label={label} optional={optional} error={error} hint={hint} className={wrapClassName}>
      <div className="relative">
        <input
          id={fid}
          className={cx('field', compact && 'field-compact', suffix && 'pr-[58px]', className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${fid}-msg` : undefined}
          autoComplete="off"
          onChange={(e) => onValue?.(e.target.value)}
          {...input}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[13.5px] font-bold text-fg-faint">
            {suffix}
          </span>
        )}
      </div>
    </FieldFrame>
  );
}

export function TextArea({ label, optional, error, hint, onValue, wrapClassName, id, className, ...input }: Omit<FieldBase, 'suffix' | 'compact'> & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldFrame id={fid} label={label} optional={optional} error={error} hint={hint} className={wrapClassName}>
      <textarea
        id={fid}
        className={cx('field', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        onChange={(e) => onValue?.(e.target.value)}
        {...input}
      />
    </FieldFrame>
  );
}

// ───────────── Interrupteur et choix exclusif (components/IncotermToggle.tsx)

/** Petite vibration à l'appui, sur les téléphones qui le permettent. Sans effet ailleurs. */
function tap() {
  try {
    navigator.vibrate?.(8);
  } catch {
    // Non pris en charge : rien à faire.
  }
}

export function Switch({ checked, onChange, label, disabled, busy }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={() => {
        tap();
        onChange(!checked);
      }}
      className={cx(
        'group relative h-8 w-[54px] shrink-0 rounded-full border transition-colors duration-300 before:absolute before:-inset-x-1 before:-inset-y-[7px] before:content-[""]',
        checked ? 'border-leaf bg-leaf' : 'border-line-strong bg-white/[0.08]',
        (disabled || busy) && 'opacity-50',
      )}
    >
      <span
        className={cx(
          'knob absolute top-[3px] h-6 w-6 rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.35)] group-active:w-[30px]',
          checked ? 'left-[25px] bg-on-leaf group-active:left-[19px]' : 'left-[3px] bg-fg-dim',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, full }: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: string }[];
  label: string;
  full?: boolean;
}) {
  const pill = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('flex rounded-full border border-line bg-surface p-1', full ? 'w-full' : 'w-fit max-w-full')}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              if (on) return;
              tap();
              onChange(o.value);
            }}
            className={cx(
              'press relative flex h-11 min-w-[58px] items-center justify-center gap-1.5 rounded-full px-3.5 text-[13.5px] tracking-[0.02em] transition-colors duration-300',
              full && 'flex-1',
              on ? 'font-extrabold text-on-leaf' : 'font-bold text-fg-dim',
            )}
          >
            {/* La pastille verte glisse d'un choix à l'autre. */}
            {on && (
              <motion.span
                layoutId={pill}
                initial={false}
                className="absolute inset-0 bg-leaf"
                style={{ borderRadius: 9999 }}
                transition={{ type: 'spring', stiffness: 460, damping: 36 }}
              />
            )}
            {o.icon && <Icon src={o.icon} size={16} className="relative" />}
            <span className="relative truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ───────────── Pastilles

type Tone = 'neutral' | 'leaf' | 'star' | 'danger';
const TONES: Record<Tone, string> = {
  neutral: 'border-line bg-surface text-fg-dim',
  leaf: 'border-transparent bg-leaf-wash text-leaf',
  star: 'border-transparent bg-star-wash text-star',
  danger: 'border-transparent bg-danger-wash text-danger',
};

export function Chip({ children, tone = 'neutral', icon, className }: { children: ReactNode; tone?: Tone; icon?: string; className?: string }) {
  return (
    <span className={cx('inline-flex h-[26px] max-w-full items-center gap-[5px] rounded-full border px-2.5 text-[12px] font-bold', TONES[tone], className)}>
      {icon && <Icon src={icon} size={13} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function FilterChip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'press flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[13.5px]',
        active ? 'border-leaf bg-leaf font-extrabold text-on-leaf' : 'border-line bg-surface font-bold text-fg-dim',
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cx('tabular text-[12px]', active ? 'text-on-leaf/70' : 'text-fg-faint')}>{count}</span>
      )}
    </button>
  );
}

// ───────────── Panneau montant (components/Sheet.tsx)

export function Sheet({ open, onClose, title, children, footer }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const drag = useDragControls();
  const far = typeof window === 'undefined' ? 900 : window.innerHeight;
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => panel.current?.focus(), 30);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      previous?.focus?.();
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center">
          <motion.button
            type="button"
            aria-label="Fermer"
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="relative flex max-h-[86dvh] w-full max-w-[520px] flex-col rounded-t-[32px] border border-b-0 border-line bg-sheet px-5 pt-2.5 outline-none"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
            initial={{ y: far }}
            animate={{ y: 0 }}
            exit={{ y: far, transition: { duration: 0.28, ease: [0.4, 0, 1, 1] } }}
            transition={{ type: 'spring', stiffness: 360, damping: 34, mass: 0.9 }}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 650) onClose();
            }}
          >
            {/* Poignée : on tire le panneau vers le bas pour le refermer. */}
            <div aria-hidden onPointerDown={(e) => drag.start(e)} className="-mt-2.5 flex h-7 shrink-0 cursor-grab touch-none justify-center pt-2.5 active:cursor-grabbing">
              <span className="h-1 w-10 rounded-full bg-line-strong" />
            </div>
            <div className="mb-3 flex shrink-0 items-center gap-3">
              <h2 id={titleId} className="min-w-0 flex-1 font-display text-[22px] font-semibold leading-7">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="press press-deep grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-strong"
              >
                <Icon src={close} size={20} />
              </button>
            </div>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1">{children}</div>
            {footer && <div className="shrink-0 pt-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function ConfirmSheet({ open, onClose, title, children, confirmLabel, onConfirm, busy, danger, cancelLabel = 'Annuler' }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  danger?: boolean;
  cancelLabel?: string;
}) {
  return (
    <Sheet
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      footer={
        <div className="flex flex-col gap-2.5">
          {danger ? (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              aria-busy={busy || undefined}
              className="press flex min-h-[56px] items-center justify-center gap-2 rounded-full bg-danger px-6 text-[16px] font-extrabold text-bg-deep disabled:opacity-60"
            >
              {busy && <span className="spinner" style={{ width: 16, height: 16 }} />}
              {confirmLabel}
            </button>
          ) : (
            <PrimaryButton label={confirmLabel} onClick={onConfirm} loading={busy} />
          )}
          <GhostButton label={cancelLabel} onClick={onClose} disabled={busy} />
        </div>
      }
    >
      <div className="text-[15px] leading-[23px] text-fg-dim">{children}</div>
    </Sheet>
  );
}

// ───────────── En-têtes et états (components/TabHeader.tsx, EmptyState.tsx)

export function PageHeader({ title, accent, subtitle, right }: { title: string; accent?: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex items-end gap-3 px-5 pb-[18px]" style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 14px) + 18px)' }}>
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[32px] font-semibold leading-[38px]">
          {title}
          {accent && <span className="font-light italic text-fg-dim"> {accent}</span>}
        </h1>
        {subtitle && <p className="mt-1.5 text-[14.5px] leading-5 text-fg-dim">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function SectionHead({ title, right, id }: { title: string; right?: ReactNode; id?: string }) {
  return (
    <div id={id} className="mt-7 flex scroll-mt-24 items-center justify-between gap-3 px-5">
      <h2 className="font-display text-[22px] font-semibold leading-7">{title}</h2>
      {right}
    </div>
  );
}

export function EmptyState({ title, body, cta, onPress, tint = '#7AAA2C' }: { title: string; body: ReactNode; cta?: string; onPress?: () => void; tint?: string }) {
  return (
    <div className="flex flex-col items-center px-8 pt-8 text-center">
      <div className="relative grid h-[150px] w-[150px] place-items-center">
        <span className="absolute -inset-10" style={{ backgroundImage: glow(tint, 0.5) }} />
        <img src="/decor/leaf.webp" alt="" width={97} height={124} className="relative h-[124px] w-auto" draggable={false} />
      </div>
      <h3 className="mt-4 font-display text-[24px] font-semibold leading-[30px]">{title}</h3>
      <p className="mt-2.5 max-w-[320px] text-[15px] leading-[22px] text-fg-dim">{body}</p>
      {cta && onPress && <PrimaryButton label={cta} onClick={onPress} className="mt-6 max-w-[340px]" />}
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-5 mt-4 rounded-[24px] border border-danger/30 bg-danger-wash p-5">
      <div className="flex items-start gap-3">
        <Icon src={alertCircleOutline} size={22} className="mt-0.5 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-5">Chargement impossible</p>
          <p className="mt-1 text-[14px] leading-[21px] text-fg-dim">{message}</p>
        </div>
      </div>
      {onRetry && <GhostButton label="Réessayer" icon={refreshOutline} onClick={onRetry} className="mt-4 w-full" />}
    </div>
  );
}

export function Notice({ tone = 'neutral', icon, title, children, action }: { tone?: Tone; icon?: string; title?: string; children: ReactNode; action?: ReactNode }) {
  const color = tone === 'star' ? 'text-star' : tone === 'danger' ? 'text-danger' : tone === 'leaf' ? 'text-leaf' : 'text-fg-dim';
  const frame =
    tone === 'star'
      ? 'border-star/25 bg-star-wash'
      : tone === 'danger'
        ? 'border-danger/30 bg-danger-wash'
        : tone === 'leaf'
          ? 'border-leaf/25 bg-leaf-wash'
          : 'border-line bg-surface';
  return (
    <div className={cx('rounded-[20px] border p-4', frame)}>
      <div className="flex items-start gap-3">
        {icon && <Icon src={icon} size={20} className={cx('mt-px', color)} />}
        <div className="min-w-0 flex-1">
          {title && <p className="text-[14.5px] font-bold leading-5">{title}</p>}
          <div className={cx('text-[13.5px] leading-5 text-fg-dim', title && 'mt-1')}>{children}</div>
        </div>
      </div>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 px-5 pt-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-[24px] border border-line p-3">
          <div className="skeleton h-[68px] w-[68px] rounded-full" />
          <div className="flex-1">
            <div className="skeleton h-4 w-2/5" />
            <div className="skeleton mt-2.5 h-3 w-3/5" />
            <div className="skeleton mt-2.5 h-3.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Barre d'action fixée en bas d'écran (enregistrer). Elle est rendue hors de la page : une page en
 * cours d'apparition est déplacée, ce qui décalerait un élément fixe placé à l'intérieur.
 */
export function Dock({ children, aboveTabs, flow }: { children: ReactNode; aboveTabs?: boolean; flow?: boolean }) {
  // `flow` : la barre n'est pas fixée, elle se trouve tout en bas de la page et ne suit pas le défilement.
  if (flow) {
    return (
      <div className="mx-auto max-w-[720px] px-5 pt-7" style={{ paddingBottom: 'calc(max(env(safe-area-inset-bottom), 14px) + 14px)' }} data-barre="enregistrer">
        {children}
      </div>
    );
  }
  return createPortal(
    <div className={cx('fixed inset-x-0 z-[35]', aboveTabs ? 'bottom-[84px] lg:bottom-0' : 'bottom-0')}>
      {!aboveTabs && <span className="pointer-events-none absolute inset-x-0 -top-16 bottom-0 bg-gradient-to-t from-bg via-bg/95 to-transparent" />}
      <div
        className="relative mx-auto max-w-[720px] px-5"
        style={{ paddingBottom: aboveTabs ? 'calc(env(safe-area-inset-bottom) + 6px)' : 'calc(max(env(safe-area-inset-bottom), 14px))' }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Apparition d'une page : ses blocs montent en cascade (voir `.page-in`), sans retarder la saisie. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('page-in', className)}>{children}</div>
  );
}
