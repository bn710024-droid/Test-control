import { useEffect, useMemo, useState } from 'react';
import { Link, useBlocker, useSearchParams } from 'react-router-dom';
import { closeCircle, search, shieldCheckmarkOutline } from '../lib/glyphs';
import { useData, type BulkUpdate, type Product } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { Icon } from '../components/Icon';
import { ProductArt } from '../components/catalog';
import {
  Chip,
  Dock,
  EmptyState,
  ErrorPanel,
  GhostButton,
  Page,
  PageHeader,
  PrimaryButton,
  Segmented,
  Sheet,
  SkeletonRows,
  Switch,
} from '../components/ui';
import { messageOf } from '../lib/api';
import { euro, kgText, normalize, numStr, parseNum, plural, seasonText } from '../lib/format';
import { cx } from '../lib/ui';
import { DEFAULT_RULES, modeLabel, resolveOffer, validateProduct, type ProductInput } from '../../shared/catalog.js';
import { sp, useSpace } from '../lib/space';
import { PRO_GROUPS, PRO_GROUP_IDS, PRO_MODE_LABEL, PRO_SIGN, validatePro, type ProGroupId } from '../../shared/pro.js';

type View = 'particuliers' | 'pro' | 'dispo';
type OfferEdit = { exw?: string; fob?: string; available?: boolean };
type Edit = { price?: string; available?: boolean; offers?: Record<number, OfferEdit>; pro?: Record<string, { exw?: string; fob?: string }> };
/** Clé d'une case pro : `<n° de l'offre>:<groupe>`. */
const proKey = (i: number, g: ProGroupId) => `${i}:${g}`;

/** Traduit une saisie en changements réels. `null` : rien n'a changé par rapport à la base. */
/** Nombre de pays qui ont leur propre prix, pour les particuliers ou pour les professionnels. */
function countriesApart(p: Product, view: string) {
  const groups = view === 'pro' ? p.wholesale.flatMap((o) => o.countryPrices ?? []) : (p.retail?.countryPrices ?? []);
  return new Set(groups.flatMap((g) => g.countries)).size;
}

function changesOf(p: Product, e: Edit | undefined): Partial<ProductInput> | null {
  if (!e) return null;
  const changes: Partial<ProductInput> = {};
  if (e.available !== undefined && e.available !== p.available) changes.available = e.available;
  if (e.price !== undefined && p.retail) {
    const v = parseNum(e.price);
    if (v !== p.retail.price) changes.retail = { ...p.retail, price: v };
  }
  if (e.offers) {
    let changed = false;
    const next = p.wholesale.map((o, i) => {
      const oe = e.offers?.[i];
      if (!oe) return o;
      const copy = { ...o, prices: { ...o.prices } };
      if (oe.exw !== undefined) {
        const v = parseNum(oe.exw);
        if (v !== o.prices.EXW) {
          copy.prices.EXW = v;
          changed = true;
        }
      }
      if (oe.fob !== undefined) {
        const v = parseNum(oe.fob);
        if (v !== o.prices.FOB) {
          copy.prices.FOB = v;
          changed = true;
        }
      }
      if (oe.available !== undefined && oe.available !== o.available) {
        copy.available = oe.available;
        changed = true;
      }
      return copy;
    });
    if (changed) changes.wholesale = next;
  }
  // Espace Pros : prix EXW / FOB par mode et par groupe de pays (fiche pro).
  if (e.pro && p.pro) {
    let changed = false;
    const offers = p.pro.offers.map((o, i) => ({
      ...o,
      groups: Object.fromEntries(
        PRO_GROUP_IDS.map((g) => {
          const ce = e.pro?.[proKey(i, g)];
          const row = { ...o.groups[g] };
          if (ce?.exw !== undefined && parseNum(ce.exw) !== row.EXW) {
            row.EXW = parseNum(ce.exw);
            changed = true;
          }
          if (ce?.fob !== undefined && parseNum(ce.fob) !== row.FOB) {
            row.FOB = parseNum(ce.fob);
            changed = true;
          }
          return [g, row];
        }),
      ) as typeof o.groups,
    }));
    if (changed) (changes as Record<string, unknown>).pro = { ...p.pro, offers };
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

function PriceInput({ value, onChange, label, suffix, invalid, disabled, changed, wide }: {
  wide?: boolean;
  value: string;
  onChange: (v: string) => void;
  label: string;
  suffix: string;
  invalid?: boolean;
  disabled?: boolean;
  changed?: boolean;
}) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <input
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        placeholder="—"
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.target.select()}
        style={{ paddingRight: suffix.length > 2 ? (wide ? 92 : 64) : 42 }}
        className={cx('field field-compact tabular w-full text-right', changed && !invalid && 'border-leaf')}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-fg-faint">{suffix}</span>
    </label>
  );
}

export default function Prices() {
  const { products, categories, settings, loading, error, reload, bulkUpdate } = useData();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  // Chaque espace ses prix : Particuliers (prix au kilo ou à la pièce), Pros (EXW / FOB par groupe).
  const { space } = useSpace();
  const view = (params.get('vue') === 'dispo' ? 'dispo' : space === 'b2b' ? 'pro' : 'particuliers') as View;
  const [query, setQuery] = useState('');
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const rules = settings?.rules ?? DEFAULT_RULES;

  const active = useMemo(() => products.filter((p) => !p.archived), [products]);

  const pending = useMemo(() => {
    const categoryIds = categories.map((c) => c.id);
    return active
      .map((p) => {
        const changes = changesOf(p, edits[p.id]);
        if (!changes) return null;
        const { errors } = validateProduct({ ...p, ...changes, ...(p.space === 'b2b' ? { retail: null, wholesale: [] } : null) }, { categoryIds, rules });
        const nextPro = (changes as { pro?: unknown }).pro;
        const proErrors = nextPro ? validatePro(nextPro).errors : {};
        return { product: p, changes, error: (Object.values(errors)[0] ?? Object.values(proErrors)[0]) as string | undefined };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }, [active, edits, categories, rules]);

  const invalid = pending.filter((x) => x.error).length;
  const dirty = pending.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  const edit = (id: string, patch: Edit) => {
    setEdits((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
    setServerErrors((all) => (all[id] ? Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)) : all));
  };
  const editOffer = (id: string, index: number, patch: OfferEdit) => {
    setEdits((all) => ({
      ...all,
      [id]: { ...all[id], offers: { ...all[id]?.offers, [index]: { ...all[id]?.offers?.[index], ...patch } } },
    }));
    setServerErrors((all) => (all[id] ? Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)) : all));
  };

  const editPro = (id: string, k: string, patch: { exw?: string; fob?: string }) => {
    setEdits((all) => ({ ...all, [id]: { ...all[id], pro: { ...all[id]?.pro, [k]: { ...all[id]?.pro?.[k], ...patch } } } }));
    setServerErrors((all) => (all[id] ? Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)) : all));
  };

  const save = async (): Promise<boolean> => {
    if (invalid > 0) {
      toast(`${plural(invalid, 'ligne à corriger', 'lignes à corriger')} avant d’enregistrer`, { tone: 'error' });
      requestAnimationFrame(() => document.querySelector('[data-row-error]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return false;
    }
    setSaving(true);
    try {
      const updates: BulkUpdate[] = pending.map((x) => ({ id: x.product.id, expected_updated_at: x.product.updated_at, changes: x.changes }));
      const results = await bulkUpdate(updates);
      const failed = results.filter((r) => !r.ok);
      const done = results.filter((r) => r.ok).map((r) => r.id);
      setEdits((all) => Object.fromEntries(Object.entries(all).filter(([id]) => !done.includes(id))));
      setServerErrors(Object.fromEntries(failed.map((r) => [r.id, r.error ?? 'Modification refusée.'])));
      if (failed.length === 0) {
        toast(`${plural(done.length, 'produit mis à jour', 'produits mis à jour')}`);
        return true;
      }
      toast(
        `${done.length > 0 ? `${plural(done.length, 'produit enregistré', 'produits enregistrés')}, ` : ''}${plural(failed.length, 'refusé', 'refusés')}. Voir les lignes en rouge.`,
        { tone: 'error' },
      );
      return false;
    } catch (err) {
      toast(`Non enregistré. ${messageOf(err)}`, { tone: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const needle = normalize(query);
  const shown = active.filter((p) => {
    if (needle && !normalize(`${p.name} ${p.variety} ${p.origin}`).includes(needle)) return false;
    // Les rayons masqués aux grossistes et importateurs n'ont pas d'offre publiée.
    if (view === 'pro') return (p.pro?.offers ?? []).length > 0;
    return true;
  });
  const withoutRetail = view === 'particuliers' ? shown.filter((p) => !p.retail).length : 0;

  const rowState = (p: Product) => {
    const item = pending.find((x) => x.product.id === p.id);
    return { changed: !!item, error: serverErrors[p.id] ?? item?.error, locked: !!p._seal && p._seal !== 'ok' };
  };

  const rowFrame = (s: { changed: boolean; error?: string }) =>
    cx('card p-3 transition-colors duration-150', s.error ? 'border-danger/60' : s.changed && 'border-leaf/60');

  const RowHead = ({ p, right }: { p: Product; right?: React.ReactNode }) => (
    <div className="flex items-center gap-3">
      <Link to={sp(`/produits/${p.id}`)} className="press flex min-w-0 flex-1 items-center gap-3" aria-label={`Ouvrir la fiche ${p.name}`}>
        <ProductArt product={p} size={54} halo={0.5} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold leading-5">{p.name}</span>
          <span className="block truncate text-[12.5px] text-fg-faint">
            {view === 'dispo' ? seasonText(p.months) : view === 'pro' ? plural(p.pro?.offers.length ?? 0, 'mode', 'modes') : p.retail ? p.retail.unitLabel : 'Non vendu aux particuliers'}
          </span>
          {/* Le prix modifié ici est le prix global : les pays qui ont leur propre prix se règlent dans la fiche. */}
          {view !== 'dispo' && countriesApart(p, view) > 0 && (
            <span className="block truncate text-[12px] font-semibold text-leaf" data-prix-pays="mention">
              Prix global · {plural(countriesApart(p, view), 'pays a son prix', 'pays ont leur prix')}, dans la fiche
            </span>
          )}
        </span>
      </Link>
      {right}
    </div>
  );

  const RowFoot = ({ p, s }: { p: Product; s: { error?: string; locked: boolean } }) => (
    <>
      {s.locked && (
        <Link to={sp(`/produits/${p.id}`)} className="mt-1 flex min-h-11 items-center gap-2 text-[12.5px] font-bold text-danger">
          <Icon src={shieldCheckmarkOutline} size={15} />
          Fiche à valider avant toute modification rapide — ouvrir
        </Link>
      )}
      {s.error && (
        <p role="alert" data-row-error className="mt-2.5 text-[13px] font-semibold leading-[18px] text-danger">
          {s.error}
        </p>
      )}
    </>
  );

  return (
    <Page>
      {/* Modifications non enregistrées : la mise à jour automatique attend (components/Update.tsx). */}
      <span hidden data-dirty={dirty ? 'true' : undefined} />
      <PageHeader title="Prix" accent="et disponibilités" subtitle="Saisissez en série, puis enregistrez tout d’un coup." />

      <div className="px-5">
        <Segmented
          label="Ce que vous mettez à jour"
          full
          value={view}
          onChange={(v) => setParams(v === 'dispo' ? { vue: v } : {}, { replace: true })}
          options={[
            space === 'b2b' ? { value: 'pro', label: 'Prix EXW / FOB' } : { value: 'particuliers', label: 'Prix particuliers' },
            { value: 'dispo', label: 'Disponibilités' },
          ]}
        />
        <label className="mt-3.5 flex h-12 items-center gap-2 rounded-full border border-line bg-surface px-3.5 transition-colors focus-within:border-leaf">
          <Icon src={search} size={19} className="text-fg-faint" />
          <span className="sr-only">Rechercher un produit</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher"
            autoComplete="off"
            enterKeyHint="search"
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Effacer la recherche" className="press -mr-2 grid h-11 w-11 place-items-center text-fg-dim">
              <Icon src={closeCircle} size={21} />
            </button>
          )}
        </label>
      </div>

      {error ? (
        <ErrorPanel message={error} onRetry={reload} />
      ) : loading ? (
        <div className="pt-5">
          <SkeletonRows rows={6} />
        </div>
      ) : (
        <>
          <p className="px-6 pt-4 text-[12.5px] leading-[18px] text-fg-faint">
            {view === 'particuliers' &&
              `Prix en euros, par unité de vente. Un champ vidé retire le produit de la vente aux particuliers, sans le supprimer.${withoutRetail ? ` ${plural(withoutRetail, 'produit n’a', 'produits n’ont')} pas d’offre particuliers.` : ''}`}
            {view === 'pro' &&
              `Prix EXW (départ entrepôt) et FOB (chargée au port). Avion : minimum ${kgText(rules.avion.minKg)}, paliers de ${kgText(rules.avion.stepKg)}. Bateau : dès ${plural(rules.bateau.minContainers, 'conteneur', 'conteneurs')}${rules.bateau.containerKg ? `, ${kgText(rules.bateau.containerKg)} par conteneur (référence ${rules.bateau.containerLabel})` : ''}. Un prix vide s’affiche « Prix à confirmer ».`}
            {view === 'dispo' && 'Visible ou masqué dans l’application, et ouverture de chaque offre professionnelle. L’application ne gère pas de stock.'}
          </p>

          {shown.length === 0 ? (
            <div className="mt-2">
              <EmptyState
                title={view === 'pro' && !needle ? 'Aucune offre professionnelle' : 'Rien à ce nom-là'}
                body={view === 'pro' && !needle ? 'Les offres par avion ou par bateau se créent dans la fiche de chaque produit.' : 'Aucun produit ne correspond à cette recherche.'}
              />
            </div>
          ) : (
            <ul className="mt-3 grid grid-cols-1 gap-2.5 px-5 pb-28 lg:grid-cols-2 xl:grid-cols-3">
              {shown.map((p) => {
                const s = rowState(p);
                const e = edits[p.id];

                if (view === 'particuliers') {
                  return (
                    <li key={p.id} className={rowFrame(s)}>
                      <RowHead
                        p={p}
                        right={
                          p.retail ? (
                            <span className="w-[116px] shrink-0">
                              <PriceInput
                                label={`Prix de ${p.name}, ${p.retail.unitLabel}`}
                                suffix="€"
                                value={e?.price ?? numStr(p.retail.price)}
                                onChange={(v) => edit(p.id, { price: v })}
                                invalid={!!s.error}
                                changed={s.changed}
                                disabled={s.locked}
                              />
                            </span>
                          ) : (
                            <Link to={sp(`/produits/${p.id}`)} className="press flex min-h-11 shrink-0 items-center rounded-full border border-line px-3.5 text-[12.5px] font-bold text-fg-dim">
                              Ouvrir
                            </Link>
                          )
                        }
                      />
                      <RowFoot p={p} s={s} />
                    </li>
                  );
                }

                if (view === 'pro') {
                  return (
                    <li key={p.id} className={rowFrame(s)}>
                      <RowHead p={p} />
                      <div className="mt-2 flex flex-col gap-2.5">
                        {(p.pro?.offers ?? []).map((o, i) => (
                          <div key={i} className="rounded-2xl bg-black/20 p-3">
                            <div className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold">
                                {PRO_MODE_LABEL[o.mode]} <span className="font-medium text-fg-faint">· au kilo</span>
                              </span>
                              {!o.active && <Chip>Non proposé</Chip>}
                            </div>
                            {PRO_GROUPS.filter((g) => o.groups[g.id]?.offered).length === 0 ? (
                              <p className="mt-2 text-[12.5px] text-star">Proposé dans aucun groupe de pays : à régler dans la fiche.</p>
                            ) : (
                              PRO_GROUPS.filter((g) => o.groups[g.id]?.offered).map((g) => {
                                const ce = e?.pro?.[proKey(i, g.id)];
                                const row = o.groups[g.id];
                                const sign = PRO_SIGN[g.currency];
                                return (
                                  <div key={g.id} className="mt-2.5">
                                    <span className="mb-1 block text-[11.5px] font-bold tracking-[0.04em] text-fg-faint">{g.label}</span>
                                    <div className="grid grid-cols-2 gap-2.5">
                                      <PriceInput label={`Prix EXW de ${p.name}, ${PRO_MODE_LABEL[o.mode]}, ${g.label}`} suffix={`EXW ${sign}`} value={ce?.exw ?? numStr(row.EXW)} onChange={(v) => editPro(p.id, proKey(i, g.id), { exw: v })} invalid={!!s.error} changed={ce?.exw !== undefined && parseNum(ce.exw) !== row.EXW} disabled={s.locked} wide={g.currency === 'XOF'} />
                                      <PriceInput label={`Prix FOB de ${p.name}, ${PRO_MODE_LABEL[o.mode]}, ${g.label}`} suffix={`FOB ${sign}`} value={ce?.fob ?? numStr(row.FOB)} onChange={(v) => editPro(p.id, proKey(i, g.id), { fob: v })} invalid={!!s.error} changed={ce?.fob !== undefined && parseNum(ce.fob) !== row.FOB} disabled={s.locked} wide={g.currency === 'XOF'} />
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[12px] leading-[17px] text-fg-faint">Case vide : « Prix sur demande ». Exceptions par pays : dans la fiche.</p>
                      <RowFoot p={p} s={s} />
                    </li>
                  );
                }

                const visible = e?.available ?? p.available;
                return (
                  <li key={p.id} className={rowFrame(s)}>
                    <RowHead
                      p={p}
                      right={
                        <span className="flex shrink-0 items-center gap-2.5">
                          <span className={cx('text-[12px] font-bold', visible ? 'text-leaf' : 'text-fg-faint')} aria-hidden>
                            {visible ? 'Visible' : 'Masqué'}
                          </span>
                          <Switch checked={visible} disabled={s.locked} onChange={(v) => edit(p.id, { available: v })} label={`${p.name} visible dans l’application`} />
                        </span>
                      }
                    />
                    {space === 'b2c' && false && p.wholesale.length > 0 && (
                      <div className="mt-2 flex flex-col divide-y divide-line rounded-2xl bg-black/20 px-3">
                        {p.wholesale.map((o, i) => {
                          const open = e?.offers?.[i]?.available ?? o.available;
                          return (
                            <div key={i} className="flex min-h-[52px] items-center gap-2.5">
                              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                                Offre {modeLabel(o.mode).toLowerCase()} <span className="text-fg-faint">· {open ? 'ouverte' : 'fermée'}</span>
                              </span>
                              <Switch checked={open} disabled={s.locked} onChange={(v) => editOffer(p.id, i, { available: v })} label={`Offre ${modeLabel(o.mode)} de ${p.name} ouverte aux commandes`} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <RowFoot p={p} s={s} />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {dirty && (
        <Dock aboveTabs>
          <div className="flex items-center gap-2.5 rounded-full border border-line-strong bg-toast p-2 pl-4 shadow-[0_14px_34px_rgba(0,0,0,0.5)] lg:mb-6">
            <p className="min-w-0 flex-1 truncate text-[13.5px] font-bold" role="status">
              {plural(pending.length, 'modification', 'modifications')}
              {invalid > 0 && <span className="text-danger"> · {invalid} à corriger</span>}
            </p>
            <button type="button" onClick={() => { setEdits({}); setServerErrors({}); }} disabled={saving} className="press min-h-11 rounded-full px-3.5 text-[13.5px] font-bold text-fg-dim">
              Annuler
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              aria-busy={saving || undefined}
              className="press flex min-h-11 items-center gap-2 rounded-full bg-leaf px-5 text-[14.5px] font-extrabold text-on-leaf disabled:opacity-70"
            >
              {saving && <span className="spinner" style={{ width: 15, height: 15 }} />}
              Enregistrer
            </button>
          </div>
        </Dock>
      )}

      <Sheet open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title="Modifications non enregistrées">
        <p className="text-[15px] leading-[23px] text-fg-dim">
          {plural(pending.length, 'modification n’est pas enregistrée', 'modifications ne sont pas enregistrées')}. En quittant maintenant, elles seront perdues.
        </p>
        <div className="mt-5 flex flex-col gap-2.5">
          <PrimaryButton
            label="Enregistrer et quitter"
            loading={saving}
            onClick={async () => {
              if (await save()) blocker.proceed?.();
              else blocker.reset?.();
            }}
          />
          <GhostButton label="Quitter sans enregistrer" tone="danger" onClick={() => blocker.proceed?.()} disabled={saving} />
          <GhostButton label="Rester sur cette page" onClick={() => blocker.reset?.()} disabled={saving} />
        </div>
      </Sheet>
    </Page>
  );
}
