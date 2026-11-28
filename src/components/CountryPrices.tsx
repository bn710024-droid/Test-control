import { useMemo, useState, type ReactNode } from 'react';
import { Chip, GhostButton } from './ui';
import { useToast } from '../contexts/ToastContext';
import { normalize } from '../lib/format';
import { cx } from '../lib/ui';
import { COUNTRY_CODES, COUNTRY_PRICE_LIMIT, countryName, globalScope, zoneAllows, type Zone } from '../../shared/catalog.js';

// ───────────── Prix par pays
// Le prix saisi au-dessus est le prix global : il vaut pour tous les pays, sauf ceux à qui l'on
// donne ici leur propre prix. Le même bloc sert aux particuliers et à chaque offre professionnelle.

type Group = { key: string; countries: string[] };

/** Deux options côte à côte, dont le libellé passe à la ligne plutôt que d'être coupé. */
export function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-2">
      {options.map(([v, text]) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(v)}
            className={cx('press min-h-11 rounded-[22px] border px-3 py-2 text-center text-[13.5px] leading-[18px] transition-colors duration-200', on ? 'border-leaf bg-leaf font-extrabold text-on-leaf' : 'border-line bg-surface font-bold text-fg-dim')}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Une règle, en une ligne : ce qu'elle concerne, ce qu'elle dit, et deux gestes — « Modifier »
 * et retirer. Le détail ne s'ouvre que sur demande : l'écran reste calme, quel que soit le nombre
 * de règles. Sur un écran étroit, les gestes passent sous le texte plutôt que de le couper.
 */
export function RuleRow({ title, summary, chips, extra, onEdit, editLabel, editText = 'Modifier', onRemove, removeLabel, muted, id, thumb, lead }: {
  /** Mot du bouton : « Modifier » par défaut, « Traiter » pour une demande. */
  editText?: string;
  title: ReactNode;
  summary?: ReactNode;
  chips?: ReactNode;
  /** Un geste de plus, avant « Modifier » : un interrupteur, par exemple. */
  extra?: ReactNode;
  onEdit: () => void;
  editLabel: string;
  onRemove?: () => void;
  removeLabel?: string;
  /** Titre en attente (rien n'est encore choisi). */
  muted?: boolean;
  id?: string;
  /** Vignette : adresse d'une photo, ou `null` pour l'emplacement vide. Absente : pas de vignette. */
  thumb?: string | null;
  /** À la place de la vignette : une pastille (initiales d'un client, par exemple). */
  lead?: ReactNode;
}) {
  return (
    <div id={id} className="flex flex-wrap items-center gap-x-2 rounded-2xl border border-line bg-white/[0.03] py-1 pl-3.5 pr-1" data-regle="ligne">
      <div className="flex min-w-[128px] flex-1 items-center gap-3 py-1.5">
        {lead}
        {lead === undefined && thumb !== undefined && (
          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-black/30" data-regle="vignette">
            {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span aria-hidden className="text-[18px] leading-none text-fg-faint">+</span>}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className={cx('break-words text-[14.5px] font-bold leading-5', muted && 'text-star')}>{title}</p>
          {summary && <p className="break-words text-[12.5px] leading-[18px] text-fg-dim">{summary}</p>}
          {chips && <div className="mt-1 flex flex-wrap gap-1.5">{chips}</div>}
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center">
        {extra}
        <button type="button" onClick={onEdit} aria-label={editLabel} aria-expanded={false} className="press flex min-h-11 items-center rounded-full px-3 text-[13.5px] font-bold text-leaf">
          {editText}
        </button>
        {onRemove && (
          <button type="button" onClick={onRemove} aria-label={removeLabel} className="press grid h-11 w-11 place-items-center rounded-full text-[20px] leading-none text-fg-dim">
            ×
          </button>
        )}
      </div>
    </div>
  );
}

const ALL = COUNTRY_CODES.map((code) => ({ code, name: countryName(code), key: normalize(countryName(code)) })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

/** Les pays d'un groupe : ceux déjà choisis, et une recherche pour en ajouter. */
export function CountryList({ countries, taken, onChange, label, disabled, noun }: {
  /** « prix » ou « réglage » : ce que l'on attribue à ces pays. */
  noun: string;
  countries: string[];
  /** Pays qui ont déjà leur prix dans un autre groupe : ils ne sont pas proposés. */
  taken: Set<string>;
  onChange: (next: string[]) => void;
  label: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const needle = normalize(query.trim());
  const found = useMemo(() => (needle ? ALL.filter((c) => !countries.includes(c.code) && !taken.has(c.code) && c.key.includes(needle)).slice(0, 8) : []), [needle, countries, taken]);
  // Le Sénégal est le cas le plus courant : proposé d'un toucher tant qu'aucun pays n'est choisi.
  const quick = countries.length === 0 && !needle && !taken.has('SN');
  const dashed = 'press flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-leaf/60 px-4 text-[13.5px] font-bold text-leaf';
  return (
    <div>
      {countries.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={label}>
          {countries.map((code) => (
            <li key={code}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(countries.filter((c) => c !== code))}
                aria-label={`Retirer ${countryName(code)} de ce ${noun}`}
                className="press flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-white/[0.06] pl-4 pr-3 text-[13.5px] font-bold"
              >
                {countryName(code)}
                <span aria-hidden className="text-[17px] leading-none text-fg-dim">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className={cx('flex h-12 items-center rounded-full border border-line bg-surface px-4 transition-colors focus-within:border-leaf', countries.length > 0 && 'mt-2.5')}>
        <span className="sr-only">{countries.length === 0 ? `Pays concerné par ce ${noun}` : `Ajouter un pays au même ${noun}`}</span>
        <input
          type="search"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={countries.length === 0 ? 'Quel pays ?' : 'Autre pays'}
          autoComplete="off"
          enterKeyHint="search"
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      {(needle || quick) && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Pays proposés">
          {quick ? (
            <li>
              <button type="button" onClick={() => onChange(['SN'])} className={dashed}>
                <span aria-hidden>+</span> Sénégal
              </button>
            </li>
          ) : found.length === 0 ? (
            <li className="px-1 text-[13px] leading-[18px] text-fg-faint">Aucun pays libre ne correspond : un pays ne peut avoir qu’un seul {noun}.</li>
          ) : (
            found.map((c) => (
              <li key={c.code}>
                <button
                  type="button"
                  onClick={() => {
                    onChange([...countries, c.code]);
                    setQuery('');
                  }}
                  className={dashed}
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

export function CountryPrices<G extends Group>({ groups, onChange, make, base, error, zone, who = '', globalText = '', fields, noun = 'prix', title = 'Prix par pays', groupLabel = 'Prix pour', addLabel = ['Donner un prix à un pays', 'Ajouter un autre prix par pays'], lead, summary }: {
  /** « prix » (par défaut) ou « réglage » : ce que l'on attribue à un groupe de pays. */
  noun?: string;
  title?: string;
  groupLabel?: string;
  /** Libellé du bouton : sans groupe, puis avec. */
  addLabel?: [string, string];
  /** Phrase d'introduction, à la place de celle des prix. */
  lead?: ReactNode;
  groups: G[];
  onChange: (next: G[]) => void;
  /** Un groupe vide, prêt à recevoir ses pays et son prix. */
  make: () => G;
  /** Chemin des erreurs : « retail.countryPrices », « wholesale.0.countryPrices ». */
  base: string;
  error: (path: string) => string | undefined;
  /** Pays où le produit s'affiche. Ce n'est pas la même chose : on peut régler un pays où il ne l'est pas encore. */
  zone: Zone;
  /** « les particuliers », « les grossistes et importateurs ». */
  who?: string;
  /** Le prix global, en clair : « 3,20 € le kg », ou « non fixé ». */
  globalText?: string;
  /** Les champs de prix d'un groupe. */
  fields: (group: G, index: number, patch: (p: Partial<G>) => void) => ReactNode;
  /** Le réglage d'un groupe en quelques mots, pour sa ligne repliée : « 2,50 € le kg ». */
  summary: (group: G, index: number) => string;
}) {
  const toast = useToast();
  // Un seul réglage ouvert à la fois ; les autres tiennent en une ligne.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const patch = (key: string, p: Partial<G>) => onChange(groups.map((g) => (g.key === key ? { ...g, ...p } : g)));
  const scope = globalScope(groups);
  // Une erreur ne reste jamais cachée dans une ligne repliée.
  const invalid = (j: number) => ['countries', 'price', 'prices.EXW', 'prices.FOB', 'photo_url'].some((f) => !!error(`${base}.${j}.${f}`));
  const remove = (g: G) => {
    const before = groups;
    onChange(groups.filter((x) => x.key !== g.key));
    if (g.countries.length > 0) toast(`${noun === 'prix' ? 'Prix retiré' : 'Réglage retiré'} : ${g.countries.map(countryName).join(', ')}`, { action: { label: 'Annuler', onPress: () => onChange(before) } });
  };
  return (
    <div className="mt-4 rounded-[20px] border border-line bg-black/20 p-2.5 min-[380px]:p-3.5" data-prix-pays={base}>
      <p className="px-1 text-[14.5px] font-bold leading-5">{title}</p>
      <p className="mt-1 px-1 text-[13px] leading-[19px] text-fg-dim" data-prix-pays="portee">
        {lead ?? (
          <>
            Prix global ({globalText}) : pour {who}, dans <span className="font-bold text-fg">{scope}</span>.
          </>
        )}
      </p>
      {groups.map((g, j) => {
        const taken = new Set(groups.filter((x) => x.key !== g.key).flatMap((x) => x.countries));
        const unseen = g.countries.filter((c) => !zoneAllows(zone, c));
        const countriesError = error(`${base}.${j}.countries`);
        const names = g.countries.map(countryName).join(', ');
        if (openKey !== g.key && !invalid(j)) {
          return (
            <div key={g.key} className="mt-2" data-prix-pays="groupe">
              <RuleRow
                title={names || 'Pays à choisir'}
                muted={!names}
                summary={summary(g, j)}
                chips={unseen.length > 0 ? <Chip>{unseen.length === g.countries.length ? 'Produit non affiché ici' : `Produit non affiché : ${unseen.map(countryName).join(', ')}`}</Chip> : undefined}
                onEdit={() => setOpenKey(g.key)}
                editLabel={`Modifier le ${noun} de ${names || 'ce groupe de pays'}`}
                onRemove={() => remove(g)}
                removeLabel={`Retirer le ${noun} de ${names || 'ce groupe de pays'}`}
              />
            </div>
          );
        }
        return (
          <div key={g.key} className="mt-2 rounded-2xl border border-leaf/40 bg-white/[0.03] p-2.5 min-[380px]:p-3" data-prix-pays="groupe" data-ouvert="true">
            {/* Sur un écran étroit, les deux boutons passent sous le libellé plutôt que de le recouvrir. */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="shrink-0 whitespace-nowrap text-[12.5px] font-extrabold uppercase tracking-[0.08em] text-fg-faint">{groupLabel}</p>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <GhostButton compact tone="danger" label="Retirer" aria-label={`Retirer le ${noun} de ${names || 'ce groupe de pays'}`} onClick={() => remove(g)} />
                <GhostButton compact label="Terminé" aria-label={`Replier le ${noun} de ${names || 'ce groupe de pays'}`} onClick={() => setOpenKey(null)} />
              </span>
            </div>
            <CountryList noun={noun} countries={g.countries} taken={taken} label={`Pays du ${noun} ${j + 1}`} onChange={(countries) => patch(g.key, { countries } as Partial<G>)} />
            {countriesError && (
              <p role="alert" data-invalid="true" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
                {countriesError}
              </p>
            )}
            {/* Afficher le produit dans un pays et régler ce pays sont deux choses distinctes : le réglage est gardé. */}
            {unseen.length > 0 && (
              <p role="status" className="mt-2 rounded-2xl border border-line bg-black/25 px-3.5 py-2.5 text-[13px] leading-[19px] text-fg-dim" data-prix-pays="non-affiche">
                <span className="font-bold text-fg">{unseen.map(countryName).join(', ')}</span> : le produit n’y est pas affiché pour l’instant (rubrique « Pays »), les clients de {unseen.length > 1 ? 'ces pays' : 'ce pays'} ne le voient donc pas. Ce {noun} est gardé : il s’appliquera dès que vous l’y afficherez.
              </p>
            )}
            {fields(g, j, (p) => patch(g.key, p))}
          </div>
        );
      })}
      {/* Le libellé passe à la ligne plutôt que d'être coupé, quand le bloc est étroit. */}
      <button
        type="button"
        disabled={groups.length >= COUNTRY_PRICE_LIMIT}
        onClick={() => {
          const g = make();
          onChange([...groups, g]);
          setOpenKey(g.key);
        }}
        className="press mt-3 flex min-h-11 w-full items-center justify-center rounded-full border border-leaf/50 px-4 py-2 text-center text-[14.5px] font-bold leading-5 text-leaf disabled:opacity-40"
      >
        {groups.length === 0 ? addLabel[0] : addLabel[1]}
      </button>
      <GroupNote message={error(base)} />
    </div>
  );
}

function GroupNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" data-invalid="true" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
      {message}
    </p>
  );
}
