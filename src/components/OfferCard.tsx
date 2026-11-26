import { useState } from 'react';
import { trashOutline } from '../lib/glyphs';
import { Icon } from './Icon';
import { Field, Segmented, Switch } from './ui';
import { euro, kgText, plural } from '../lib/format';
import { newOfferGroup, offerPreview, type OfferForm } from '../lib/productForm';
import { CountryPrices } from './CountryPrices';
import { cx } from '../lib/ui';
import { INCOTERMS, lineTotal, resolveOffer, type QuantityRules, type Zone } from '../../shared/catalog.js';

const TITLE = { avion: 'Par avion', bateau: 'Par bateau', standard: 'Standard, sans mode' };

const qty = (n: number, sea: boolean) => (sea ? plural(n, 'conteneur', 'conteneurs') : kgText(n));

/**
 * Une offre professionnelle : mode, prix EXW / FOB, unité du prix, règles de quantité, poids du
 * conteneur. Le résumé du bas est calculé avec `resolveOffer`, la fonction même de l'application :
 * ce que vous lisez ici est ce que le client professionnel verra.
 */
export function OfferCard({ offer, index, rules, zone, error, touch, onChange, onRemove, invalid, startOpen }: {
  /** Offre ajoutée à l'instant : elle s'ouvre d'elle-même. */
  startOpen?: boolean;
  /** Une erreur est affichée dans cette offre : elle ne reste alors jamais repliée. */
  invalid?: boolean;
  offer: OfferForm;
  index: number;
  /** Pays où le produit s'affiche. */
  zone: Zone;
  rules: QuantityRules;
  error: (path: string) => string | undefined;
  touch: (path: string) => void;
  onChange: (patch: Partial<OfferForm>) => void;
  onRemove: () => void;
}) {
  const kind = offer.mode ?? 'standard';
  const sea = offer.mode === 'bateau';
  const base = `wholesale.${index}`;
  const perContainer = sea && offer.priceUnit === 'conteneur';
  const suffix = perContainer ? '€ / cont.' : '€ / kg';
  const unitSuffix = sea ? 'cont.' : 'kg';
  const preview = offerPreview(offer);

  const r = sea ? null : offer.mode === 'avion' ? rules.avion : rules.standard;
  const catalogRule = sea
    ? `Minimum ${qty(rules.bateau.minContainers, true)}, par ${qty(rules.bateau.stepContainers, true)}, jusqu’à ${rules.bateau.maxContainers}.`
    : offer.mode === 'avion'
      ? `Minimum ${kgText(r!.minKg)}, puis par paliers de ${kgText(r!.stepKg)}, jusqu’à ${kgText(r!.maxKg)}.`
      : `Minimum ${kgText(r!.minKg)}, jusqu’à ${kgText(r!.maxKg)} (boutons par ${kgText(r!.stepKg)}).`;

  const refKg = rules.bateau.containerKg;
  const refLabel = refKg
    ? `${kgText(refKg)}${rules.bateau.containerLabel ? ` · ${rules.bateau.containerLabel}` : ''}`
    : 'non définie';

  // Repliée, une offre tient en une ligne. Seule une offre ajoutée à l'instant s'ouvre d'elle-même.
  const [opened, setOpened] = useState(() => !!startOpen);
  const open = opened || !!invalid;
  const apart = new Set(offer.countryPrices.flatMap((g) => g.countries)).size;
  const summary =
    (offer.exw.trim() || offer.fob.trim() ? `EXW ${offer.exw.trim() || 'à confirmer'} · FOB ${offer.fob.trim() || 'à confirmer'} ${suffix}` : 'Prix à confirmer') +
    (apart > 0 ? ` · ${plural(apart, 'pays à part', 'pays à part')}` : '') +
    (offer.available ? '' : ' · fermée');

  return (
    <div className={cx('rounded-[20px] border bg-white/[0.03]', open ? 'border-leaf/40 p-4' : 'border-line py-1.5 pl-4 pr-1.5')} data-offre={kind} data-ouvert={open ? 'true' : undefined}>
      <div className="flex flex-wrap items-center gap-x-2">
        <div className="min-w-[128px] flex-1 py-1">
          <h3 className="text-[15px] font-bold leading-5">{TITLE[kind]}</h3>
          <p className="break-words text-[12.5px] leading-[18px] text-fg-dim" data-offre="resume">
            {open ? (offer.available ? 'Ouverte aux commandes' : 'Fermée pour le moment') : summary}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Switch checked={offer.available} onChange={(v) => onChange({ available: v })} label={`Offre ${TITLE[kind].toLowerCase()} ouverte aux commandes`} />
          <button
            type="button"
            onClick={() => setOpened(!open)}
            aria-expanded={open}
            aria-label={`${open ? 'Replier' : 'Modifier'} l’offre ${TITLE[kind].toLowerCase()}`}
            className={cx('press flex min-h-11 items-center rounded-full px-3 text-[13.5px] font-bold', open ? 'text-fg-dim' : 'text-leaf')}
          >
            {open ? 'Terminé' : 'Modifier'}
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Supprimer l’offre ${TITLE[kind].toLowerCase()}`}
            className="press press-deep grid h-11 w-11 shrink-0 place-items-center rounded-full text-danger"
          >
            <Icon src={trashOutline} size={19} />
          </button>
        </div>
      </div>
      {open && (
        <>
      {error(`${base}.mode`) && (
        <p role="alert" data-invalid="true" className="mt-2 text-[13.5px] font-semibold leading-[19px] text-danger">
          {error(`${base}.mode`)}
        </p>
      )}

      {sea && (
        <div className="mt-4">
          <p className="mb-[7px] text-[13px] font-semibold text-fg-dim">Le prix s’exprime</p>
          <Segmented
            label="Unité du prix"
            full
            value={offer.priceUnit}
            onChange={(v) => onChange({ priceUnit: v })}
            options={[
              { value: 'kg', label: 'Au kilo' },
              { value: 'conteneur', label: 'Au conteneur' },
            ]}
          />
        </div>
      )}

      {/* Une colonne sur téléphone : côte à côte, le chiffre passait sous « € / kg ». */}
      <div className="grid grid-cols-1 gap-x-3 min-[480px]:grid-cols-2">
        <Field
          label="Prix EXW global"
          inputMode="decimal"
          placeholder="À confirmer"
          suffix={suffix}
          value={offer.exw}
          onValue={(v) => onChange({ exw: v })}
          onBlur={() => touch(`${base}.prices.EXW`)}
          error={error(`${base}.prices.EXW`)}
          hint="Départ entrepôt"
          className="pr-[74px]"
        />
        <Field
          label="Prix FOB global"
          inputMode="decimal"
          placeholder="À confirmer"
          suffix={suffix}
          value={offer.fob}
          onValue={(v) => onChange({ fob: v })}
          onBlur={() => touch(`${base}.prices.FOB`)}
          error={error(`${base}.prices.FOB`)}
          hint="Chargée au port"
          className="pr-[74px]"
        />
      </div>

      <CountryPrices
        groups={offer.countryPrices}
        onChange={(countryPrices) => onChange({ countryPrices })}
        make={newOfferGroup}
        base={`${base}.countryPrices`}
        summary={(g) => `EXW ${g.exw.trim() || 'global'} · FOB ${g.fob.trim() || 'global'} ${suffix}`}
        error={error}
        zone={zone}
        who="les grossistes et importateurs"
        globalText={offer.exw.trim() || offer.fob.trim() ? `EXW ${offer.exw.trim() || 'à confirmer'} · FOB ${offer.fob.trim() || 'à confirmer'}, en ${suffix}` : 'à confirmer'}
        fields={(g, j, patch) => (
          <>
            {/* Une colonne tant que l'écran est étroit : chaque champ garde la place de son chiffre. */}
            <div className="grid grid-cols-1 gap-x-3 min-[520px]:grid-cols-2">
              <Field
                label="Prix EXW dans ces pays"
                inputMode="decimal"
                placeholder={offer.exw.trim() || 'Vide'}
                suffix={suffix}
                value={g.exw}
                onValue={(v) => patch({ exw: v })}
                onBlur={() => touch(`${base}.countryPrices.${j}.prices.EXW`)}
                error={error(`${base}.countryPrices.${j}.prices.EXW`)}
                className="pr-[74px]"
              />
              <Field
                label="Prix FOB dans ces pays"
                inputMode="decimal"
                placeholder={offer.fob.trim() || 'Vide'}
                suffix={suffix}
                value={g.fob}
                onValue={(v) => patch({ fob: v })}
                onBlur={() => touch(`${base}.countryPrices.${j}.prices.FOB`)}
                error={error(`${base}.countryPrices.${j}.prices.FOB`)}
                className="pr-[74px]"
              />
            </div>
            <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">Un champ laissé vide garde le prix global de l’offre pour ces pays.</p>
          </>
        )}
      />

      <div className="mt-4 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold leading-5">Quantités propres à cette offre</p>
          <p className="text-[12.5px] leading-[18px] text-fg-faint">
            {offer.custom ? 'Laissez un champ vide pour garder la règle du catalogue.' : `Règle du catalogue : ${catalogRule}`}
          </p>
        </div>
        <Switch checked={offer.custom} onChange={(v) => onChange({ custom: v })} label="Quantités propres à cette offre" />
      </div>
      {offer.custom && (
        <div className="grid grid-cols-3 gap-2.5">
          {(
            [
              ['minQty', 'Minimum'],
              ['stepQty', 'Palier'],
              ['maxQty', 'Maximum'],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              inputMode="numeric"
              compact
              suffix={unitSuffix}
              value={offer[key]}
              onValue={(v) => onChange({ [key]: v })}
              onBlur={() => touch(`${base}.${key}`)}
              error={error(`${base}.${key}`)}
              className="pr-[46px]"
            />
          ))}
        </div>
      )}

      {sea && (
        <div className="mt-4">
          <p className="mb-[7px] text-[13px] font-semibold text-fg-dim">Poids d’un conteneur</p>
          <Segmented
            label="Poids d’un conteneur"
            full
            value={offer.container}
            onChange={(v) => onChange({ container: v })}
            options={[
              { value: 'ref', label: 'Référence' },
              { value: 'custom', label: 'Propre' },
              { value: 'none', label: 'Non défini' },
            ]}
          />
          {offer.container === 'ref' && (
            <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">Référence du catalogue : {refLabel}. Elle se règle dans Réglages.</p>
          )}
          {offer.container === 'custom' && (
            <Field
              label="Kilos par conteneur pour cette offre"
              inputMode="numeric"
              suffix="kg"
              placeholder="22 000"
              value={offer.containerKg}
              onValue={(v) => onChange({ containerKg: v })}
              onBlur={() => touch(`${base}.containerKg`)}
              error={error(`${base}.containerKg`)}
            />
          )}
          {offer.container === 'none' && (
            <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">
              Seul le nombre de conteneurs sera affiché. Avec un prix au kilo, aucun total ne pourra être calculé.
            </p>
          )}
        </div>
      )}

      {/* Ce que l'application calculera — rien d'autre. */}
      <dl className="mt-4 rounded-2xl bg-black/25 px-3.5 py-2.5" aria-label="Ce que le client professionnel verra">
        {INCOTERMS.map((term) => {
          const line = resolveOffer(preview, rules, term);
          const total = lineTotal(line, line.min);
          return (
            <div key={term} className="flex items-baseline justify-between gap-3 py-1.5">
              <dt className="text-[13.5px] font-bold tracking-[0.02em] text-fg-dim">{term}</dt>
              <dd className={cx('text-right text-[13px] leading-[18px]', line.noPrice ? 'font-semibold text-star' : 'text-fg')}>
                {line.noPrice ? (
                  line.missing === 'poids' ? (
                    'Poids du conteneur non défini : aucun total calculé'
                  ) : (
                    'Prix à confirmer : aucun total calculé'
                  )
                ) : (
                  <>
                    <span className="tabular font-extrabold">{euro(line.price)}</span>{' '}
                    <span className="text-fg-faint">{sea ? 'le conteneur' : 'le kg'}</span>
                    <span className="block text-[12px] text-fg-faint">
                      minimum {qty(line.min, sea)}
                      {sea && line.containerKg ? ` (${kgText(line.min * line.containerKg)})` : ''} ={' '}
                      <span className="tabular font-bold text-fg-dim">{total === null ? '—' : euro(total)}</span>
                    </span>
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
        </>
      )}
    </div>
  );
}
