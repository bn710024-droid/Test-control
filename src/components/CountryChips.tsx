import { useMemo, useState } from 'react';
import { normalize } from '../lib/format';
import { COUNTRY_CODES, countryName } from '../../shared/catalog.js';

/**
 * Liste de pays à pastilles, avec recherche pour en ajouter (même présentation que la liste des
 * pays exclus d'un produit). `exclude` : pays qu'on ne peut pas choisir ici.
 */
export function CountryChips({ value, onChange, label, placeholder, exclude = [], disabled, limit = 80 }: {
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
  placeholder: string;
  exclude?: string[];
  disabled?: boolean;
  limit?: number;
}) {
  const [query, setQuery] = useState('');
  const all = useMemo(
    () => COUNTRY_CODES.map((code) => ({ code, name: countryName(code), key: normalize(countryName(code)) })).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [],
  );
  const needle = normalize(query);
  const found = needle
    ? all.filter((c) => !value.includes(c.code) && !exclude.includes(c.code) && (c.key.includes(needle) || c.code.toLowerCase() === needle)).slice(0, 8)
    : [];
  const full = value.length >= limit;

  return (
    <div>
      {value.length === 0 ? (
        <p className="text-[13px] leading-[18px] text-fg-faint">Aucun pays choisi pour l’instant.</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label={label}>
          {value.map((code) => (
            <li key={code}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((c) => c !== code))}
                aria-label={`Retirer ${countryName(code)}`}
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
        <span className="sr-only">{placeholder}</span>
        <input
          type="search"
          value={query}
          disabled={disabled || full}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={full ? 'Liste complète' : placeholder}
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
                    onChange([...value, c.code]);
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
  );
}
