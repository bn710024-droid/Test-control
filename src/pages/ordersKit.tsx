import type { ReactNode } from 'react';
import { GhostButton } from '../components/ui';
import { useOrders } from '../contexts/OrdersContext';
import { cx } from '../lib/ui';

/** Briques communes aux pages de l'espace commandes (Commandes, Paniers, Clients…). */

export const ACTIVITY: Record<string, string> = { grossiste: 'Grossiste', importateur: 'Importateur', autre: 'Autre professionnel' };

export const nameInitials = (name: string) => {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return parts.length === 0 ? '?' : (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

export function Kpi({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: 'leaf' | 'star' }) {
  return (
    <div className="card min-w-0 p-4">
      <span className="label-voice block truncate text-[12px] text-fg-faint">{label}</span>
      <span className={cx('poster-voice tabular mt-1.5 block truncate text-[30px] leading-[32px]', tone === 'leaf' && 'text-leaf', tone === 'star' && 'text-star')}>{value}</span>
      {detail && <span className="mt-1.5 block text-[12.5px] leading-[17px] text-fg-dim">{detail}</span>}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-[13px] text-fg-dim">{label}</dt>
      <dd className="min-w-0 break-words text-right text-[14px] font-semibold">{children}</dd>
    </div>
  );
}

export const contactLink = 'press inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-[13.5px] font-bold';

export function Refresh() {
  const { reload, refreshing } = useOrders();
  return <GhostButton compact label="Actualiser" loading={refreshing} onClick={reload} className="shrink-0" />;
}
