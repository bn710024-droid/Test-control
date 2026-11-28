import { useState } from 'react';
import { airplaneOutline, boatOutline, cubeOutline } from '../../lib/glyphs';
import { Icon } from '../Icon';
import { Field, GhostButton, Switch } from '../ui';
import { CountryList } from '../CountryPrices';
import { cx } from '../../lib/ui';
import { PRO_GROUPS, PRO_MODE_LABEL, PRO_SIGN, proGroupOf, type ProCurrency, type ProGroupId, type ProMode } from '../../../shared/pro.js';

/** Saisie d'une offre pro : les nombres restent du texte tant qu'on tape (« 1,35 »). */
export type GroupForm = { offered: boolean; EXW: string; FOB: string };
export type ExceptionForm = { key: string; countries: string[]; offered: boolean; EXW: string; FOB: string };
export type OfferForm = { key: string; mode: ProMode; active: boolean; min: string; step: string; max: string; groups: Record<ProGroupId, GroupForm>; exceptions: ExceptionForm[] };

const ICON: Record<ProMode, string> = { avion: airplaneOutline, bateau: boatOutline, standard: cubeOutline };
const key = () => Math.random().toString(36).slice(2, 10);
const emptyGroups = (): Record<ProGroupId, GroupForm> => ({ eu: { offered: false, EXW: '', FOB: '' }, na: { offered: false, EXW: '', FOB: '' }, af: { offered: false, EXW: '', FOB: '' }, monde: { offered: false, EXW: '', FOB: '' } });

/** Nouvelle ligne de mode, avec minimum / palier / maximum repris des règles pros (Réglages). */
export function newOfferForm(mode: ProMode, rules?: { min?: number | null; step?: number | null; max?: number | null }): OfferForm {
  const t = (n?: number | null) => (n === null || n === undefined ? '' : String(n));
  return { key: key(), mode, active: true, min: t(rules?.min), step: t(rules?.step), max: t(rules?.max), groups: emptyGroups(), exceptions: [] };
}
export const newException = (): ExceptionForm => ({ key: key(), countries: [], offered: true, EXW: '', FOB: '' });

type Err = (path: string) => string | undefined;

function PriceCells({ currency, exw, fob, onExw, onFob, disabled, errExw, errFob, label }: { currency: ProCurrency; exw: string; fob: string; onExw: (v: string) => void; onFob: (v: string) => void; disabled?: boolean; errExw?: string; errFob?: string; label: string }) {
  // Devise fixe, écrite à droite de la case : jamais par-dessus le dernier chiffre.
  const sign = PRO_SIGN[currency];
  const pad = currency === 'XOF' ? 'pr-[70px]' : 'pr-[42px]';
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Field label={`EXW · ${label}`} compact inputMode={currency === 'XOF' ? 'numeric' : 'decimal'} suffix={sign} placeholder="Sur demande" value={exw} onValue={onExw} disabled={disabled} error={errExw} className={pad} />
      <Field label={`FOB · ${label}`} compact inputMode={currency === 'XOF' ? 'numeric' : 'decimal'} suffix={sign} placeholder="Sur demande" value={fob} onValue={onFob} disabled={disabled} error={errFob} className={pad} />
    </div>
  );
}

function OfferEditor({ offer, index, onChange, onRemove, err }: { offer: OfferForm; index: number; onChange: (o: OfferForm) => void; onRemove: () => void; err: Err }) {
  const [openExc, setOpenExc] = useState(offer.exceptions.length > 0);
  const unit = offer.mode === 'bateau' ? 'cont.' : 'kg';
  const base = `pro.offers.${index}`;
  const setGroup = (g: ProGroupId, patch: Partial<GroupForm>) => onChange({ ...offer, groups: { ...offer.groups, [g]: { ...offer.groups[g], ...patch } } });
  const setExc = (k: string, patch: Partial<ExceptionForm>) => onChange({ ...offer, exceptions: offer.exceptions.map((x) => (x.key === k ? { ...x, ...patch } : x)) });
  const taken = (except: string) => new Set(offer.exceptions.filter((x) => x.key !== except).flatMap((x) => x.countries));
  const offeredCount = PRO_GROUPS.filter((g) => offer.groups[g.id].offered).length;

  return (
    <div className={cx('rounded-[20px] border bg-black/15 p-4', offer.active ? 'border-line-strong' : 'border-line opacity-80')} id={`offre-${offer.mode}`}>
      <div className="flex items-center gap-3">
        {ICON[offer.mode] && (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-leaf-wash text-leaf">
            <Icon src={ICON[offer.mode]} size={19} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold leading-5">{PRO_MODE_LABEL[offer.mode]}</p>
          <p className="text-[12.5px] leading-[17px] text-fg-faint">{offeredCount === 0 ? 'Proposé nulle part : allumez au moins un groupe de pays.' : `Proposé dans ${offeredCount} groupe${offeredCount > 1 ? 's' : ''} de pays · prix au kg`}</p>
        </div>
        <Switch checked={offer.active} onChange={(v) => onChange({ ...offer, active: v })} label={`${PRO_MODE_LABEL[offer.mode]} proposé`} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        <Field label="Minimum" compact inputMode="decimal" suffix={unit} value={offer.min} onValue={(v) => onChange({ ...offer, min: v })} error={err(`${base}.min`)} />
        <Field label="Palier" compact inputMode="decimal" suffix={unit} value={offer.step} onValue={(v) => onChange({ ...offer, step: v })} error={err(`${base}.step`)} />
        <Field label="Maximum" compact inputMode="decimal" suffix={unit} value={offer.max} onValue={(v) => onChange({ ...offer, max: v })} error={err(`${base}.max`)} />
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {PRO_GROUPS.map((g) => {
          const row = offer.groups[g.id];
          return (
            <div key={g.id} className={cx('rounded-[16px] border px-3.5 pb-1 pt-3', row.offered ? 'border-leaf/40 bg-leaf-wash' : 'border-line')}>
              <div className="flex items-center gap-3">
                <p className="min-w-0 flex-1 text-[14px] font-bold leading-5">
                  {g.label} <span className="font-semibold text-fg-faint">· {PRO_SIGN[g.currency]}</span>
                </p>
                <Switch checked={row.offered} onChange={(v) => setGroup(g.id, { offered: v })} label={`${PRO_MODE_LABEL[offer.mode]} proposé en ${g.label}`} />
              </div>
              {row.offered ? (
                <PriceCells
                  currency={g.currency}
                  label={g.label}
                  exw={row.EXW}
                  fob={row.FOB}
                  onExw={(v) => setGroup(g.id, { EXW: v })}
                  onFob={(v) => setGroup(g.id, { FOB: v })}
                  errExw={err(`${base}.groups.${g.id}.EXW`)}
                  errFob={err(`${base}.groups.${g.id}.FOB`)}
                />
              ) : (
                <p className="pb-2.5 pt-1 text-[12.5px] leading-[17px] text-fg-faint">Non proposé dans ces pays.</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">Case vide : « Prix sur demande ». Chaque groupe a sa devise, celle de l’acheteur.</p>

      {/* Exceptions : des pays précis avec leur propre prix, dans la devise de leur groupe. */}
      {openExc || offer.exceptions.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2.5">
          {offer.exceptions.map((x, j) => {
            const cur = PRO_GROUPS.find((g) => g.id === proGroupOf(x.countries[0] ?? 'FR'))!.currency;
            return (
              <div key={x.key} className="rounded-[16px] border border-line p-3.5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-[13.5px] font-bold">Exception {j + 1}</p>
                  <button type="button" onClick={() => onChange({ ...offer, exceptions: offer.exceptions.filter((e) => e.key !== x.key) })} className="press min-h-11 px-2 text-[12.5px] font-bold text-danger">
                    Retirer
                  </button>
                </div>
                <CountryList noun="prix" label={`Pays de l’exception ${j + 1}`} countries={x.countries} taken={taken(x.key)} onChange={(countries) => setExc(x.key, { countries })} />
                {err(`${base}.exceptions.${j}.countries`) && <p className="mt-1.5 px-1 text-[13px] font-semibold text-danger" data-invalid="true">{err(`${base}.exceptions.${j}.countries`)}</p>}
                <div className="mt-2 flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-[13px] text-fg-dim">Proposé dans ces pays</p>
                  <Switch checked={x.offered} onChange={(v) => setExc(x.key, { offered: v })} label={`Exception ${j + 1} proposée`} />
                </div>
                {x.offered && x.countries.length > 0 && (
                  <PriceCells currency={cur} label="ces pays" exw={x.EXW} fob={x.FOB} onExw={(v) => setExc(x.key, { EXW: v })} onFob={(v) => setExc(x.key, { FOB: v })} errExw={err(`${base}.exceptions.${j}.EXW`)} errFob={err(`${base}.exceptions.${j}.FOB`)} />
                )}
              </div>
            );
          })}
          <GhostButton compact label="Ajouter une exception par pays" onClick={() => onChange({ ...offer, exceptions: [...offer.exceptions, newException()] })} />
        </div>
      ) : (
        <button type="button" onClick={() => { setOpenExc(true); onChange({ ...offer, exceptions: [newException()] }); }} className="press mt-2 min-h-11 px-1 text-[13px] font-bold text-leaf">
          + Exception pour des pays précis
        </button>
      )}
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={onRemove} className="press min-h-11 px-2 text-[12.5px] font-bold text-fg-dim">
          Retirer la ligne {PRO_MODE_LABEL[offer.mode].toLowerCase()}
        </button>
      </div>
    </div>
  );
}

/** Prix EXW / FOB : une ligne par mode (avion, bateau, standard) ; avion et bateau ont leurs propres prix. */
export function ProOffersEditor({ offers, onChange, err, rulesOf }: { offers: OfferForm[]; onChange: (o: OfferForm[]) => void; err: Err; rulesOf: (mode: ProMode) => { min?: number | null; step?: number | null; max?: number | null } }) {
  const free = (['avion', 'bateau', 'standard'] as ProMode[]).filter((m) => !offers.some((o) => o.mode === m));
  return (
    <>
      <div className="mt-3 flex flex-col gap-3">
        {offers.map((o, i) => (
          <OfferEditor key={o.key} offer={o} index={i} err={err} onChange={(next) => onChange(offers.map((x) => (x.key === o.key ? next : x)))} onRemove={() => onChange(offers.filter((x) => x.key !== o.key))} />
        ))}
      </div>
      {free.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-2.5">
          {free.map((m) => (
            <GhostButton key={m} compact tone="leaf" icon={ICON[m]} label={`Ajouter ${m === 'standard' ? 'une ligne standard' : m === 'avion' ? 'l’avion' : 'le bateau'}`} onClick={() => onChange([...offers, newOfferForm(m, rulesOf(m))])} />
          ))}
        </div>
      )}
    </>
  );
}
