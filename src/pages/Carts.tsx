import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { useOrders, type Cart, type CartLine } from '../contexts/OrdersContext';
import { Chip, ConfirmSheet, EmptyState, ErrorPanel, FilterChip, GhostButton, Notice, Page, PageHeader, Segmented, Sheet, SkeletonRows } from '../components/ui';
import { RuleRow } from '../components/CountryPrices';
import { ACTIVITY, Kpi, Refresh, Row, contactLink, nameInitials } from './ordersKit';
import { messageOf } from '../lib/api';
import { ago, amount, count, dateTime, normalize, plural } from '../lib/format';
import { cx } from '../lib/ui';
import { CART_STATUS_LABEL, CONTACT_LABEL, cartContactLinks, type CartStatusId, type ContactWay } from '../../shared/carts.js';
import { countryName } from '../../shared/catalog.js';

// ───────────── Repères

const TONE: Record<CartStatusId, 'leaf' | 'star' | 'neutral'> = { actif: 'leaf', abandonne: 'star', commande: 'neutral', vide: 'neutral' };
const WEEK = 7 * 24 * 3600 * 1000;
const CURRENCY_NAME: Record<string, string> = { EUR: 'en euros', XOF: 'en francs CFA', XAF: 'en francs CFA', USD: 'en dollars' };

/** Drapeau d'un pays (code ISO à deux lettres). */
const flagOf = (code: string) => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '');
const codeOf = (c: Cart) => c.country || c.account.country;
const placeText = (c: Cart) => (codeOf(c) ? `${flagOf(codeOf(c))} ${countryName(codeOf(c))}` : 'Pays inconnu');
const nameOf = (c: Cart) => c.account.name || c.account.company || c.account.phone || 'Client sans nom';
const whoText = (c: Cart) => (c.account.type === 'pro' ? `Pro${c.account.company ? ` · ${c.account.company}` : ''}` : 'Particulier');
/** Totaux par devise, jamais additionnés : « 12,40 € · 7 500 F CFA ». */
const totalsText = (c: Cart) => (c.totals.length > 0 ? c.totals.map((t) => amount(t.amount, t.currency)).join(' · ') : 'À confirmer');
const amountIn = (c: Cart, currency: string) => c.totals.find((t) => t.currency === currency)?.amount ?? 0;

function byCurrency(list: Cart[]) {
  const sums: Record<string, number> = {};
  for (const c of list) for (const t of c.totals) sums[t.currency] = Math.round(((sums[t.currency] ?? 0) + t.amount) * 100) / 100;
  // Les euros d'abord, puis les autres devises.
  return Object.entries(sums).sort(([a], [b]) => (a === 'EUR' ? -1 : b === 'EUR' ? 1 : a.localeCompare(b)));
}

function qtyText(l: CartLine) {
  if (l.unit === 'kg') return `${String(l.qty).replace('.', ',')} kg`;
  const noun = l.unit === 'conteneur' ? ['conteneur', 'conteneurs'] : (l.noun ?? ['pièce', 'pièces']);
  return `${String(l.qty).replace('.', ',')} ${l.qty > 1 ? noun[1] : noun[0]}`;
}

function Initials({ cart: c }: { cart: Cart }) {
  return (
    <span className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-full text-[14px] font-extrabold', c.account.type === 'pro' ? 'bg-star text-bg-deep' : 'bg-leaf text-on-leaf')}>
      {nameInitials(nameOf(c))}
    </span>
  );
}

/** Une ligne par panier (RuleRow) : client, type, pays, articles, total par devise, activité, statut. */
function CartRow({ cart: c, onOpen }: { cart: Cart; onOpen: () => void }) {
  return (
    <RuleRow
      lead={<Initials cart={c} />}
      title={nameOf(c)}
      summary={`${whoText(c)} · ${placeText(c)} · ${plural(c.lines.length, 'article', 'articles')} · ${totalsText(c)} · ${ago(c.updated_at)}`}
      chips={
        <>
          <Chip tone={TONE[c.status]}>{CART_STATUS_LABEL[c.status]}</Chip>
          {c.unpriced > 0 && <Chip tone="star">Prix à confirmer</Chip>}
          {c.contacts.length > 0 && <Chip>Relancé {ago(c.contacts[c.contacts.length - 1].at)}</Chip>}
        </>
      }
      onEdit={onOpen}
      editLabel={`Ouvrir le panier de ${nameOf(c)}`}
      editText="Ouvrir"
    />
  );
}

// ───────────── Fiche d'un panier : même mise en page que la fiche d'une commande

function CartSheet({ cart: c, onClose }: { cart: Cart | null; onClose: () => void }) {
  const { contactCart, removeCart, orders } = useOrders();
  const { canEdit, isOwner } = useAuth();
  const { products, photoOf } = useData();
  const toast = useToast();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const links = c ? cartContactLinks(c.account, c.lines.length) : null;
  const last = c && c.contacts.length > 0 ? c.contacts[c.contacts.length - 1] : null;
  const isClient = !!c && orders.some((o) => o.customer.account_id === c.id);

  // Le lien s'ouvre (WhatsApp, appel, e-mail) ; la fiche note quand et par quel moyen.
  const note = (via: ContactWay) => {
    if (!c || !canEdit) return;
    contactCart(c.id, via)
      .then(() => toast(`Relance notée : ${CONTACT_LABEL[via]}`))
      .catch((err) => toast(messageOf(err), { tone: 'error' }));
  };
  const thumbOf = (l: CartLine) => {
    const p = products.find((x) => x.id === l.product_id);
    const pack = l.line_id.includes(':') ? p?.packagings?.find((k) => k.id === l.line_id.split(':')[1]) : undefined;
    return pack?.photo_url || (p ? photoOf(p, 'thumb') : null);
  };
  const remove = async () => {
    if (!c) return;
    setBusy(true);
    try {
      await removeCart(c.id);
      toast(`Panier de ${nameOf(c)} supprimé`);
      setSure(false);
      onClose();
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open={!!c && !sure} onClose={onClose} title={c ? `Panier de ${nameOf(c)}` : ''}>
        {c && links && (
          <>
            <p className="text-[13px] text-fg-dim">
              Modifié {ago(c.updated_at)} · commencé le {dateTime(c.created_at)}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Chip tone={TONE[c.status]}>{CART_STATUS_LABEL[c.status]}</Chip>
              <Chip tone={c.account.type === 'pro' ? 'star' : 'leaf'}>{c.account.type === 'pro' ? 'Professionnel' : 'Particulier'}</Chip>
              {c.unpriced > 0 && <Chip tone="star">Prix à confirmer</Chip>}
            </div>
            {c.status === 'commande' && c.order && (
              <div className="mt-3">
                <Notice
                  tone="leaf"
                  title={`Transformé en commande ${c.order.number}`}
                  action={
                    <Link to={`/commandes?commande=${encodeURIComponent(c.order.id)}`} className={contactLink}>
                      Voir la commande
                    </Link>
                  }
                >
                  Commande reçue {ago(c.order.received_at)}, après la dernière modification de ce panier.
                </Notice>
              </div>
            )}

            <h3 className="mt-5 font-display text-[18px] font-semibold">Client</h3>
            <dl className="divide-y divide-line">
              {c.account.name && <Row label="Nom">{c.account.name}</Row>}
              <Row label="Type">{c.account.type === 'pro' ? `Professionnel${c.account.activity ? ` · ${ACTIVITY[c.account.activity] ?? c.account.activity}` : ''}` : 'Particulier'}</Row>
              {c.account.company && <Row label="Société">{c.account.company}</Row>}
              <Row label="Pays">{placeText(c)}</Row>
              {c.account.phone && <Row label="Téléphone">{c.account.phone}</Row>}
              {c.account.email && <Row label="E-mail">{c.account.email}</Row>}
              {c.account.whatsapp && <Row label="WhatsApp">{c.account.whatsapp}</Row>}
            </dl>
            {(links.whatsapp || links.call || links.email) && (
              <div className="mt-2 flex flex-wrap gap-2.5">
                {links.whatsapp && (
                  <a href={links.whatsapp} target="_blank" rel="noreferrer noopener" onClick={() => note('whatsapp')} className={cx(contactLink, 'border-leaf/50 text-leaf')}>
                    WhatsApp
                  </a>
                )}
                {links.call && (
                  <a href={links.call} onClick={() => note('appel')} className={contactLink}>
                    Appeler
                  </a>
                )}
                {links.email && (
                  <a href={links.email} onClick={() => note('email')} className={contactLink}>
                    E-mail
                  </a>
                )}
                {isClient && (
                  <Link to={`/commandes/clients?client=${encodeURIComponent(c.id.toLowerCase())}`} className={contactLink}>
                    Voir ce client
                  </Link>
                )}
              </div>
            )}
            <p className="mt-2 text-[12.5px] leading-[18px] text-fg-faint">
              {last ? `Relancé le ${dateTime(last.at)} par ${CONTACT_LABEL[last.via]}.` : 'Pas encore relancé.'} Message prêt : « {links.message} »
            </p>

            <h3 className="mt-5 font-display text-[18px] font-semibold">Contenu</h3>
            <ul className="divide-y divide-line">
              {c.lines.map((l) => {
                const thumb = thumbOf(l);
                return (
                  <li key={l.line_id} className="flex items-center gap-3 py-2.5">
                    <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-black/30">
                      {thumb ? <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span aria-hidden className="text-[18px] leading-none text-fg-faint">·</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-bold">
                        {l.name}
                        {l.format_label ? ` · ${l.format_label}` : ''}
                        {l.mode ? ` · ${l.mode}` : ''}
                      </span>
                      <span className="block text-[12.5px] text-fg-faint">
                        {qtyText(l)}
                        {l.unit_price !== null ? ` × ${amount(l.unit_price, l.currency)}` : ''} · ajouté {ago(l.added_at)}
                        {!l.known ? ' · plus proposé à ce client' : ''}
                      </span>
                    </span>
                    <span className={cx('tabular shrink-0 text-[14.5px] font-extrabold', l.total === null && 'text-[12.5px] text-star')}>
                      {l.total === null ? 'Prix à confirmer' : amount(l.total, l.currency)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <dl className="mt-1 border-t border-line-strong pt-1">
              {c.incoterm && <Row label="Incoterm">{c.incoterm}</Row>}
              {c.totals.length === 0 ? (
                <Row label="Total">À confirmer</Row>
              ) : (
                c.totals.map((t) => (
                  <Row key={t.currency} label={`Total ${CURRENCY_NAME[t.currency] ?? t.currency}`}>
                    <span className="tabular text-[17px] font-extrabold">{amount(t.amount, t.currency)}</span>
                  </Row>
                ))
              )}
            </dl>
            <p className="mt-1 text-[12.5px] leading-[18px] text-fg-faint">
              Prix recalculés par la tour d’après le catalogue publié{c.totals.length > 1 ? ' ; les devises ne sont jamais additionnées' : ''}.
              {c.unpriced > 0 ? ` ${plural(c.unpriced, 'ligne sans prix n’entre', 'lignes sans prix n’entrent')} dans aucun total.` : ''}
            </p>
            {isOwner && (
              <GhostButton className="mt-5 w-full" tone="danger" label="Supprimer ce panier" onClick={() => setSure(true)} />
            )}
          </>
        )}
      </Sheet>
      <ConfirmSheet open={sure} onClose={() => setSure(false)} title="Supprimer ce panier ?" confirmLabel="Supprimer" danger busy={busy} onConfirm={remove}>
        Le panier disparaît de la tour. L’application du client le renverra s’il le modifie encore.
      </ConfirmSheet>
    </>
  );
}

// ───────────── Page « Paniers »

type StatusFilter = 'tous' | 'actif' | 'abandonne' | 'commande';
type Sort = 'activite' | 'valeur' | 'articles';

export function OrdersCarts() {
  const { carts, cartsError, loading, error, reload, loadedAt } = useOrders();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>('tous');
  const [type, setType] = useState<'tous' | 'particulier' | 'pro'>('tous');
  const [country, setCountry] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('activite');
  const openId = params.get('panier');
  const setOpenId = (id: string | null) => setParams(id ? { panier: id } : {}, { replace: true });
  const now = loadedAt ?? 0;

  const active = carts.filter((c) => c.status === 'actif');
  const abandoned = carts.filter((c) => c.status === 'abandonne');
  const ordered = carts.filter((c) => c.status === 'commande' && c.order && now - Date.parse(c.order.received_at) < WEEK);
  const values = byCurrency(active);

  const countries = useMemo(() => {
    const seen = new Map<string, number>();
    carts.forEach((c) => codeOf(c) && seen.set(codeOf(c), (seen.get(codeOf(c)) ?? 0) + 1));
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || countryName(a[0]).localeCompare(countryName(b[0]), 'fr'));
  }, [carts]);

  const needle = normalize(query);
  const filtered = carts
    .filter((c) => type === 'tous' || c.account.type === type)
    .filter((c) => !country || codeOf(c) === country)
    .filter((c) => !needle || normalize(`${c.account.name} ${c.account.company} ${c.account.phone} ${c.account.whatsapp} ${c.account.email}`).includes(needle));
  const shown = (status === 'tous' ? filtered : filtered.filter((c) => c.status === status)).sort((a, b) =>
    sort === 'valeur'
      ? amountIn(b, 'EUR') - amountIn(a, 'EUR') || amountIn(b, 'XOF') - amountIn(a, 'XOF')
      : sort === 'articles'
        ? b.lines.length - a.lines.length
        : b.updated_at.localeCompare(a.updated_at),
  );
  const opened = carts.find((c) => c.id === openId) ?? null;
  const time = loadedAt ? new Date(loadedAt) : null;

  return (
    <Page>
      <PageHeader
        title="Paniers"
        subtitle={time ? `En cours dans l’application · relus toutes les 30 secondes, dernière lecture à ${String(time.getHours()).padStart(2, '0')}h${String(time.getMinutes()).padStart(2, '0')}` : 'Lecture des paniers…'}
        right={<Refresh />}
      />
      {error && carts.length === 0 ? (
        <ErrorPanel message={error} onRetry={reload} />
      ) : cartsError && carts.length === 0 ? (
        <ErrorPanel message={cartsError} onRetry={reload} />
      ) : loading ? (
        <SkeletonRows rows={5} />
      ) : carts.length === 0 ? (
        <EmptyState
          title="Aucun panier en cours"
          body="Dès qu’un client de l’application ajoute un produit à son panier, il apparaît ici, avec son contenu et ses coordonnées pour l’aider à finaliser sa commande."
          tint="#C98A2B"
        />
      ) : (
        <>
          <div className="mx-5 mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Actifs" value={count(active.length)} tone="leaf" detail="Modifiés il y a moins de 24 h." />
            <Kpi label="Abandonnés" value={count(abandoned.length)} tone={abandoned.length > 0 ? 'star' : undefined} detail="Sans modification depuis 24 h : à relancer." />
            <Kpi label="Commandés · 7 jours" value={count(ordered.length)} detail="Paniers transformés en commande." />
            <Kpi
              label="Valeur des paniers actifs"
              value={values.length > 0 ? amount(values[0][1], values[0][0]) : '—'}
              detail={
                values.length > 1
                  ? `Par devise, jamais additionnées : ${values.map(([cur, n]) => amount(n, cur)).join(' · ')}.`
                  : values.length === 1
                    ? 'Lignes chiffrées seulement.'
                    : 'Aucun panier actif chiffré.'
              }
            />
          </div>

          <div className="px-5 pt-5">
            <Segmented
              label="Type de client"
              full
              value={type}
              onChange={setType}
              options={[
                { value: 'tous', label: 'Tous' },
                { value: 'particulier', label: 'Particuliers' },
                { value: 'pro', label: 'Pros' },
              ]}
            />
            <div className="mt-3.5 flex flex-col gap-3 sm:flex-row">
              <label className="flex h-12 min-w-0 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-4 transition-colors focus-within:border-leaf sm:flex-1">
                <span className="sr-only">Rechercher un panier</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Nom ou téléphone…"
                  autoComplete="off"
                  enterKeyHint="search"
                  className="h-full min-w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} aria-label="Effacer la recherche" className="press -mr-2.5 grid h-11 min-w-11 place-items-center text-[20px] font-bold leading-none text-fg-dim">
                    ×
                  </button>
                )}
              </label>
              <select
                aria-label="Filtrer par pays"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="h-12 shrink-0 rounded-full border border-line bg-surface px-4 text-[14.5px] font-bold text-fg outline-none focus:border-leaf sm:w-[230px]"
              >
                <option value="">Tous les pays ({carts.length})</option>
                {countries.map(([code, n]) => (
                  <option key={code} value={code}>
                    {countryName(code)} ({n})
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3.5">
              <Segmented
                label="Trier les paniers"
                full
                value={sort}
                onChange={setSort}
                options={[
                  { value: 'activite', label: 'Dernière activité' },
                  { value: 'valeur', label: 'Valeur' },
                  { value: 'articles', label: 'Articles' },
                ]}
              />
            </div>
          </div>

          <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto px-5 pb-1" role="group" aria-label="Filtrer par statut">
            <FilterChip active={status === 'tous'} onClick={() => setStatus('tous')} count={filtered.length}>
              Tous
            </FilterChip>
            {(['actif', 'abandonne', 'commande'] as const).map((id) => (
              <FilterChip key={id} active={status === id} onClick={() => setStatus(id)} count={filtered.filter((c) => c.status === id).length}>
                {id === 'actif' ? 'Actifs' : id === 'abandonne' ? 'Abandonnés' : 'Commandés'}
              </FilterChip>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="px-6 pt-8 text-center text-[14.5px] leading-[22px] text-fg-dim">Aucun panier ne correspond à cette sélection.</p>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-3 px-5 lg:grid-cols-2">
              {shown.map((c, i) => (
                <motion.li key={c.id} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 260, damping: 26, delay: i < 9 ? i * 0.03 : 0 }}>
                  <CartRow cart={c} onOpen={() => setOpenId(c.id)} />
                </motion.li>
              ))}
            </ul>
          )}
        </>
      )}
      <CartSheet cart={opened} onClose={() => setOpenId(null)} />
    </Page>
  );
}

/** Fiche d'un client (page « Clients ») : son panier en cours, s'il en a un. */
export function ClientCart({ accountId }: { accountId: string }) {
  const { carts } = useOrders();
  const navigate = useNavigate();
  const c = carts.find((x) => x.id.toLowerCase() === accountId.toLowerCase());
  if (!c) return null;
  return (
    <>
      <h3 className="mt-5 font-display text-[18px] font-semibold">Panier en cours</h3>
      <div className="mt-2.5">
        <CartRow cart={c} onOpen={() => navigate(`/commandes/paniers?panier=${encodeURIComponent(c.id)}`)} />
      </div>
    </>
  );
}
