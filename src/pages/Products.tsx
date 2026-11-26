import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { add, closeCircle, search } from '../lib/glyphs';
import { useData, type Product } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { Icon } from '../components/Icon';
import { CategoryRail, ProductRowCard } from '../components/catalog';
import { EmptyState, ErrorPanel, FilterChip, Page, PageHeader, RoundButton, SkeletonRows } from '../components/ui';
import { messageOf } from '../lib/api';
import { currentMonth, normalize, plural } from '../lib/format';
import { cx } from '../lib/ui';
import { COUNTRY_CODES, countryName, zoneAllows } from '../../shared/catalog.js';

/** Tous les pays sauf le Sénégal (placé en tête de liste), par ordre alphabétique. */
const COUNTRIES = COUNTRY_CODES.filter((code) => code !== 'SN')
  .map((code) => ({ code, name: countryName(code) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

const STATES = [
  { id: 'tous', label: 'Tous' },
  { id: 'visibles', label: 'Visibles' },
  { id: 'masques', label: 'Masqués' },
  { id: 'a-completer', label: 'À compléter' },
  { id: 'exemple', label: 'Exemple' },
  { id: 'pro', label: 'Offres pro' },
  { id: 'saison', label: 'De saison' },
  { id: 'a-valider', label: 'À valider' },
  { id: 'archives', label: 'Archivés' },
] as const;

const MISSING: Record<string, string> = {
  photo: 'Sans photo',
  prix: 'Sans prix',
  'prix-pro': 'Prix pro à confirmer',
  description: 'Sans description',
  origine: 'Sans origine',
  saison: 'Sans saison',
  rayon: 'Rayon inconnu de l’application',
};

export default function Products() {
  const { products, categories, loading, error, reload, issuesOf, bulkUpdate } = useData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = params.get('q') ?? '';
  const rayon = params.get('rayon') ?? 'tout';
  const etat = params.get('etat') ?? 'tous';
  const manque = params.get('manque');
  // Filtre par pays : un code de pays (« vu depuis »), ou un réglage (« r:sn », « r:except », « r:all »).
  const pays = params.get('pays') ?? '';

  const patch = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const month = currentMonth();
  const matchesState = (p: Product, state: string) => {
    if (state === 'archives') return p.archived;
    if (p.archived) return false;
    switch (state) {
      case 'visibles': return p.available;
      case 'masques': return !p.available;
      case 'a-completer': return issuesOf(p).length > 0;
      case 'exemple': return p.is_example;
      case 'pro': return p.wholesale.length > 0;
      case 'saison': return p.available && p.months.includes(month);
      case 'a-valider': return !!p._seal && p._seal !== 'ok';
      default: return true;
    }
  };

  const stateCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of STATES) out[s.id] = products.filter((p) => matchesState(p, s.id)).length;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, issuesOf, month]);

  const { list, counts, total } = useMemo(() => {
    const needle = normalize(q);
    const base = products.filter((p) => {
      if (!matchesState(p, etat)) return false;
      if (manque && !issuesOf(p).some((i) => i.code === manque)) return false;
      if (pays.startsWith('r:') ? (p.zone?.mode ?? 'all') !== pays.slice(2) : pays && !zoneAllows(p.zone, pays)) return false;
      if (needle && !normalize(`${p.name} ${p.variety} ${p.origin} ${p.id}`).includes(needle)) return false;
      return true;
    });
    const byCategory: Record<string, number> = {};
    for (const p of base) byCategory[p.category] = (byCategory[p.category] ?? 0) + 1;
    return { list: rayon === 'tout' ? base : base.filter((p) => p.category === rayon), counts: byCategory, total: base.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, q, rayon, etat, manque, pays, issuesOf, month]);

  const toggle = async (p: Product, next: boolean) => {
    setBusyId(p.id);
    try {
      const [result] = await bulkUpdate([{ id: p.id, expected_updated_at: p.updated_at, changes: { available: next } }]);
      if (result?.ok) {
        toast(next ? `« ${p.name} » : visible dans l’application` : `« ${p.name} » : masqué dans l’application`);
      } else {
        toast(result?.error ?? 'Modification refusée.', {
          tone: 'error',
          action: { label: 'Ouvrir la fiche', onPress: () => navigate(`/produits/${p.id}`) },
        });
      }
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const filtered = q !== '' || rayon !== 'tout' || etat !== 'tous' || !!manque || pays !== '';
  const rayonLabel = rayon === 'tout' ? null : (categories.find((c) => c.id === rayon)?.label ?? rayon);

  return (
    <Page>
      <PageHeader
        title="Produits"
        accent={rayonLabel ? rayonLabel.toLowerCase() : undefined}
        subtitle={loading ? 'Lecture du catalogue…' : `${plural(list.length, 'fiche', 'fiches')}${filtered ? ' dans cette sélection' : ' au catalogue'}`}
        right={<RoundButton icon={add} label="Ajouter un produit" solid size={48} onClick={() => navigate('/produits/nouveau')} />}
      />

      <div className="flex flex-col gap-3 px-5 sm:flex-row">
        <label className="flex h-12 min-w-0 shrink-0 items-center sm:flex-1 gap-2 rounded-full border border-line bg-surface px-3.5 transition-colors focus-within:border-leaf focus-within:bg-white/[0.08]">
          <Icon src={search} size={19} className="text-fg-faint" />
          <span className="sr-only">Rechercher un produit</span>
          <input
            type="search"
            value={q}
            onChange={(e) => patch({ q: e.target.value })}
            placeholder="Mangue, Sénégal, Kent…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            enterKeyHint="search"
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button type="button" onClick={() => patch({ q: null })} aria-label="Effacer la recherche" className="press press-deep -mr-2 grid h-11 w-11 place-items-center text-fg-dim">
              <Icon src={closeCircle} size={21} />
            </button>
          )}
        </label>
        <select
          aria-label="Filtrer par pays"
          value={pays}
          onChange={(e) => patch({ pays: e.target.value || null })}
          className={cx('h-12 shrink-0 rounded-full border bg-surface px-4 text-[14.5px] font-bold text-fg outline-none focus:border-leaf sm:w-[250px]', pays ? 'border-leaf' : 'border-line')}
        >
          <option value="">Tous les pays</option>
          <optgroup label="Vu depuis">
            <option value="SN">Sénégal</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Par réglage">
            <option value="r:all">Monde entier</option>
            <option value="r:sn">Sénégal uniquement</option>
            <option value="r:except">Monde entier sauf…</option>
          </optgroup>
        </select>
      </div>

      {error ? (
        <ErrorPanel message={error} onRetry={reload} />
      ) : loading ? (
        <div className="pt-6">
          <SkeletonRows rows={6} />
        </div>
      ) : (
        <>
          <div className="mt-5">
            <CategoryRail value={rayon} onChange={(id) => patch({ rayon: id === 'tout' ? null : id })} counts={counts} total={total} roomy />
          </div>

          <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto px-5 pb-1" role="group" aria-label="Filtrer par état">
            {STATES.filter((s) => s.id === 'tous' || s.id === etat || stateCounts[s.id] > 0).map((s) => (
              <FilterChip key={s.id} active={etat === s.id} onClick={() => patch({ etat: s.id === 'tous' ? null : s.id })} count={stateCounts[s.id]}>
                {s.label}
              </FilterChip>
            ))}
          </div>

          {manque && (
            <div className="px-5 pt-3">
              <button
                type="button"
                onClick={() => patch({ manque: null })}
                className="press flex min-h-11 items-center gap-2 rounded-full bg-star-wash pl-4 pr-2.5 text-[13.5px] font-bold text-star"
                aria-label={`Retirer le filtre : ${MISSING[manque] ?? manque}`}
              >
                {MISSING[manque] ?? manque}
                <Icon src={closeCircle} size={19} />
              </button>
            </div>
          )}

          {list.length === 0 ? (
            <div className="mt-4">
              {products.length === 0 ? (
                <EmptyState title="Catalogue vide" body="Aucun produit n’est enregistré. Ajoutez le premier pour commencer." cta="Ajouter un produit" onPress={() => navigate('/produits/nouveau')} />
              ) : (
                <EmptyState
                  title="Rien à ce nom-là"
                  body={q ? `Aucun produit ne correspond à « ${q.trim()} » dans cette sélection. Essayez un autre mot ou retirez les filtres.` : 'Aucun produit ne correspond à ces filtres.'}
                  cta="Voir tous les produits"
                  onPress={() => setParams(new URLSearchParams(), { replace: true })}
                />
              )}
            </div>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-3 px-5 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {list.map((p, i) => (
                <motion.li
                  key={p.id}
                  initial={{ opacity: 0, y: 18, scale: 0.97 }}
                  whileInView={{ opacity: 1, y: 0, scale: 1 }}
                  viewport={{ once: true, margin: '0px 0px -24px 0px' }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26, delay: i < 9 ? i * 0.035 : 0 }}
                >
                  <ProductRowCard product={p} busy={busyId === p.id} onToggle={(next) => toggle(p, next)} />
                </motion.li>
              ))}
            </ul>
          )}

          <p className="px-6 pt-5 text-[12.5px] leading-[18px] text-fg-faint">
            L’interrupteur décide si le produit apparaît dans l’application. L’application ne gère pas de stock : il n’y a pas de
            quantité à suivre, seulement « visible » ou « masqué ».
          </p>
        </>
      )}
    </Page>
  );
}
