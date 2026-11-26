import { useMemo, useState } from 'react';
import { Segmented } from './ui';
import { normalize } from '../lib/format';
import { cx } from '../lib/ui';
import { COUNTRY_CODES, ZONE_EXCEPT_LIMIT, countryName, type ZoneMode } from '../../shared/catalog.js';

const MODE_TEXT: Record<ZoneMode, string> = {
  all: 'Tous les pays où l’application est installée voient ce produit.',
  sn: 'Seuls les clients situés au Sénégal voient ce produit. Ailleurs, il n’apparaît pas.',
  except: 'Tout le monde voit ce produit, sauf les clients situés dans les pays choisis ci-dessous.',
};

const ROWS: { value: ZoneMode; label: string }[] = [
  { value: 'all', label: 'Monde entier' },
  { value: 'sn', label: 'Sénégal uniquement' },
  { value: 'except', label: 'Monde entier, sauf certains pays' },
];

/**
 * Où un produit s'affiche : le monde entier, le Sénégal uniquement, ou le monde entier sauf
 * certains pays, que l'on choisit dans la liste.
 */
export function ZonePicker({ mode, except, onChange, error, disabled }: {
  mode: ZoneMode;
  except: string[];
  onChange: (next: { mode: ZoneMode; except: string[] }) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const all = useMemo(() => COUNTRY_CODES.map((code) => ({ code, name: countryName(code), key: normalize(countryName(code)) })).sort((a, b) => a.name.localeCompare(b.name, 'fr')), []);
  const needle = normalize(query);
  const found = needle ? all.filter((c) => !except.includes(c.code) && (c.key.includes(needle) || c.code.toLowerCase() === needle)).slice(0, 8) : [];
  const full = except.length >= ZONE_EXCEPT_LIMIT;

  return (
    <div>
      {/* Téléphone : trois lignes, libellés entiers (la rangée de trois les tronquait). */}
      <div role="radiogroup" aria-label="Pays où le produit s’affiche" className="flex flex-col gap-2 sm:hidden">
        {ROWS.map((row) => {
          const on = row.value === mode;
          return (
            <button
              key={row.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => !on && onChange({ mode: row.value, except })}
              className={cx(
                'press flex min-h-[52px] w-full items-center gap-3 rounded-2xl border px-4 text-left text-[14.5px] transition-colors duration-200',
                on ? 'border-leaf bg-leaf-wash font-extrabold text-fg' : 'border-line bg-surface font-semibold text-fg-dim',
              )}
            >
              <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', on ? 'border-leaf' : 'border-line-strong')}>
                {on && <span className="h-2.5 w-2.5 rounded-full bg-leaf" />}
              </span>
              {row.label}
            </button>
          );
        })}
      </div>
      <div className="hidden sm:block">
        <Segmented
          label="Pays où le produit s’affiche"
          full
          value={mode}
          onChange={(next) => !disabled && onChange({ mode: next, except })}
          options={[
            { value: 'all', label: 'Monde entier' },
            { value: 'sn', label: 'Sénégal' },
            { value: 'except', label: 'Monde sauf…' },
          ]}
        />
      </div>
      <p className="mt-2.5 px-1 text-[13px] leading-[19px] text-fg-dim" data-zone="explication">
        {MODE_TEXT[mode]}
      </p>

      {mode === 'except' && (
        <div className="mt-3 rounded-2xl bg-black/25 p-3.5">
          <p className="text-[13px] font-semibold text-fg-dim">Pays qui ne verront pas ce produit</p>
          {except.length === 0 ? (
            <p className="mt-1.5 text-[13px] leading-[18px] text-fg-faint">Aucun pays choisi pour l’instant.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Pays exclus">
              {except.map((code) => (
                <li key={code}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange({ mode, except: except.filter((c) => c !== code) })}
                    aria-label={`Retirer ${countryName(code)} des pays exclus`}
                    className="press flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-white/[0.06] pl-4 pr-3 text-[13.5px] font-bold"
                  >
                    {countryName(code)}
                    <span aria-hidden className="text-[17px] leading-none text-fg-dim">×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="mt-3 flex h-12 items-center rounded-full border border-line bg-surface px-4 transition-colors focus-within:border-leaf">
            <span className="sr-only">Ajouter un pays à exclure</span>
            <input
              type="search"
              value={query}
              disabled={disabled || full}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={full ? 'Liste complète' : 'Ajouter un pays : France, Belgique…'}
              autoComplete="off"
              enterKeyHint="search"
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
            />
          </label>
          {needle && (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Pays trouvés">
              {found.length === 0 ? (
                <li className="px-1 text-[13px] text-fg-faint">Aucun pays ne correspond.</li>
              ) : (
                found.map((c) => (
                  <li key={c.code}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({ mode, except: [...except, c.code] });
                        setQuery('');
                      }}
                      className="press flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-leaf/60 px-4 text-[13.5px] font-bold text-leaf"
                    >
                      <span aria-hidden>+</span> {c.name}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
