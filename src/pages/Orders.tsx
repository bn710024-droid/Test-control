import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { OrdersProvider, useOrders, type Logistics, type Order, type OrderLine, type OrderPatch, type OrderStatus, type PayMethod } from '../contexts/OrdersContext';
import { Backdrop } from '../components/Shell';
import { Chip, EmptyState, ErrorPanel, Field, FilterChip, GhostButton, Notice, Page, PageHeader, PrimaryButton, Segmented, Sheet, SkeletonRows } from '../components/ui';
import { CountryChips } from '../components/CountryChips';
import { ApiError, messageOf } from '../lib/api';
import { MONTHS, ago, amount, count, dateTime, kgText, money, normalize, plural } from '../lib/format';
import { cx } from '../lib/ui';
import { PRO_STAGES, clientNotice, proStageLabel, proStageOf, type ProStage } from '../../shared/orders.js';
import { countryName, isCountryCode } from '../../shared/catalog.js';

// ───────────── Repères communs

type Tone = 'neutral' | 'leaf' | 'star' | 'danger';
const STATUS: Record<OrderStatus, { label: string; many: string; tone: Tone }> = {
  attente: { label: 'En attente', many: 'En attente', tone: 'star' },
  confirmee: { label: 'Confirmée', many: 'Confirmées', tone: 'leaf' },
  preparation: { label: 'En préparation', many: 'En préparation', tone: 'leaf' },
  expediee: { label: 'Expédiée', many: 'Expédiées', tone: 'leaf' },
  livree: { label: 'Livrée', many: 'Livrées', tone: 'neutral' },
  annulee: { label: 'Annulée', many: 'Annulées', tone: 'danger' },
};
const FLOW: OrderStatus[] = ['attente', 'confirmee', 'preparation', 'expediee', 'livree'];
const ALL_STATUS: OrderStatus[] = [...FLOW, 'annulee'];
/** Moyens de paiement. Orange Money et Wave : surtout au Sénégal ; virement et carte : partout. */
const METHODS: { id: PayMethod; label: string }[] = [
  { id: 'orange_money', label: 'Orange Money' },
  { id: 'wave', label: 'Wave' },
  { id: 'virement', label: 'Virement bancaire' },
  { id: 'carte', label: 'Carte bancaire' },
];
const PAYMENT: Record<string, string> = { orange_money: 'Orange Money', wave: 'Wave', virement: 'Virement bancaire', carte: 'Carte bancaire', mobile: 'Mobile money' };
const ACTIVITY: Record<string, string> = { grossiste: 'Grossiste', importateur: 'Importateur', autre: 'Autre professionnel' };

const customerName = (o: Order) => o.customer.company || o.customer.name || o.customer.email || o.customer.phone || 'Client sans nom';
const customerKey = (o: Order) => (o.customer.account_id || o.customer.email || o.customer.phone || customerName(o)).toLowerCase();
const placeOf = (o: Order) => o.country || o.address || 'Adresse non renseignée';
const destinationOf = (o: Order) => (o.country && o.address.includes(o.country) ? o.address : [o.address, o.country].filter(Boolean).join(', '));
/** Une commande annulée ne compte dans aucun montant. */
const counted = (o: Order) => o.status !== 'annulee';
const amountText = (o: Order) => (o.total > 0 ? `${amount(o.total, o.currency)}${o.unpriced > 0 ? ' +' : ''}` : 'À confirmer');
const nameInitials = (name: string) => {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return parts.length === 0 ? '?' : (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

/** Sénégal : livraison par nos livreurs. Ailleurs : transit jusqu'à l'aéroport d'arrivée. */
type Zone = 'senegal' | 'international' | 'inconnue';
function zoneOf(o: Order): Zone {
  if (o.country.trim().toUpperCase() === 'SN' || normalize(`${o.country} ${o.address}`).includes('senegal')) return 'senegal';
  return o.country || o.address ? 'international' : 'inconnue';
}
/** Pays de la commande, en clair (l'application envoie tantôt le nom, tantôt le code à deux lettres). */
const countryOf = (o: Order) => {
  const c = o.country.trim();
  if (!c) return zoneOf(o) === 'senegal' ? 'Sénégal' : 'Pays non renseigné';
  return /^[A-Za-z]{2}$/.test(c) && isCountryCode(c) ? countryName(c) : c;
};
/** International : vrai quand le GP livre jusqu'au domicile (porte à porte), faux jusqu'à l'aéroport. */
const doorOf = (o: Order) => zoneOf(o) === 'international' && (o.delivery_mode ?? o.delivery) === 'domicile';

// ───────────── Position du client et course du livreur
type Spot = NonNullable<Order['location']>;
const coord = (n: number) => n.toFixed(5).replace('.', ',');
/** Itinéraire jusqu'au client, dans l'application de cartes du téléphone. */
const routeLink = (spot: Spot) => `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}&travelmode=driving`;
const pinLink = (spot: Spot) => `https://www.google.com/maps/search/?api=1&query=${spot.lat},${spot.lng}`;
const spotText = (spot: Spot) => `${coord(spot.lat)}, ${coord(spot.lng)}${spot.accuracy !== null ? ` · à ${spot.accuracy < 1000 ? `${spot.accuracy}\u00A0m` : `${Math.round(spot.accuracy / 100) / 10}\u00A0km`} près` : ''}`;

/** Numéro d'un livreur pour WhatsApp. Sans indicatif, un mobile sénégalais (9 chiffres, 7x) reçoit +221. */
function courierWhatsApp(phone: string) {
  const raw = phone.trim();
  const d = raw.replace(/\D/g, '').replace(/^00/, '');
  if (/^(\+|00)/.test(raw)) return d.length >= 8 ? d : null;
  if (d.length === 9 && d.startsWith('7')) return `221${d}`;
  return null;
}

/** La course, prête à partir vers le livreur : qui, où, quoi, et le numéro à appeler. */
function courierMessage(o: Order) {
  return [
    `TROPICAURA — course ${o.number}`,
    `Client : ${customerName(o)}`,
    o.customer.phone ? `Téléphone du client : ${o.customer.phone}` : 'Téléphone du client : non renseigné',
    `Adresse : ${destinationOf(o) || 'à préciser'}`,
    o.location ? `Position du téléphone : ${pinLink(o.location)}` : 'Position du téléphone : non partagée — appeler le client pour se faire guider.',
    '',
    'À livrer :',
    ...o.lines.map((l) => `• ${l.name} — ${qtyText(l)}`),
    '',
    o.paid_at ? 'Commande déjà payée : rien à encaisser.' : false,
    'Livraison jusqu’au domicile. Appelez le client à l’arrivée.',
  ]
    .filter((line) => line !== false)
    .join('\n');
}

/** Les statuts portent partout le nom qu'ils ont dans l'application d'achat. */
const labelOf = (o: Order, status: OrderStatus = o.status) => STATUS[status].label;

// ───────────── Demandes professionnelles (B2B) : du premier contact au contrat, puis à la livraison

/** Étapes « en cours » d'une demande, dans l'ordre. « Livrée » et « Sans suite » la terminent. */
const PRO_FLOW: ProStage[] = ['interet', 'contacte', 'discussion', 'contrat', 'preparation', 'livraison', 'livree'];
const PRO_MEANING: Record<ProStage, string> = {
  interet: 'Premier contact : le client a envoyé son intérêt. À contacter.',
  contacte: 'Nous avons contacté le client ; sa réponse est attendue.',
  discussion: 'Quantités, prix, transport et paiement en discussion.',
  contrat: 'Contrat conclu : la commande est ferme.',
  preparation: 'Nous préparons la marchandise.',
  livraison: 'Marchandise en route, selon les conditions du contrat.',
  livree: 'Réception confirmée : la marchandise est livrée.',
  annulee: 'Demande classée sans suite : elle ne compte dans aucun montant.',
};
/** Le geste suivant, dans les mots de l'équipe. */
const PRO_ACTION: Partial<Record<ProStage, string>> = {
  contacte: 'Marquer comme contacté',
  discussion: 'Passer en discussion',
  contrat: 'Contrat conclu',
  preparation: 'Préparer la livraison',
  livraison: 'Mettre en livraison',
  livree: 'Confirmer la réception',
};
const PRO_TONE: Record<ProStage, Tone> = { interet: 'star', contacte: 'neutral', discussion: 'neutral', contrat: 'leaf', preparation: 'leaf', livraison: 'leaf', livree: 'neutral', annulee: 'danger' };
const proNext = (stage: ProStage) => (PRO_FLOW.indexOf(stage) >= 0 && PRO_FLOW.indexOf(stage) < PRO_FLOW.length - 1 ? PRO_FLOW[PRO_FLOW.indexOf(stage) + 1] : null);
/** Où en est une commande, en clair : l'étape pour un professionnel, le statut pour un particulier. */
const stateOf = (o: Order): { label: string; tone: Tone } =>
  o.type === 'pro' ? { label: proStageLabel(proStageOf(o)), tone: PRO_TONE[proStageOf(o)] } : { label: labelOf(o), tone: STATUS[o.status].tone };
/** Premier message à un professionnel : il a envoyé son intérêt, on ouvre la discussion. */
function introOf(o: Order) {
  const first = o.customer.name.trim().split(/\s+/)[0] ?? '';
  const wanted = o.lines.map((l) => `• ${l.name}${l.mode ? ` (${l.mode})` : ''} — ${qtyText(l)}`).join('\n');
  return `Bonjour${first ? ` ${first}` : ''},\n\nIci l’équipe TROPICAURA. Nous avons bien reçu votre demande ${o.number} :\n${wanted}\n\nQuand pouvons-nous en discuter ?`;
}

/**
 * Ce que le client lit dans son application pour chaque statut — libellés repris tels quels de
 * `orderView` (particuliers) et `requestView` (professionnels), lib/store.tsx de l'application.
 */
const CLIENT_LABEL: Record<Order['type'], Record<OrderStatus, string>> = {
  particulier: { attente: 'En validation', confirmee: 'Validée', preparation: 'En préparation', expediee: 'Expédiée', livree: 'Livrée', annulee: 'Annulée' },
  pro: { attente: 'En attente de réponse', confirmee: 'Confirmée', preparation: 'En préparation', expediee: 'Expédiée', livree: 'Livrée', annulee: 'Annulée' },
};
/** Ce que chaque statut veut dire pour l'équipe, de la commande à la réception. */
function meaningOf(o: Order, status: OrderStatus) {
  switch (status) {
    case 'attente':
      return 'Commande reçue : à vérifier, puis accuser réception.';
    case 'confirmee':
      return 'Accusé de réception fait : paiement reçu, commande confirmée.';
    case 'preparation':
      return 'Nous préparons la livraison.';
    case 'expediee':
      return zoneOf(o) === 'international' ? (doorOf(o) ? 'En livraison : avec le GP, jusqu’au domicile du client.' : 'En livraison : en transit vers l’aéroport d’arrivée.') : 'En livraison : le livreur à moto est en route vers le client.';
    case 'livree':
      return zoneOf(o) === 'international' && !doorOf(o) ? 'Réception confirmée : le client a récupéré sa commande à l’aéroport.' : 'Réception confirmée par le livreur : le client a reçu sa commande.';
    default:
      return 'Commande annulée : elle ne compte dans aucun montant.';
  }
}

/** Le geste suivant, dans les mots de l'équipe : préparer, mettre en livraison, confirmer la réception. */
const NEXT_ACTION: Partial<Record<OrderStatus, string>> = { preparation: 'Préparer la livraison', expediee: 'Mettre en livraison', livree: 'Confirmer la réception' };

/** Passage au statut en cours, s'il est daté dans l'historique. */
function currentStep(o: Order) {
  const steps = o.history ?? [];
  const last = steps[steps.length - 1];
  return last && last.status === o.status && (o.type !== 'pro' || proStageOf(last) === proStageOf(o)) ? last : null;
}
/** Le client reste à prévenir du statut en cours (la simple arrivée de la commande n'en demande pas). */
const needsNotice = (o: Order) => (o.type === 'pro' ? proStageOf(o) !== 'interet' : o.status !== 'attente') && !currentStep(o)?.notified_at;

/** Message au client pour le statut en cours, prêt à partir par WhatsApp ou par e-mail. */
function noticeOf(o: Order) {
  const notice = clientNotice({ reference: o.number, type: o.type, abroad: zoneOf(o) === 'international', airport: o.airport || undefined, door: doorOf(o), located: !!o.location }, o.status, o.type === 'pro' ? proStageOf(o) : null);
  const first = o.customer.name.trim().split(/\s+/)[0] ?? '';
  return { ...notice, full: `Bonjour${first ? ` ${first}` : ''},\n\n${notice.message}\n\n— TROPICAURA` };
}

function qtyText(l: OrderLine) {
  const n = String(Math.round(l.qty * 1000) / 1000).replace('.', ',');
  if (l.unit === 'kg') return l.qty < 1 ? `${Math.round(l.qty * 1000)}\u00A0g` : l.qty >= 1000 ? kgText(l.qty) : `${n}\u00A0kg`;
  if (l.unit === 'conteneur') return `${plural(l.qty, 'conteneur', 'conteneurs')}${l.kg ? ` (${kgText(l.kg)})` : ''}`;
  return `${n}\u00A0${l.noun ? (l.qty > 1 ? l.noun[1] : l.noun[0]) : l.qty > 1 ? 'unités' : 'unité'}`;
}

/** Message au GP, prêt à partir : il ne reste qu'à toucher « Envoyer » dans WhatsApp. */
function gpMessage(o: Order) {
  const air = o.lines.filter((l) => l.mode !== 'bateau');
  const sea = o.lines.length - air.length;
  return [
    `TROPICAURA — commande ${o.number}`,
    `Client : ${customerName(o)}`,
    o.customer.phone ? `Téléphone : ${o.customer.phone}` : false,
    `Destination : ${destinationOf(o) || 'à préciser'}`,
    o.airport ? `Aéroport d’arrivée : ${o.airport}` : false,
    '',
    'Colis :',
    ...air.map((l) => `• ${l.name} — ${qtyText(l)}`),
    sea > 0 ? `(+ ${plural(sea, 'ligne par bateau', 'lignes par bateau')}, hors transit aérien)` : false,
    '',
    doorOf(o)
      ? 'Livraison porte à porte : à remettre au client, à son domicile.'
      : 'Transit jusqu’à l’aéroport d’arrivée. Le client récupère sa commande à l’aéroport et se charge de la suite.',
  ]
    .filter((line) => line !== false)
    .join('\n');
}
const waLink = (number: string, text?: string) => `https://wa.me/${number.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/**
 * Ce que l'espace affiche et compte : les commandes réelles dès qu'il y en a une ; sinon les
 * commandes d'exemple, toujours annoncées comme telles. Les deux ne sont jamais additionnées.
 */
function useScope() {
  const { orders } = useOrders();
  return useMemo(() => {
    const real = orders.filter((o) => !o.is_example);
    return { list: real.length > 0 ? real : orders, exampleMode: real.length === 0 && orders.length > 0, hiddenExamples: real.length > 0 ? orders.length - real.length : 0 };
  }, [orders]);
}

function sums(list: Order[]) {
  const live = list.filter(counted);
  const ordered = live.reduce((s, o) => s + o.total, 0);
  const paid = live.filter((o) => o.paid_at).reduce((s, o) => s + o.total, 0);
  return { live, ordered, paid, due: ordered - paid };
}

// ───────────── Briques de la page « Livraison » : titres de groupe, listes groupées, lignes

function GroupTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-7 flex items-end justify-between gap-3 px-1.5">
      <h2 className="label-voice text-[12.5px] text-fg-faint">{children}</h2>
      {right}
    </div>
  );
}
function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('overflow-hidden rounded-[22px] border border-line bg-surface', className)}>{children}</div>;
}
function Foot({ children }: { children: ReactNode }) {
  return <p className="px-1.5 pt-2 text-[12.5px] leading-[18px] text-fg-faint">{children}</p>;
}
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[50px] items-center justify-between gap-4 border-b border-line px-4 py-2.5 last:border-b-0">
      <span className="shrink-0 text-[14px] text-fg-dim">{label}</span>
      <span className="min-w-0 break-words text-right text-[14.5px] font-semibold">{children}</span>
    </div>
  );
}
function Column({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[820px] px-5">{children}</div>;
}

// ───────────── Cadre de l'espace : un univers à part, avec ses propres pages

const TABS = [
  { to: '/commandes', label: 'Commandes', short: 'Commandes', end: true },
  { to: '/commandes/statuts', label: 'Statuts', short: 'Statuts', end: false },
  { to: '/commandes/clients', label: 'Clients', short: 'Clients', end: false },
  { to: '/commandes/statistiques', label: 'Statistiques', short: 'Stats', end: false },
  { to: '/commandes/livraison', label: 'Livraison', short: 'Livraison', end: false },
];

export function OrdersLayout() {
  const { user, canEdit } = useAuth();
  return (
    <OrdersProvider key={user?.id ?? 'visite'}>
      <motion.div className="relative min-h-dvh" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45 }}>
        <Backdrop tint="#C98A2B" />
        <header className="sticky top-0 z-30 border-b border-line bg-[rgba(11,14,9,0.86)] backdrop-blur-md" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-3 px-4 lg:h-[76px] lg:px-8">
            <Link to="/" aria-label="Retour à la tour de contrôle" className="press flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-[13.5px] font-bold">
              <span aria-hidden>←</span>
              <span className="hidden min-[430px]:inline">Contrôle</span>
            </Link>
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="poster-voice min-w-0 truncate text-[22px] leading-none tracking-[0.1em] lg:text-[28px]">Tropicaura</span>
              <span className="label-voice shrink-0 text-[12.5px] text-star lg:text-[13.5px]">Commandes</span>
            </span>
            <nav aria-label="Pages de l’espace commandes" className="hidden items-center gap-1 lg:flex">
              {TABS.map((tab) => (
                <NavLink key={tab.to} to={tab.to} end={tab.end} className="press relative flex h-11 items-center rounded-full px-4">
                  {({ isActive }) => (
                    <>
                      <span className={cx('text-[14.5px]', isActive ? 'font-bold text-fg' : 'font-semibold text-fg-dim')}>{tab.label}</span>
                      {isActive && <motion.span layoutId="trait-commandes" initial={false} className="absolute inset-x-[18px] bottom-[3px] h-0.5 bg-star" style={{ borderRadius: 2 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>
        </header>

        <main className="relative z-10 mx-auto w-full max-w-[720px] pb-[124px] lg:max-w-[1400px] lg:px-3 lg:pb-20">
          {!canEdit && (
            <div className="mx-5 mt-4 flex min-h-12 items-center gap-2.5 rounded-full border border-line bg-surface pl-4 pr-1 text-[13px] leading-[17px] text-fg-dim" role="note">
              <span className="min-w-0 flex-1">
                <strong className="font-bold text-fg">Mode visite</strong> · commandes d’exemple uniquement
              </span>
              <Link to="/connexion" className="press flex min-h-11 shrink-0 items-center rounded-full bg-leaf px-4 text-[13px] font-extrabold text-on-leaf">
                Se connecter
              </Link>
            </div>
          )}
          <Outlet />
        </main>

        <nav aria-label="Pages de l’espace commandes" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-2 lg:hidden" style={{ paddingBottom: 'calc(max(env(safe-area-inset-bottom), 14px))' }}>
          <span className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-bg via-bg/85 to-transparent" />
          <div className="no-scrollbar pointer-events-auto relative flex max-w-full items-center overflow-x-auto rounded-full border border-line-strong bg-bar p-1.5 max-[359px]:p-1">
            {TABS.map((tab) => (
              <NavLink key={tab.to} to={tab.to} end={tab.end} aria-label={tab.label} className="press press-deep block min-w-11 shrink-0 rounded-full">
                {({ isActive }) => (
                  <span className={cx('relative flex h-11 items-center justify-center rounded-full px-3.5 text-[13.5px] transition-colors duration-300 max-[429px]:px-[7px] max-[429px]:text-[12.5px] max-[359px]:px-1 max-[359px]:text-[11.5px]', isActive ? 'font-extrabold text-bg-deep' : 'font-bold text-fg-dim')}>
                    {isActive && <motion.span layoutId="onglet-commandes" initial={false} className="absolute inset-0 bg-star" style={{ borderRadius: 9999 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <span className="relative min-[400px]:hidden">{tab.short}</span>
                    <span className="relative hidden min-[400px]:inline">{tab.label}</span>
                  </span>
                )}
              </NavLink>
            ))}
          </div>
        </nav>
        <ScrollRestoration />
      </motion.div>
    </OrdersProvider>
  );
}

// ───────────── Éléments partagés

function Kpi({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: 'leaf' | 'star' }) {
  return (
    <div className="card min-w-0 p-4">
      <span className="label-voice block truncate text-[12px] text-fg-faint">{label}</span>
      <span className={cx('poster-voice tabular mt-1.5 block truncate text-[30px] leading-[32px]', tone === 'leaf' && 'text-leaf', tone === 'star' && 'text-star')}>{value}</span>
      {detail && <span className="mt-1.5 block text-[12.5px] leading-[17px] text-fg-dim">{detail}</span>}
    </div>
  );
}

function StatusChips({ order: o, bare }: { order: Order; bare?: boolean }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {!bare && <Chip tone={stateOf(o).tone}>{stateOf(o).label}</Chip>}
      {o.paid_at ? <Chip tone="leaf">Encaissée</Chip> : o.type !== 'pro' && counted(o) && o.total > 0 ? <Chip>À encaisser</Chip> : null}
      {o.unpriced > 0 && <Chip tone="star">Prix à confirmer</Chip>}
      {needsNotice(o) && <Chip tone="star">Client à prévenir</Chip>}
      {o.is_example && <Chip>Exemple</Chip>}
    </span>
  );
}

function OrderCard({ order: o, onOpen }: { order: Order; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="press card block w-full p-4 text-left" aria-label={`Ouvrir la commande ${o.number} de ${customerName(o)}`}>
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="label-voice block truncate text-[12px] text-fg-faint">
            {o.type === 'pro' ? 'Demande pro' : 'Commande'} · {o.number}
          </span>
          <span className="mt-0.5 block truncate text-[16px] font-bold leading-[21px]">{customerName(o)}</span>
          <span className="block truncate text-[12.5px] text-fg-faint">
            {placeOf(o)} · {ago(o.created_at)}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={cx('tabular block font-extrabold', o.total > 0 ? 'text-[16.5px]' : 'text-[13px] text-star')}>{amountText(o)}</span>
          <span className="block text-[11.5px] text-fg-faint">{plural(o.lines.length, 'article', 'articles')}</span>
        </span>
      </span>
      <span className="mt-2.5 block">
        <StatusChips order={o} />
      </span>
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-[13px] text-fg-dim">{label}</dt>
      <dd className="min-w-0 break-words text-right text-[14px] font-semibold">{children}</dd>
    </div>
  );
}

const contactLink = 'press inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-[13.5px] font-bold';

function Contact({ order: o }: { order: Order }) {
  const c = o.customer;
  return (
    <>
      <dl className="divide-y divide-line">
        {c.company && <Row label="Société">{c.company}</Row>}
        {c.name && <Row label={o.type === 'pro' ? 'Contact' : 'Nom'}>{c.name}</Row>}
        {c.activity && <Row label="Activité">{ACTIVITY[c.activity] ?? c.activity}</Row>}
        <Row label={o.type === 'pro' ? 'Destination' : 'Adresse'}>{destinationOf(o) || 'Non renseignée'}</Row>
        {c.email && <Row label="E-mail">{c.email}</Row>}
        {c.phone && <Row label="Téléphone">{c.phone}</Row>}
        {c.whatsapp && <Row label="WhatsApp">{c.whatsapp}</Row>}
      </dl>
      {(c.email || c.phone || c.whatsapp) && (
        <div className="mt-2 flex flex-wrap gap-2.5">
          {/^(\+|00)/.test((c.whatsapp || c.phone).trim()) && (
            <a href={waLink(c.whatsapp || c.phone, o.type === 'pro' && proStageOf(o) === 'interet' ? introOf(o) : undefined)} target="_blank" rel="noreferrer noopener" className={cx(contactLink, 'border-leaf/50 text-leaf')}>
              WhatsApp
            </a>
          )}
          {c.phone && (
            <a href={`tel:${c.phone.replace(/[^+\d]/g, '')}`} className={contactLink}>
              Appeler
            </a>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} className={contactLink}>
              Écrire
            </a>
          )}
        </div>
      )}
    </>
  );
}

/** Fiche d'une commande : le client, la livraison, ce qu'il a commandé, l'argent, et le suivi. */
function OrderSheet({ order: o, onClose }: { order: Order | null; onClose: () => void }) {
  const { update, remove, logistics } = useOrders();
  const { canEdit, isOwner } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [sure, setSure] = useState<'cancel' | 'delete' | null>(null);
  const [airport, setAirport] = useState('');

  const id = o?.id;
  const savedAirport = o?.airport ?? '';
  useEffect(() => {
    setAirport(savedAirport);
    setPaying(false);
    setSure(null);
  }, [id, savedAirport]);

  const run = async (key: string, patch: OrderPatch, done: string) => {
    if (!o) return;
    setBusy(key);
    try {
      await update(o.id, patch);
      toast(done);
      setSure(null);
      setPaying(false);
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const zone = o ? zoneOf(o) : 'inconnue';
  const door = !!o && doorOf(o);
  // Le téléphone du livreur n'est pas rangé dans la commande : il vient de la liste « Livraison ».
  const courierPhone = (o?.courier && logistics?.couriers.find((c) => c.id === o.courier?.id)?.phone) || '';
  const courierWa = courierPhone ? courierWhatsApp(courierPhone) : null;
  // Les moyens les plus probables d'abord, selon le pays du client.
  const methods = zone === 'senegal' ? METHODS : [METHODS[2], METHODS[3], METHODS[1], METHODS[0]];
  // Pas de crédit : rien n'avance tant que le paiement n'est pas reçu.
  const next = o && FLOW.indexOf(o.status) >= 1 && FLOW.indexOf(o.status) < FLOW.length - 1 ? FLOW[FLOW.indexOf(o.status) + 1] : null;

  return (
    <Sheet open={!!o} onClose={() => (busy ? undefined : (setSure(null), onClose()))} title={o ? `${o.type === 'pro' ? 'Demande' : 'Commande'} ${o.number}` : ''}>
      {o && (
        <>
          <p className="text-[13px] text-fg-dim">Passée le {dateTime(o.created_at)}</p>
          <div className="mt-2.5">
            <StatusChips order={o} />
          </div>
          {o.is_example && (
            <div className="mt-3">
              <Notice tone="star">Commande d’exemple : ce client, cette adresse et ces montants sont fictifs.</Notice>
            </div>
          )}

          {o.type === 'pro' && (
            <div className="mt-3">
              <Notice tone="leaf" title="Demande professionnelle · rien n’est payé dans l’application">
                Le client a envoyé son intérêt. Contactez-le pour convenir des quantités, du prix, du transport et du paiement, puis faites avancer la demande jusqu’au contrat et à la livraison.
              </Notice>
            </div>
          )}

          <h3 className="mt-5 font-display text-[18px] font-semibold">Client</h3>
          <Contact order={o} />

          <h3 className="mt-5 font-display text-[18px] font-semibold">Livraison</h3>
          <dl className="divide-y divide-line">
            {zone === 'international' ? (
              <div className="flex min-h-[52px] items-center justify-between gap-4 py-1.5">
                <dt className="shrink-0 text-[13px] text-fg-dim">Mode</dt>
                <dd className="min-w-0 text-right text-[14px] font-semibold">
                  {canEdit ? (
                    <select
                      aria-label="Jusqu’où le GP livre cette commande"
                      value={door ? 'domicile' : 'aeroport'}
                      disabled={!!busy}
                      onChange={(e) => run('delivery', { delivery: e.target.value as 'aeroport' | 'domicile' }, e.target.value === 'domicile' ? 'Livraison jusqu’au domicile' : 'Livraison jusqu’à l’aéroport d’arrivée')}
                      className="h-11 max-w-[230px] rounded-full border border-line-strong bg-white/[0.06] px-3.5 text-[14.5px] font-bold text-fg outline-none focus:border-leaf"
                    >
                      <option value="aeroport">GP · jusqu’à l’aéroport</option>
                      <option value="domicile">GP · porte à porte</option>
                    </select>
                  ) : door ? (
                    'GP · porte à porte'
                  ) : (
                    'GP · jusqu’à l’aéroport d’arrivée'
                  )}
                </dd>
              </div>
            ) : (
              <Row label="Mode">{zone === 'senegal' ? 'À domicile, par nos livreurs à moto' : 'Destination à préciser'}</Row>
            )}
            {zone !== 'international' && o.type !== 'pro' && (
              <div className="flex min-h-[58px] items-center justify-between gap-3 py-2" data-bloc="position">
                <dt className="min-w-0">
                  <span className="block text-[14px] font-bold">Position du client</span>
                  <span className="tabular block text-[12.5px] leading-[17px] text-fg-faint">
                    {o.location ? `${spotText(o.location)} · relevée ${ago(o.location.at)}` : 'Non partagée : le livreur se fie à l’adresse et appelle le client.'}
                  </span>
                </dt>
                {o.location && (
                  <dd className="shrink-0">
                    <a href={routeLink(o.location)} target="_blank" rel="noreferrer noopener" className={contactLink}>
                      Itinéraire
                    </a>
                  </dd>
                )}
              </div>
            )}
            <div className="flex min-h-[52px] items-center justify-between gap-4 py-1.5">
              <dt className="shrink-0 text-[13px] text-fg-dim">Livreur</dt>
              <dd className="min-w-0 text-right text-[14px] font-semibold">
                {canEdit && logistics ? (
                  <select
                    aria-label="Livreur chargé de la commande"
                    value={o.courier?.id ?? ''}
                    disabled={!!busy}
                    onChange={(e) => {
                      const chosen = logistics.couriers.find((c) => c.id === e.target.value);
                      run('courier', { courier_id: e.target.value || null }, chosen ? `Commande attribuée à ${chosen.name}` : 'Livreur retiré');
                    }}
                    className="h-11 max-w-[200px] rounded-full border border-line-strong bg-white/[0.06] px-3.5 text-[14.5px] font-bold text-fg outline-none focus:border-leaf"
                  >
                    <option value="">Non attribué</option>
                    {o.courier && !logistics.couriers.some((c) => c.id === o.courier?.id) && <option value={o.courier.id}>{o.courier.name}</option>}
                    {logistics.couriers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  (o.courier?.name ?? 'Non attribué')
                )}
              </dd>
            </div>
            {zone !== 'international' && o.courier && (
              <div className="flex min-h-[58px] flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2" data-bloc="course">
                <dt className="min-w-0">
                  <span className="block text-[14px] font-bold">Course · {o.courier.name}</span>
                  <span className="block text-[12.5px] leading-[17px] text-fg-faint">
                    {courierPhone ? 'Le message contient l’adresse, la position et le numéro du client.' : 'Ce livreur n’a pas de numéro enregistré.'}
                  </span>
                </dt>
                <dd className="flex shrink-0 flex-wrap justify-end gap-2">
                  {canEdit && courierWa ? (
                    <a href={waLink(courierWa, courierMessage(o))} target="_blank" rel="noreferrer noopener" className="press flex min-h-11 items-center rounded-full bg-leaf px-4 text-[13.5px] font-extrabold text-on-leaf">
                      Envoyer la course
                    </a>
                  ) : canEdit && !courierPhone ? (
                    <Link to="/commandes/livraison" className={contactLink}>
                      Ajouter son numéro
                    </Link>
                  ) : null}
                  {courierPhone && (
                    <a href={`tel:${courierPhone.replace(/[^+\d]/g, '')}`} className={contactLink}>
                      Appeler
                    </a>
                  )}
                </dd>
              </div>
            )}
            {zone === 'international' && !door && (
              <div className="flex min-h-[52px] items-center justify-between gap-4 py-1.5">
                <dt className="shrink-0 text-[13px] text-fg-dim">Aéroport d’arrivée</dt>
                <dd className="min-w-0 flex-1 text-right text-[14px] font-semibold">
                  {canEdit ? (
                    <input
                      aria-label="Aéroport d’arrivée"
                      value={airport}
                      maxLength={80}
                      placeholder="À renseigner"
                      onChange={(e) => setAirport(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      onBlur={() => airport.trim() !== savedAirport && run('airport', { airport }, airport.trim() ? 'Aéroport d’arrivée enregistré' : 'Aéroport effacé')}
                      className="h-11 w-full min-w-0 bg-transparent text-right text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-fg-faint"
                    />
                  ) : (
                    o.airport || 'À renseigner'
                  )}
                </dd>
              </div>
            )}
            {zone !== 'senegal' && (
              <div className="flex min-h-[58px] items-center justify-between gap-3 py-2">
                <dt className="min-w-0">
                  <span className="block text-[14px] font-bold">GP{logistics?.gp.name ? ` · ${logistics.gp.name}` : ''}</span>
                  <span className="block text-[12.5px] text-fg-faint">{o.gp_at ? `Message ouvert le ${dateTime(o.gp_at)}` : 'Pas encore prévenu'}</span>
                </dt>
                <dd className="shrink-0">
                  {canEdit && logistics?.gp.whatsapp ? (
                    <a
                      href={waLink(logistics.gp.whatsapp, gpMessage(o))}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={() => {
                        update(o.id, { gp_notified: true }).catch(() => {});
                      }}
                      className="press flex min-h-11 items-center rounded-full bg-leaf px-4 text-[13.5px] font-extrabold text-on-leaf"
                    >
                      {o.gp_at ? 'Renvoyer' : 'Envoyer sur WhatsApp'}
                    </a>
                  ) : canEdit ? (
                    <Link to="/commandes/livraison" className={contactLink}>
                      Ajouter son numéro
                    </Link>
                  ) : null}
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-1 text-[12.5px] leading-[18px] text-fg-faint">
            {zone === 'international'
              ? door
                ? 'Porte à porte : le GP remet la commande au client, à son domicile.'
                : 'Nous assurons le transit jusqu’à l’aéroport d’arrivée. Sur place, le client récupère sa commande et se charge de la suite.'
              : 'Livraison jusqu’au domicile. L’équipe choisit le livreur, lui envoie la course, et il peut appeler le client. La position se met à jour tant que l’application du client est ouverte.'}
          </p>

          <h3 className="mt-5 font-display text-[18px] font-semibold">Contenu</h3>
          <ul className="divide-y divide-line">
            {o.lines.map((l, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-bold">
                    {l.name}
                    {l.mode ? ` · ${l.mode}` : ''}
                  </span>
                  <span className="block text-[12.5px] text-fg-faint">
                    {qtyText(l)}
                    {l.unit_price !== null ? ` × ${amount(l.unit_price, o.currency)}` : ''}
                  </span>
                </span>
                <span className={cx('tabular shrink-0 text-[14.5px] font-extrabold', l.total === null && 'text-[12.5px] text-star')}>{l.total === null ? 'Prix à confirmer' : amount(l.total, o.currency)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-1 border-t border-line-strong pt-1">
            {o.incoterm && <Row label="Incoterm">{o.incoterm}</Row>}
            {o.transport_cost > 0 && <Row label="Transport">{amount(o.transport_cost, o.currency)}</Row>}
            <Row label={o.unpriced > 0 ? 'Total des lignes chiffrées' : 'Total'}>
              <span className="tabular text-[17px] font-extrabold">{o.total > 0 ? amount(o.total, o.currency) : 'À confirmer'}</span>
            </Row>
            {o.payment && <Row label="Paiement choisi">{PAYMENT[o.payment] ?? o.payment}</Row>}
            <Row label="Encaissement">{o.paid_at ? `${o.paid_via ? `${PAYMENT[o.paid_via]} · ` : ''}pointé le ${dateTime(o.paid_at)}` : 'Non pointé'}</Row>
          </dl>
          {o.unpriced > 0 && (
            <p className="mt-1 text-[12.5px] leading-[18px] text-star">{plural(o.unpriced, 'ligne sans prix n’entre', 'lignes sans prix n’entrent')} pas dans ce total.</p>
          )}
          {o.note && (
            <p className="mt-3 rounded-2xl bg-black/25 px-3.5 py-3 text-[13.5px] leading-5 text-fg-dim">
              <strong className="text-fg">Précisions du client : </strong>
              {o.note}
            </p>
          )}
          <p className="mt-3 text-[12.5px] leading-[18px] text-fg-faint">
            {o.type === 'pro' ? 'Professionnels : le paiement se règle par contrat, hors de l’application ; il peut être pointé ici pour mémoire. ' : 'Pas de crédit : le paiement reçu confirme la commande. '}
            Aucun prestataire de paiement n’est relié à l’application : l’encaissement se pointe ici, à la main, quand l’argent est
            réellement reçu.
          </p>

          <h3 className="mt-5 font-display text-[18px] font-semibold">Statut</h3>
          <p className="text-[12.5px] leading-[18px] text-fg-faint">
            {o.type === 'pro' ? 'Le parcours d’une demande professionnelle, du premier contact à la livraison.' : 'Les six statuts de l’application d’achat, de la commande à la réception.'}
            {canEdit ? ' Touchez une ligne pour l’appliquer.' : ''}
          </p>
          <ul className="mt-2 divide-y divide-line" aria-label="Statut de la commande">
            {(o.type === 'pro'
              ? PRO_STAGES.map((st) => {
                  const entry = (o.history ?? []).filter((h) => proStageOf(h) === st.id).pop();
                  return { id: st.id as string, label: st.label, meaning: PRO_MEANING[st.id], client: CLIENT_LABEL.pro[st.status], on: proStageOf(o) === st.id, blocked: false, patch: { stage: st.id } as OrderPatch, entry, cancel: st.id === 'annulee' };
                })
              : ALL_STATUS.map((id) => {
                  const entry = (o.history ?? []).filter((h) => h.status === id).pop();
                  // Pas de crédit : sans paiement reçu, la commande reste en attente (ou s'annule).
                  const blocked = id === 'attente' ? !!o.paid_at : id !== 'annulee' && !o.paid_at;
                  return { id: id as string, label: STATUS[id].label, meaning: meaningOf(o, id), client: CLIENT_LABEL.particulier[id], on: o.status === id, blocked, patch: { status: id } as OrderPatch, entry, cancel: id === 'annulee' };
                })
            ).map((row) => {
              const reached = row.entry?.at ?? (row.on ? o.status_at : null);
              const confirming = row.cancel && sure === 'cancel' && !row.on;
              const body = (
                <>
                  <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-[12px] font-extrabold leading-none', row.on ? (row.cancel ? 'border-danger bg-danger text-bg-deep' : 'border-leaf bg-leaf text-on-leaf') : reached ? 'border-leaf text-leaf' : 'border-line-strong text-transparent')}>
                    ✓
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-[14.5px] leading-5', row.on ? 'font-extrabold' : 'font-bold', confirming && 'text-danger')}>{confirming ? (o.type === 'pro' ? 'Toucher encore pour classer sans suite' : 'Toucher encore pour annuler la commande') : row.label}</span>
                    <span className="block text-[12.5px] leading-[17px] text-fg-dim">{row.meaning}</span>
                    <span className="block text-[12px] leading-[17px] text-fg-faint">
                      Le client voit « {row.client} »{reached ? ` · ${dateTime(reached)}` : ''}
                      {row.entry?.notified_at ? ' · client prévenu' : ''}
                    </span>
                  </span>
                  {row.on && <Chip tone={row.cancel ? 'danger' : 'leaf'}>Actuel</Chip>}
                </>
              );
              return (
                <li key={row.id}>
                  {canEdit && !row.on ? (
                    <button
                      type="button"
                      disabled={busy !== null || row.blocked}
                      aria-label={`Appliquer le statut ${row.label}`}
                      onClick={() => (row.cancel && sure !== 'cancel' ? setSure('cancel') : run('status', row.patch, `${o.type === 'pro' ? 'Demande' : 'Commande'} ${o.number} : ${row.label.toLowerCase()}`))}
                      className="row-tap flex min-h-[60px] w-full items-center gap-3 rounded-xl py-2 text-left disabled:opacity-40"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex min-h-[60px] items-center gap-3 py-2" aria-current={row.on ? 'step' : undefined}>
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {canEdit && o.type !== 'pro' && !o.paid_at && o.status !== 'annulee' && (
            <p className="mt-1 text-[12.5px] leading-[18px] text-star">Pas de crédit : accusez d’abord réception, plus bas, en pointant le paiement reçu. La commande est alors confirmée et la suite se débloque.</p>
          )}
          {/* Notification au client : un message par statut, déjà écrit. */}
          {(() => {
            const notice = noticeOf(o);
            const step = currentStep(o);
            const number = (o.customer.whatsapp || o.customer.phone).trim();
            const international = /^(\+|00)/.test(number);
            return (
              <div className="mt-3 rounded-2xl bg-black/25 p-3.5" aria-label="Notification au client">
                <p className="text-[14.5px] font-bold leading-5">Prévenir le client · {notice.title}</p>
                <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-5 text-fg-dim">{notice.full}</p>
                <p className={cx('mt-2 text-[12.5px] font-semibold leading-[18px]', step?.notified_at ? 'text-leaf' : needsNotice(o) ? 'text-star' : 'text-fg-faint')}>
                  {step?.notified_at
                    ? `Message ouvert le ${dateTime(step.notified_at)}, par ${step.notified_via === 'email' ? 'e-mail' : 'WhatsApp'}.`
                    : needsNotice(o)
                      ? 'Le client n’est pas encore prévenu de ce statut.'
                      : 'Facultatif à ce stade : le client est prévenu à la confirmation.'}
                </p>
                {canEdit && (
                  <div className="mt-2.5 flex flex-wrap gap-2.5">
                    {number && international && (
                      <a
                        href={waLink(number, notice.full)}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={() => {
                          update(o.id, { notified_via: 'whatsapp' }).catch(() => {});
                        }}
                        className="press flex min-h-11 items-center rounded-full bg-leaf px-4 text-[13.5px] font-extrabold text-on-leaf"
                      >
                        {step?.notified_at ? 'Renvoyer sur WhatsApp' : 'Prévenir sur WhatsApp'}
                      </a>
                    )}
                    {o.customer.email && (
                      <a
                        href={`mailto:${o.customer.email}?subject=${encodeURIComponent(`${notice.title} · ${o.number}`)}&body=${encodeURIComponent(notice.full)}`}
                        onClick={() => {
                          update(o.id, { notified_via: 'email' }).catch(() => {});
                        }}
                        className={contactLink}
                      >
                        Prévenir par e-mail
                      </a>
                    )}
                  </div>
                )}
                {canEdit && number && !international && <p className="mt-2 text-[12.5px] leading-[18px] text-star">Le numéro du client n’a pas d’indicatif de pays : WhatsApp ne peut pas s’ouvrir dessus.</p>}
                {canEdit && !number && !o.customer.email && <p className="mt-2 text-[12.5px] leading-[18px] text-star">Ni numéro ni e-mail pour ce client : prévenez-le par un autre moyen.</p>}
              </div>
            );
          })()}
          <p className="mt-2 text-[12.5px] leading-[18px] text-fg-faint">
            Le message ne part pas tout seul : aucun service d’envoi (WhatsApp professionnel, SMS, e-mail) n’est relié, et l’application d’achat ne lit pas encore le suivi. Le bouton ouvre
            le message déjà écrit ; il reste à l’envoyer.
          </p>

          {canEdit ? (
            <>
              <h3 className="mt-5 font-display text-[18px] font-semibold">Suivi</h3>
              <div className="mt-2.5 flex flex-col gap-2.5">
                {o.type === 'pro' ? (
                  <>
                    {(() => {
                      const stage = proStageOf(o);
                      const nextStage = proNext(stage);
                      return (
                        <>
                          {nextStage && (
                            <PrimaryButton
                              label={PRO_ACTION[nextStage] ?? proStageLabel(nextStage)}
                              loading={busy === 'next'}
                              disabled={busy !== null}
                              onClick={() => run('next', { stage: nextStage }, `Demande ${o.number} : ${proStageLabel(nextStage).toLowerCase()}`)}
                            />
                          )}
                          {paying ? (
                            <div>
                              <p className="mb-2.5 px-1 text-[13.5px] font-semibold text-fg-dim">Paiement de {amount(o.total, o.currency)} reçu par…</p>
                              <div className="grid grid-cols-2 gap-2.5">
                                {methods.map((m) => (
                                  <button key={m.id} type="button" disabled={busy !== null} onClick={() => run('paid', { paid: true, via: m.id }, `Paiement reçu par ${m.label}`)} className="press min-h-[54px] rounded-[18px] border border-line-strong bg-white/[0.06] px-3 text-[14.5px] font-bold disabled:opacity-50">
                                    {m.label}
                                  </button>
                                ))}
                              </div>
                              <GhostButton className="mt-2.5 w-full" label="Retour" disabled={busy !== null} onClick={() => setPaying(false)} />
                            </div>
                          ) : o.paid_at ? (
                            <GhostButton label="Retirer l’encaissement" loading={busy === 'unpaid'} disabled={busy !== null} onClick={() => run('unpaid', { paid: false }, 'Encaissement retiré')} />
                          ) : o.total > 0 && stage !== 'annulee' ? (
                            <GhostButton label="Pointer un paiement reçu" disabled={busy !== null} onClick={() => setPaying(true)} />
                          ) : null}
                          {stage === 'annulee' ? (
                            <GhostButton label="Rouvrir la demande" loading={busy === 'back'} disabled={busy !== null} onClick={() => run('back', { status: 'attente' }, 'Demande rouverte')} />
                          ) : stage !== 'livree' ? (
                            <GhostButton
                              label={sure === 'cancel' ? 'Confirmer : sans suite' : 'Classer sans suite'}
                              tone="danger"
                              loading={busy === 'cancel'}
                              disabled={busy !== null}
                              onClick={() => (sure === 'cancel' ? run('cancel', { stage: 'annulee' }, `Demande ${o.number} classée sans suite`) : setSure('cancel'))}
                            />
                          ) : null}
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <>
                {o.status === 'attente' && !(o.total > 0) && (
                  <p className="rounded-2xl bg-star-wash px-4 py-3 text-[13.5px] font-semibold leading-5 text-star">Le prix de cette commande reste à confirmer : aucun paiement ne peut encore être reçu.</p>
                )}
                {o.status === 'attente' && o.total > 0 && !paying && <PrimaryButton label="Accuser réception" trailing={amount(o.total, o.currency)} disabled={busy !== null} onClick={() => setPaying(true)} />}
                {o.status === 'attente' && o.total > 0 && paying && (
                  <div>
                    <p className="mb-2.5 px-1 text-[13.5px] font-semibold text-fg-dim">
                      Accusé de réception : paiement de {amount(o.total, o.currency)} vérifié, reçu par…
                      {o.unpriced > 0 && <span className="block font-medium text-star">{plural(o.unpriced, 'ligne sans prix n’est pas comprise', 'lignes sans prix ne sont pas comprises')} dans ce montant.</span>}
                    </p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {methods.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          disabled={busy !== null}
                          onClick={() => run('paid', { paid: true, via: m.id }, `Paiement reçu par ${m.label} : commande confirmée`)}
                          className="press min-h-[54px] rounded-[18px] border border-line-strong bg-white/[0.06] px-3 text-[14.5px] font-bold disabled:opacity-50"
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <GhostButton className="mt-2.5 w-full" label="Retour" disabled={busy !== null} onClick={() => setPaying(false)} />
                  </div>
                )}
                {next && (
                  <PrimaryButton
                    label={NEXT_ACTION[next] ?? `Passer à « ${labelOf(o, next)} »`}
                    loading={busy === 'next'}
                    disabled={busy !== null}
                    onClick={() => run('next', { status: next }, `Commande ${o.number} : ${labelOf(o, next).toLowerCase()}`)}
                  />
                )}
                {o.paid_at && o.status === 'confirmee' && (
                  <GhostButton label="Retirer l’encaissement" loading={busy === 'unpaid'} disabled={busy !== null} onClick={() => run('unpaid', { paid: false }, 'Encaissement retiré : commande remise en attente')} />
                )}
                {o.status === 'annulee' ? (
                  <GhostButton label="Rétablir la commande" loading={busy === 'back'} disabled={busy !== null} onClick={() => run('back', { status: 'attente' }, 'Commande rétablie')} />
                ) : o.status !== 'livree' ? (
                  <GhostButton
                    label={sure === 'cancel' ? 'Confirmer l’annulation' : 'Annuler la commande'}
                    tone="danger"
                    loading={busy === 'cancel'}
                    disabled={busy !== null}
                    onClick={() => (sure === 'cancel' ? run('cancel', { status: 'annulee' }, `Commande ${o.number} annulée`) : setSure('cancel'))}
                  />
                ) : null}
                  </>
                )}
                {isOwner && (
                  <GhostButton
                    label={sure === 'delete' ? 'Confirmer : effacer définitivement' : 'Supprimer la commande'}
                    tone="danger"
                    compact
                    loading={busy === 'delete'}
                    disabled={busy !== null}
                    onClick={async () => {
                      if (sure !== 'delete') return setSure('delete');
                      setBusy('delete');
                      try {
                        await remove(o.id);
                        toast('Commande supprimée, avec les informations du client');
                        onClose();
                      } catch (err) {
                        toast(messageOf(err), { tone: 'error' });
                      } finally {
                        setBusy(null);
                      }
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <p className="mt-4 text-[13px] leading-[19px] text-fg-dim">Mode visite : le suivi et l’encaissement se modifient une fois connecté.</p>
          )}
        </>
      )}
    </Sheet>
  );
}

/** Ce qui est affiché quand l'espace ne contient rien, ou seulement des exemples. */
function Provenance() {
  const { orders, scope, seedExamples, clearExamples } = useOrders();
  const { exampleMode, hiddenExamples } = useScope();
  const { isOwner, canEdit } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (orders.length === 0) {
    return (
      <div className="pb-4">
        <EmptyState
          tint="#C98A2B"
          title="Aucune commande reçue"
          body={
            scope === 'examples' && !canEdit
              ? 'En mode visite, seules des commandes d’exemple peuvent s’afficher, et il n’y en a pas. Connectez-vous pour voir les commandes reçues.'
              : 'Aucune commande pour l’instant. Les commandes passées dans l’application reliée à cette tour arrivent ici ; l’application relit leur statut toutes les minutes.'
          }
          cta={isOwner ? 'Afficher des commandes d’exemple' : undefined}
          onPress={isOwner && !busy ? () => run(seedExamples, 'Commandes d’exemple ajoutées') : undefined}
        />
      </div>
    );
  }
  if (exampleMode) {
    return (
      <div className="mx-5 mt-1">
        <Notice
          tone="star"
          title="Données d’exemple"
          action={isOwner ? <GhostButton compact label="Retirer les exemples" loading={busy} onClick={() => run(clearExamples, 'Commandes d’exemple retirées')} /> : undefined}
        >
          Ces {orders.length} commandes sont fictives : elles montrent l’espace tel qu’il sera. Aucune commande réelle n’a encore été reçue, car l’application d’achat n’est
          pas reliée. Les clients, adresses et montants affichés ne sont pas réels.
        </Notice>
      </div>
    );
  }
  if (hiddenExamples > 0 && isOwner) {
    return (
      <div className="mx-5 mt-1">
        <Notice action={<GhostButton compact label="Retirer les exemples" loading={busy} onClick={() => run(clearExamples, 'Commandes d’exemple retirées')} />}>
          {plural(hiddenExamples, 'commande d’exemple est encore enregistrée', 'commandes d’exemple sont encore enregistrées')} : elles ne sont ni affichées ni comptées.
        </Notice>
      </div>
    );
  }
  return null;
}

function Frame({ title, accent, subtitle, right, children }: { title: string; accent?: string; subtitle?: ReactNode; right?: ReactNode; children: ReactNode }) {
  const { loading, error, reload, orders } = useOrders();
  return (
    <Page>
      <PageHeader title={title} accent={accent} subtitle={subtitle} right={right} />
      {error && orders.length === 0 ? (
        <ErrorPanel message={error} onRetry={reload} />
      ) : loading ? (
        <SkeletonRows rows={5} />
      ) : (
        <>
          <Provenance />
          {orders.length > 0 && children}
        </>
      )}
    </Page>
  );
}

function Refresh() {
  const { reload, refreshing } = useOrders();
  return <GhostButton compact label="Actualiser" loading={refreshing} onClick={reload} className="shrink-0" />;
}

// ───────────── Page « Commandes »

export function OrdersList() {
  const { loadedAt } = useOrders();
  const { list } = useScope();
  const [status, setStatus] = useState<OrderStatus | 'toutes'>('toutes');
  const [type, setType] = useState<'tous' | 'particulier' | 'pro'>('tous');
  const [country, setCountry] = useState('');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  // Pays présents dans les commandes, du plus commandé au moins commandé.
  const countries = useMemo(() => {
    const seen = new Map<string, number>();
    list.forEach((o) => seen.set(countryOf(o), (seen.get(countryOf(o)) ?? 0) + 1));
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
  }, [list]);

  const s = sums(list);
  const waiting = list.filter((o) => o.status === 'attente').length;
  const running = list.filter((o) => ['confirmee', 'preparation', 'expediee'].includes(o.status)).length;

  const here = country && countries.some(([name]) => name === country) ? list.filter((o) => countryOf(o) === country) : list;
  const typed = type === 'tous' ? here : here.filter((o) => o.type === type);
  const needle = normalize(query);
  const searched = needle
    ? typed.filter((o) => normalize(`${o.number} ${o.customer.name} ${o.customer.company} ${o.customer.email} ${o.address} ${o.country} ${o.lines.map((l) => l.name).join(' ')}`).includes(needle))
    : typed;
  const shown = status === 'toutes' ? searched : searched.filter((o) => o.status === status);
  const opened = list.find((o) => o.id === openId) ?? null;
  const time = loadedAt ? new Date(loadedAt) : null;

  return (
    <Frame
      title="Commandes"
      subtitle={time ? `Relues toutes les 30 secondes · dernière lecture à ${String(time.getHours()).padStart(2, '0')}h${String(time.getMinutes()).padStart(2, '0')}` : 'Lecture des commandes…'}
      right={<Refresh />}
    >
      <div className="mx-5 mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="À traiter" value={count(waiting)} tone={waiting > 0 ? 'star' : undefined} detail="Paiement attendu, ou professionnel à contacter." />
        <Kpi label="En cours" value={count(running)} detail="Confirmées, en préparation ou expédiées." />
        <Kpi label="Montant commandé" value={money(s.ordered)} detail="Hors commandes annulées." />
        <Kpi label="Encaissé" value={money(s.paid)} tone="leaf" detail={s.due > 0 ? `Reste ${money(s.due)} à encaisser.` : 'Rien à encaisser.'} />
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
            { value: 'pro', label: 'Professionnels' },
          ]}
        />
        <div className="mt-3.5 flex flex-col gap-3 sm:flex-row">
          <label className="flex h-12 min-w-0 shrink-0 items-center sm:flex-1 gap-2 rounded-full border border-line bg-surface px-4 transition-colors focus-within:border-leaf">
            <span className="sr-only">Rechercher une commande</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Client, numéro, produit, ville…"
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
            <option value="">Tous les pays ({list.length})</option>
            {countries.map(([name, n]) => (
              <option key={name} value={name}>
                {name} ({n})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto px-5 pb-1" role="group" aria-label="Filtrer par statut">
        <FilterChip active={status === 'toutes'} onClick={() => setStatus('toutes')} count={searched.length}>
          Toutes
        </FilterChip>
        {ALL_STATUS.filter((id) => id === status || searched.some((o) => o.status === id)).map((id) => (
          <FilterChip key={id} active={status === id} onClick={() => setStatus(id)} count={searched.filter((o) => o.status === id).length}>
            {STATUS[id].many}
          </FilterChip>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="px-6 pt-8 text-center text-[14.5px] leading-[22px] text-fg-dim">Aucune commande ne correspond à cette sélection.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 px-5 lg:grid-cols-2 xl:grid-cols-3">
          {shown.map((o, i) => (
            <motion.li key={o.id} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 260, damping: 26, delay: i < 9 ? i * 0.03 : 0 }}>
              <OrderCard order={o} onOpen={() => setOpenId(o.id)} />
            </motion.li>
          ))}
        </ul>
      )}
      <OrderSheet order={opened} onClose={() => setOpenId(null)} />
    </Frame>
  );
}

// ───────────── Page « Statuts » : les commandes en cours, jusqu'à la réception

/** Colonnes « en cours ». Une commande reçue, livrée, annulée ou sans suite quitte la page. */
type Lane = { key: string; label: string; todo: string; tone: Tone };
const LANES: Record<Order['type'], Lane[]> = {
  particulier: [
    { key: 'attente', label: 'En attente', todo: 'À vérifier, puis accuser réception', tone: 'star' },
    { key: 'confirmee', label: 'Confirmée', todo: 'À préparer', tone: 'leaf' },
    { key: 'preparation', label: 'En préparation', todo: 'À mettre en livraison', tone: 'leaf' },
    { key: 'expediee', label: 'Expédiée', todo: 'En livraison · réception à confirmer', tone: 'leaf' },
  ],
  pro: [
    { key: 'interet', label: 'Intérêt reçu', todo: 'Premier contact : à appeler ou à écrire', tone: 'star' },
    { key: 'contacte', label: 'Contacté', todo: 'Sa réponse est attendue', tone: 'neutral' },
    { key: 'discussion', label: 'En discussion', todo: 'Quantités, prix, transport, paiement', tone: 'neutral' },
    { key: 'contrat', label: 'Contrat conclu', todo: 'À préparer', tone: 'leaf' },
    { key: 'preparation', label: 'En préparation', todo: 'À mettre en livraison', tone: 'leaf' },
    { key: 'livraison', label: 'En livraison', todo: 'Réception à confirmer', tone: 'leaf' },
  ],
};
const laneOf = (o: Order): string => (o.type === 'pro' ? proStageOf(o) : o.status);

function StatusCard({ order: o, busy, onOpen, onChange }: { order: Order; busy: boolean; onOpen: () => void; onChange: (key: string) => void }) {
  const { update } = useOrders();
  const { canEdit } = useAuth();
  const pro = o.type === 'pro';
  const stage = proStageOf(o);
  // Étape suivante. Particulier : rien n'avance sans paiement reçu (pas de crédit).
  const next = pro ? proNext(stage) : o.paid_at && FLOW.indexOf(o.status) >= 1 ? FLOW[FLOW.indexOf(o.status) + 1] : null;
  const nextLabel = next ? (pro ? PRO_ACTION[next as ProStage] : NEXT_ACTION[next as OrderStatus]) : null;
  // Message à envoyer : celui du statut en cours s'il reste à envoyer ; pour un professionnel au
  // premier contact, le message d'ouverture de la discussion.
  const notice = needsNotice(o) ? noticeOf(o) : null;
  const opening = pro && !notice && ['interet', 'contacte', 'discussion'].includes(stage);
  const text = notice?.full ?? (opening ? (stage === 'interet' ? introOf(o) : '') : null);
  const number = (o.customer.whatsapp || o.customer.phone).trim();
  const wa = text !== null && /^(\+|00)/.test(number) ? waLink(number, text || undefined) : null;
  const mail = text !== null && !wa && o.customer.email ? `mailto:${o.customer.email}?subject=${encodeURIComponent(`${notice?.title ?? 'Votre demande'} · ${o.number}`)}&body=${encodeURIComponent(text)}` : null;
  return (
    <article className="card p-3.5">
      <button type="button" onClick={onOpen} className="press block w-full text-left" aria-label={`Ouvrir la commande ${o.number} de ${customerName(o)}`}>
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="label-voice block truncate text-[12px] text-fg-faint">{o.number}</span>
            <span className="mt-0.5 block truncate text-[15.5px] font-bold leading-5">{customerName(o)}</span>
            <span className="block truncate text-[12.5px] text-fg-faint">
              {placeOf(o)} · {ago(o.created_at)}
            </span>
          </span>
          <span className={cx('tabular shrink-0 font-extrabold', o.total > 0 ? 'text-[15.5px]' : 'text-[12.5px] text-star')}>{amountText(o)}</span>
        </span>
        {pro && (
          <span className="mt-1.5 block truncate text-[12.5px] text-fg-dim">
            {o.lines.map((l) => `${l.name}${l.mode ? ` · ${l.mode}` : ''} — ${qtyText(l)}`).join(' ; ')}
          </span>
        )}
        <span className="mt-2 block">
          <StatusChips order={o} bare />
        </span>
      </button>
      {canEdit && (
        <div className="mt-3 flex flex-col gap-2">
          {(pro || o.paid_at) && (
            <label className="flex items-center justify-between gap-3 text-[13px] font-semibold text-fg-dim">
              {pro ? 'Étape' : 'Statut'}
              <select
                aria-label={`Statut de la commande ${o.number}`}
                value={pro ? stage : o.status}
                disabled={busy}
                onChange={(e) => onChange(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-full border border-line-strong bg-white/[0.06] px-3.5 text-[14px] font-bold text-fg outline-none focus:border-leaf"
              >
                {pro
                  ? PRO_FLOW.map((id) => (
                      <option key={id} value={id}>
                        {proStageLabel(id)}
                      </option>
                    ))
                  : FLOW.map((id) => (
                      <option key={id} value={id} disabled={id === 'attente'}>
                        {id === 'livree' ? 'Livrée · reçue' : STATUS[id].label}
                      </option>
                    ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => (next ? onChange(next) : onOpen())}
            className="press flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-leaf px-4 text-[14px] font-extrabold text-on-leaf disabled:opacity-60"
          >
            {busy && <span className="spinner" style={{ width: 15, height: 15 }} />}
            {nextLabel ?? 'Accuser réception'}
          </button>
          {(wa || mail) && (
            <a
              href={(wa ?? mail) as string}
              target={wa ? '_blank' : undefined}
              rel="noreferrer noopener"
              onClick={() => {
                if (notice) update(o.id, { notified_via: wa ? 'whatsapp' : 'email' }).catch(() => {});
              }}
              className={cx(contactLink, 'justify-center')}
            >
              {notice ? 'Prévenir le client' : 'Contacter le client'}
            </a>
          )}
        </div>
      )}
    </article>
  );
}

export function OrdersStatus() {
  const { update } = useOrders();
  const { list } = useScope();
  const { canEdit } = useAuth();
  const toast = useToast();
  const [type, setType] = useState<Order['type']>('particulier');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const isOpen = (o: Order) => LANES[o.type].some((lane) => lane.key === laneOf(o));
  const openCount = (t: Order['type']) => list.filter((o) => o.type === t && isOpen(o)).length;
  const lanes = LANES[type];
  const open = list.filter((o) => o.type === type && isOpen(o));

  const change = async (o: Order, key: string) => {
    const before = laneOf(o);
    if (key === before) return;
    const patch = (value: string): OrderPatch => (o.type === 'pro' ? { stage: value } : { status: value as OrderStatus });
    const what = o.type === 'pro' ? 'Demande' : 'Commande';
    setBusyId(o.id);
    try {
      await update(o.id, patch(key));
      if (key === 'livree') {
        // Reçue : la commande quitte la page. Un appui malheureux se rattrape tout de suite.
        toast(`${what} ${o.number} reçue : elle quitte cette page`, {
          action: {
            label: 'Annuler',
            onPress: () => {
              update(o.id, patch(before)).catch((err) => toast(messageOf(err), { tone: 'error' }));
            },
          },
        });
      } else {
        toast(`${what} ${o.number} : ${(o.type === 'pro' ? proStageLabel(key as ProStage) : STATUS[key as OrderStatus].label).toLowerCase()}`);
      }
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Frame title="Statuts" subtitle={`${plural(openCount('particulier') + openCount('pro'), 'commande en cours', 'commandes en cours')}, jusqu’à la réception. Une commande reçue quitte cette page.`}>
      <div className="px-5 pt-4 lg:max-w-[560px]">
        <Segmented
          label="Type de client"
          full
          value={type}
          onChange={setType}
          options={[
            { value: 'particulier', label: `Particuliers · ${openCount('particulier')}` },
            { value: 'pro', label: `Grossistes, importateurs · ${openCount('pro')}` },
          ]}
        />
        <p className="px-1 pt-2.5 text-[12.5px] leading-[18px] text-fg-faint">
          {type === 'pro'
            ? 'Professionnels : rien n’est payé dans l’application. Le client envoie son intérêt ; vous le contactez, puis vous faites avancer sa demande jusqu’au contrat et à la livraison.'
            : 'Particuliers : le paiement est obligatoire. La commande est confirmée quand vous accusez réception du paiement.'}
        </p>
      </div>
      {open.length === 0 ? (
        <EmptyState tint="#C98A2B" title={type === 'pro' ? 'Aucune demande en cours' : 'Aucune commande en cours'} body="Tout est reçu, livré ou annulé de ce côté. Les nouvelles arrivées apparaîtront ici." />
      ) : (
        <LayoutGroup id={type}>
          <div className={cx('mt-4 grid grid-cols-1 items-start gap-x-4 gap-y-7 px-5 lg:grid-cols-2', type === 'pro' ? 'xl:grid-cols-3' : 'xl:grid-cols-4')}>
            {lanes.map((lane) => {
              // Les plus anciennes d'abord : ce sont celles qui attendent depuis le plus longtemps.
              const orders = open.filter((o) => laneOf(o) === lane.key).sort((a, b) => a.created_at.localeCompare(b.created_at));
              return (
                <section key={lane.key} aria-label={`${lane.label} : ${plural(orders.length, 'commande', 'commandes')}`} className="min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-display text-[19px] font-semibold leading-6">{lane.label}</h2>
                    <Chip tone={orders.length > 0 ? lane.tone : 'neutral'}>{orders.length}</Chip>
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-[18px] text-fg-faint">{lane.todo}</p>
                  <ul className="relative mt-3 flex flex-col gap-3">
                    <AnimatePresence initial={false} mode="popLayout">
                      {orders.map((o) => (
                        <motion.li
                          key={o.id}
                          layout
                          layoutId={`statut-${o.id}`}
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        >
                          <StatusCard order={o} busy={busyId === o.id} onOpen={() => setOpenId(o.id)} onChange={(key) => change(o, key)} />
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                  {orders.length === 0 && <p className="rounded-2xl border border-dashed border-line px-4 py-4 text-center text-[13px] text-fg-faint">Rien ici pour l’instant.</p>}
                </section>
              );
            })}
          </div>
        </LayoutGroup>
      )}
      <p className="px-6 pt-6 text-[12.5px] leading-[18px] text-fg-faint">
        {canEdit
          ? 'Touchez une commande pour sa fiche complète (client, coordonnées, livraison, annulation). Ce qui est reçu, annulé ou sans suite se retrouve dans la page Commandes.'
          : 'Mode visite : les statuts se changent une fois connecté.'}
      </p>
      <OrderSheet order={list.find((o) => o.id === openId) ?? null} onClose={() => setOpenId(null)} />
    </Frame>
  );
}

// ───────────── Page « Clients »

type Client = { key: string; name: string; latest: Order; orders: Order[]; ordered: number; paid: number };

export function OrdersClients() {
  const { list } = useScope();
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  const clients = useMemo(() => {
    const map = new Map<string, Client>();
    for (const o of list) {
      const key = customerKey(o);
      const c = map.get(key) ?? { key, name: customerName(o), latest: o, orders: [], ordered: 0, paid: 0 };
      c.orders.push(o);
      if (o.created_at > c.latest.created_at) c.latest = o;
      if (counted(o)) {
        c.ordered += o.total;
        if (o.paid_at) c.paid += o.total;
      }
      map.set(key, c);
    }
    return [...map.values()].sort((a, b) => b.ordered - a.ordered || b.latest.created_at.localeCompare(a.latest.created_at));
  }, [list]);

  const needle = normalize(query);
  const shown = needle ? clients.filter((c) => normalize(`${c.name} ${c.latest.customer.name} ${c.latest.customer.email} ${c.latest.address} ${c.latest.country}`).includes(needle)) : clients;
  const opened = clients.find((c) => c.key === openKey) ?? null;
  const pros = clients.filter((c) => c.latest.type === 'pro').length;

  return (
    <Frame title="Clients" subtitle={`${plural(clients.length, 'client a commandé', 'clients ont commandé')}, dont ${plural(pros, 'professionnel', 'professionnels')}.`}>
      <div className="px-5 pt-4">
        <label className="flex h-12 items-center gap-2 rounded-full border border-line bg-surface px-4 transition-colors focus-within:border-leaf">
          <span className="sr-only">Rechercher un client</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom, société, ville, e-mail…"
            autoComplete="off"
            enterKeyHint="search"
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="px-6 pt-8 text-center text-[14.5px] leading-[22px] text-fg-dim">Aucun client ne correspond à cette recherche.</p>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 px-5 lg:grid-cols-2 xl:grid-cols-3">
          {shown.map((c, i) => (
            <motion.li key={c.key} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 260, damping: 26, delay: i < 9 ? i * 0.03 : 0 }}>
              <button type="button" onClick={() => setOpenKey(c.key)} className="press card flex w-full items-center gap-3.5 p-3.5 text-left" aria-label={`Ouvrir le profil de ${c.name}`}>
                <span className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-full text-[15px] font-extrabold', c.latest.type === 'pro' ? 'bg-star text-bg-deep' : 'bg-leaf text-on-leaf')}>{nameInitials(c.name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15.5px] font-bold leading-5">{c.name}</span>
                  <span className="block truncate text-[12.5px] text-fg-faint">
                    {c.latest.type === 'pro' ? (ACTIVITY[c.latest.customer.activity] ?? 'Professionnel') : 'Particulier'} · {placeOf(c.latest)}
                  </span>
                  <span className="mt-1 block truncate text-[12.5px] text-fg-dim">
                    {plural(c.orders.length, 'commande', 'commandes')} · dernière {ago(c.latest.created_at)}
                  </span>
                </span>
                <span className="tabular shrink-0 text-right text-[15.5px] font-extrabold">{c.ordered > 0 ? money(c.ordered) : '—'}</span>
              </button>
            </motion.li>
          ))}
        </ul>
      )}

      <Sheet open={!!opened && !openOrder} onClose={() => setOpenKey(null)} title={opened?.name ?? ''}>
        {opened && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone={opened.latest.type === 'pro' ? 'star' : 'leaf'}>{opened.latest.type === 'pro' ? 'Professionnel' : 'Particulier'}</Chip>
              <Chip>{plural(opened.orders.length, 'commande', 'commandes')}</Chip>
              {opened.latest.is_example && <Chip>Exemple</Chip>}
            </div>
            <h3 className="mt-4 font-display text-[18px] font-semibold">Profil</h3>
            <p className="text-[12.5px] text-fg-faint">Tel que renseigné lors de sa dernière commande.</p>
            <Contact order={opened.latest} />
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-black/25 p-3.5">
                <dt className="label-voice text-[11.5px] text-fg-faint">Commandé</dt>
                <dd className="poster-voice tabular mt-1 text-[24px] leading-7">{money(opened.ordered)}</dd>
              </div>
              <div className="rounded-2xl bg-black/25 p-3.5">
                <dt className="label-voice text-[11.5px] text-fg-faint">Encaissé</dt>
                <dd className="poster-voice tabular mt-1 text-[24px] leading-7 text-leaf">{money(opened.paid)}</dd>
              </div>
            </dl>
            <h3 className="mt-5 font-display text-[18px] font-semibold">Ses commandes</h3>
            <ul className="mt-2.5 flex flex-col gap-2.5">
              {opened.orders.map((o) => (
                <li key={o.id}>
                  <OrderCard order={o} onOpen={() => setOpenOrder(o.id)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Sheet>
      <OrderSheet order={list.find((o) => o.id === openOrder) ?? null} onClose={() => setOpenOrder(null)} />
    </Frame>
  );
}

// ───────────── Page « Statistiques »

function Bar({ label, value, share, tone = 'bg-leaf' }: { label: string; value: string; share: number; tone?: string }) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[14px] font-semibold">{label}</span>
        <span className="tabular shrink-0 text-[13.5px] font-extrabold">{value}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div className={cx('h-full rounded-full', tone)} initial={{ width: 0 }} whileInView={{ width: `${Math.max(share > 0 ? 3 : 0, Math.round(share * 100))}%` }} viewport={{ once: true }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
      </div>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="card mx-5 mt-3.5 p-[18px]">
      <h2 className="font-display text-[19px] font-semibold leading-6">{title}</h2>
      {note && <p className="mt-1 text-[12.5px] leading-[18px] text-fg-faint">{note}</p>}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

export function OrdersStats() {
  const { list, exampleMode } = useScope();
  const [period, setPeriod] = useState<'7' | '30' | 'tout'>('30');

  const data = useMemo(() => {
    const days = period === '7' ? 7 : 30;
    const now = Date.now();
    const scoped = period === 'tout' ? list : list.filter((o) => now - new Date(o.created_at).getTime() <= days * 86400000);
    const s = sums(scoped);
    const retail = s.live.filter((o) => o.type === 'particulier');
    const pro = s.live.filter((o) => o.type === 'pro');
    const total = (rows: Order[]) => rows.reduce((sum, o) => sum + o.total, 0);

    // Montant par jour, du plus ancien au plus récent.
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const byDay = Array.from({ length: days }, (_, i) => {
      const day = new Date(start.getTime() - (days - 1 - i) * 86400000);
      const rows = s.live.filter((o) => {
        const d = new Date(o.created_at);
        return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
      });
      return { day, amount: total(rows), orders: rows.length };
    });

    const products = new Map<string, { name: string; amount: number; orders: number }>();
    for (const o of s.live) {
      for (const l of o.lines) {
        const p = products.get(l.name) ?? { name: l.name, amount: 0, orders: 0 };
        p.amount += l.total ?? 0;
        p.orders += 1;
        products.set(l.name, p);
      }
    }
    const countries = new Map<string, number>();
    for (const o of s.live) countries.set(o.country || 'Non renseigné', (countries.get(o.country || 'Non renseigné') ?? 0) + 1);

    return {
      scoped,
      ...s,
      clients: new Set(s.live.map(customerKey)).size,
      basket: retail.length > 0 ? total(retail) / retail.length : 0,
      retail: { n: retail.length, amount: total(retail) },
      pro: { n: pro.length, amount: total(pro) },
      byDay,
      top: [...products.values()].sort((a, b) => b.amount - a.amount || b.orders - a.orders).slice(0, 6),
      countries: [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      unpriced: s.live.filter((o) => o.unpriced > 0).length,
    };
  }, [list, period]);

  const peak = Math.max(1, ...data.byDay.map((d) => d.amount));
  const best = data.byDay.reduce((a, b) => (b.amount > a.amount ? b : a), data.byDay[0]);
  const dayLabel = (d: Date) => `${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTHS[d.getMonth()]}`;
  const topMax = Math.max(1, ...data.top.map((p) => p.amount));

  return (
    <Frame title="Statistiques" accent={exampleMode ? 'd’exemple' : undefined} subtitle="Calculées sur les commandes de cet espace, hors commandes annulées.">
      <div className="px-5 pt-4">
        <Segmented
          label="Période"
          full
          value={period}
          onChange={setPeriod}
          options={[
            { value: '7', label: '7 jours' },
            { value: '30', label: '30 jours' },
            { value: 'tout', label: 'Tout' },
          ]}
        />
      </div>

      <div className="mx-5 mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Commandes" value={count(data.live.length)} detail={`${plural(data.clients, 'client', 'clients')} différents.`} />
        <Kpi label="Montant commandé" value={money(data.ordered)} detail={data.unpriced > 0 ? `${plural(data.unpriced, 'demande a', 'demandes ont')} des prix à confirmer, non comptés.` : 'Lignes chiffrées uniquement.'} />
        <Kpi label="Encaissé" value={money(data.paid)} tone="leaf" detail="Pointé à la main par l’équipe." />
        <Kpi label="À encaisser" value={money(data.due)} tone={data.due > 0 ? 'star' : undefined} detail="Commandé, pas encore pointé." />
        <Kpi label="Panier moyen" value={data.retail.n > 0 ? money(data.basket) : '—'} detail="Commandes des particuliers." />
        <Kpi label="Annulées" value={count(data.scoped.length - data.live.length)} detail="Hors de tous les montants." />
      </div>

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-1">
        <div className="min-w-0">
          <Panel title="Commandé par jour" note={best && best.amount > 0 ? `Meilleur jour : ${dayLabel(best.day)}, ${money(best.amount)} commandés.` : 'Aucun montant sur cette période.'}>
            <div className="flex h-[132px] items-end gap-[3px]" role="img" aria-label={`Montant commandé par jour sur ${data.byDay.length} jours. Total : ${money(data.ordered)}.`}>
              {data.byDay.map((d, i) => (
                <motion.span
                  key={i}
                  title={`${dayLabel(d.day)} : ${money(d.amount)} · ${plural(d.orders, 'commande', 'commandes')}`}
                  className={cx('min-w-0 flex-1 origin-bottom rounded-t-[5px]', d.amount > 0 ? 'bg-star' : 'bg-white/[0.08]')}
                  style={{ height: d.amount > 0 ? `${Math.max(6, Math.round((d.amount / peak) * 100))}%` : 3 }}
                  initial={{ scaleY: 0.04 }}
                  whileInView={{ scaleY: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: Math.min(i, 30) * 0.012, ease: [0.22, 1, 0.36, 1] }}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[11.5px] font-semibold text-fg-faint">
              <span>{dayLabel(data.byDay[0].day)}</span>
              <span>aujourd’hui</span>
            </div>
          </Panel>

          <Panel title="Particuliers et professionnels">
            <Bar label={`Particuliers · ${plural(data.retail.n, 'commande', 'commandes')}`} value={money(data.retail.amount)} share={data.ordered > 0 ? data.retail.amount / data.ordered : 0} />
            <Bar label={`Professionnels · ${plural(data.pro.n, 'demande', 'demandes')}`} value={money(data.pro.amount)} share={data.ordered > 0 ? data.pro.amount / data.ordered : 0} tone="bg-star" />
          </Panel>
        </div>

        <div className="min-w-0">
          <Panel title="Par statut">
            {ALL_STATUS.map((id) => {
              const n = data.scoped.filter((o) => o.status === id).length;
              return <Bar key={id} label={STATUS[id].many} value={count(n)} share={data.scoped.length > 0 ? n / data.scoped.length : 0} tone={id === 'annulee' ? 'bg-danger' : id === 'attente' ? 'bg-star' : 'bg-leaf'} />;
            })}
          </Panel>

          <Panel title="Produits les plus commandés" note="Classés par montant des lignes chiffrées.">
            {data.top.length === 0 ? (
              <p className="text-[13.5px] text-fg-dim">Aucun produit sur cette période.</p>
            ) : (
              data.top.map((p) => <Bar key={p.name} label={`${p.name} · ${plural(p.orders, 'commande', 'commandes')}`} value={p.amount > 0 ? money(p.amount) : 'À confirmer'} share={p.amount / topMax} />)
            )}
          </Panel>

          <Panel title="Par pays">
            {data.countries.length === 0 ? (
              <p className="text-[13.5px] text-fg-dim">Aucune commande sur cette période.</p>
            ) : (
              data.countries.map(([name, n]) => <Bar key={name} label={name} value={plural(n, 'commande', 'commandes')} share={n / Math.max(1, data.live.length)} />)
            )}
          </Panel>
        </div>
      </div>

      <p className="px-6 pt-5 text-[12.5px] leading-[18px] text-fg-faint">
        « Encaissé » additionne les commandes que l’équipe a pointées comme payées. Aucun prestataire de paiement n’est relié : ces chiffres ne remplacent pas un relevé bancaire.
      </p>
    </Frame>
  );
}

// ───────────── Page « Livraison » : le GP et nos livreurs

const EMPTY: Logistics = { gp: { name: '', whatsapp: '' }, gpDelivery: 'aeroport', gpCountries: [], couriers: [] };

export function OrdersDelivery() {
  const { logistics, saveLogistics, loading, error, reload } = useOrders();
  const { canEdit, isOwner } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<Logistics>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const saved = JSON.stringify({ ...EMPTY, ...(logistics ?? {}) });
  useEffect(() => {
    setForm(JSON.parse(saved));
  }, [saved]);
  const dirty = JSON.stringify(form) !== saved;

  const setCourier = (index: number, patch: { name?: string; phone?: string }) => setForm((f) => ({ ...f, couriers: f.couriers.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      await saveLogistics(form);
      toast('Livraison enregistrée');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast(`Non enregistré. ${messageOf(err)}`, { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <div className="mx-auto w-full max-w-[820px]">
        <PageHeader title="Livraison" subtitle="Qui transporte les commandes, au Sénégal et vers l’étranger." />
      </div>
      <Column>
        {error && !logistics && canEdit ? (
          <div className="-mx-5">
            <ErrorPanel message={error} onRetry={reload} />
          </div>
        ) : loading ? (
          <div className="-mx-5">
            <SkeletonRows rows={3} />
          </div>
        ) : !canEdit ? (
          <>
            <Group className="p-5">
              <p className="text-[15px] font-bold">Réservé à l’équipe</p>
              <p className="mt-1 text-[13.5px] leading-5 text-fg-dim">Le numéro du GP et ceux des livreurs ne sont pas affichés en mode visite. Connectez-vous pour les voir et les modifier.</p>
            </Group>
            <Rules />
          </>
        ) : (
          <>
            <GroupTitle>International · le GP</GroupTitle>
            <Group className="px-4 pb-4">
              <Field label="Nom du GP" optional disabled={!isOwner} value={form.gp.name} maxLength={60} placeholder="Prénom et nom" onValue={(v) => setForm((f) => ({ ...f, gp: { ...f.gp, name: v } }))} />
              <Field
                label="Numéro WhatsApp"
                type="tel"
                inputMode="tel"
                disabled={!isOwner}
                value={form.gp.whatsapp}
                maxLength={40}
                placeholder="+221 77 000 00 00"
                onValue={(v) => setForm((f) => ({ ...f, gp: { ...f.gp, whatsapp: v } }))}
                error={errors['gp.whatsapp'] || undefined}
                hint="Avec l’indicatif du pays. C’est à ce numéro que part le message de chaque commande internationale."
              />
              {logistics?.gp.whatsapp && !dirty && (
                <a href={waLink(logistics.gp.whatsapp)} target="_blank" rel="noreferrer noopener" className="press mt-3 inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-[13.5px] font-bold">
                  Ouvrir sa conversation WhatsApp
                </a>
              )}
              <p className="mb-[7px] mt-4 text-[13px] font-semibold text-fg-dim">Le GP livre jusqu’à</p>
              <Segmented
                label="Jusqu’où le GP livre"
                full
                value={form.gpDelivery}
                onChange={(v) => isOwner && setForm((f) => ({ ...f, gpDelivery: v }))}
                options={[
                  { value: 'aeroport', label: 'L’aéroport' },
                  { value: 'domicile', label: 'Porte à porte' },
                ]}
              />
              <p className="mb-[7px] mt-4 text-[13px] font-semibold text-fg-dim">Pays desservis par le GP</p>
              <CountryChips
                value={form.gpCountries}
                onChange={(next) => isOwner && setForm((f) => ({ ...f, gpCountries: next }))}
                label="Pays desservis par le GP"
                placeholder="Ajouter un pays : France, Belgique…"
                exclude={['SN']}
                disabled={!isOwner}
              />
              {errors.gpCountries && <p className="mt-2 text-[13px] text-danger">{errors.gpCountries}</p>}
            </Group>
            <Foot>
              Un seul GP pour le moment.{' '}
              {form.gpDelivery === 'domicile'
                ? 'Porte à porte : il remet la commande au client, à son domicile.'
                : 'Il assure le transit jusqu’à l’aéroport d’arrivée ; le client récupère sa commande sur place et se charge de la suite.'}{' '}
              Ce réglage vaut pour toutes les commandes internationales ; chaque commande peut en décider autrement dans sa fiche.
            </Foot>

            <GroupTitle right={<span className="text-[12px] font-semibold text-fg-faint">{plural(form.couriers.length, 'livreur', 'livreurs')}</span>}>Sénégal · nos livreurs</GroupTitle>
            <Group>
              {form.couriers.length === 0 && <p className="border-b border-line px-4 py-4 text-[13.5px] leading-5 text-fg-dim">Aucun livreur pour l’instant. Ajoutez ceux à qui vous confiez les commandes.</p>}
              {form.couriers.map((c, i) => (
                <div key={c.id || `nouveau-${i}`} className="border-b border-line px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      aria-label={`Nom du livreur ${i + 1}`}
                      value={c.name}
                      disabled={!isOwner}
                      maxLength={60}
                      placeholder="Nom du livreur"
                      onChange={(e) => setCourier(i, { name: e.target.value })}
                      className="field field-compact !w-auto min-w-0 flex-[1.5]"
                      aria-invalid={errors[`couriers.${i}.name`] ? true : undefined}
                    />
                    <input
                      aria-label={`Téléphone du livreur ${i + 1}`}
                      value={c.phone}
                      disabled={!isOwner}
                      type="tel"
                      inputMode="tel"
                      maxLength={30}
                      placeholder="Téléphone"
                      onChange={(e) => setCourier(i, { phone: e.target.value })}
                      className="field field-compact !w-auto min-w-0 flex-1"
                      aria-invalid={errors[`couriers.${i}.phone`] ? true : undefined}
                    />
                    {isOwner && (
                      <button type="button" aria-label={`Retirer ${c.name || 'ce livreur'}`} onClick={() => setForm((f) => ({ ...f, couriers: f.couriers.filter((_, n) => n !== i) }))} className="press press-deep grid h-11 w-11 shrink-0 place-items-center rounded-full text-[20px] font-bold leading-none text-danger">
                        ×
                      </button>
                    )}
                  </div>
                  {(errors[`couriers.${i}.name`] || errors[`couriers.${i}.phone`]) && (
                    <p role="alert" className="mt-2 text-[13px] font-semibold text-danger">
                      {errors[`couriers.${i}.name`] || errors[`couriers.${i}.phone`]}
                    </p>
                  )}
                </div>
              ))}
              {isOwner && (
                <button type="button" onClick={() => setForm((f) => ({ ...f, couriers: [...f.couriers, { id: '', name: '', phone: '' }] }))} className="row-tap flex min-h-[52px] w-full items-center gap-2 px-4 text-left text-[14.5px] font-bold text-leaf">
                  <span aria-hidden className="text-[20px] leading-none">
                    +
                  </span>{' '}
                  Ajouter un livreur
                </button>
              )}
            </Group>
            <Foot>Aucune commande n’est attribuée automatiquement : dans chaque commande, c’est l’équipe qui choisit le livreur.</Foot>

            {isOwner ? (
              <div className="mt-6">
                <PrimaryButton label="Enregistrer" disabled={!dirty} loading={saving} onClick={save} />
                {dirty && (
                  <p className="mt-2.5 text-center text-[12.5px] font-semibold text-star" role="status">
                    Modifications non enregistrées
                  </p>
                )}
              </div>
            ) : (
              <Foot>Seul un responsable peut modifier le GP et la liste des livreurs.</Foot>
            )}
            <Rules />
          </>
        )}
      </Column>
    </Page>
  );
}

function Rules() {
  return (
    <>
      <GroupTitle>Comment ça marche</GroupTitle>
      <Group>
        <Cell label="Sénégal">À domicile, par nos livreurs à moto</Cell>
        <Cell label="International">Par GP : aéroport ou porte à porte</Cell>
        <Cell label="Position">Envoyée par le téléphone du client</Cell>
        <Cell label="Paiement">Reçu = commande confirmée</Cell>
      </Group>
      <Foot>
        Au Sénégal, le client autorise la localisation : sa position arrive avec la commande et s’affiche dans sa fiche, avec l’itinéraire. Vous choisissez le livreur et lui
        envoyez la course par WhatsApp (adresse, position, numéro du client). Sans numéro avec indicatif, un mobile sénégalais reçoit +221. Le message au GP part de la fiche de la commande : WhatsApp s’ouvre avec le message déjà écrit, il reste à toucher « Envoyer ». L’envoi entièrement automatique demanderait un
        service WhatsApp professionnel, qui n’est pas relié.
      </Foot>
    </>
  );
}
