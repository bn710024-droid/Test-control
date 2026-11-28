import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, messageOf } from '../lib/api';
import { apiSpace } from '../lib/space';
import { useAuth } from './AuthContext';
import type { CartStatusId, ContactWay } from '../../shared/carts.js';

export type OrderStatus = 'attente' | 'confirmee' | 'preparation' | 'expediee' | 'livree' | 'annulee';

export type OrderLine = {
  product_id: string;
  name: string;
  mode: 'avion' | 'bateau' | null;
  qty: number;
  unit: 'kg' | 'unit' | 'conteneur';
  noun: [string, string] | null;
  kg: number | null;
  /** `null` : prix non fixé au moment de la commande — la ligne n'entre dans aucun total. */
  unit_price: number | null;
  total: number | null;
};

export type Order = {
  id: string;
  received_at: string;
  type: 'particulier' | 'pro';
  /** Programme d'un acheteur pro (quantité étalée dans le temps), sinon une demande ou commande. */
  kind?: 'programme';
  programme?: {
    calibres: string[];
    packaging: string;
    quantity: number;
    unit: 'kg' | 'tonnes' | 'conteneurs';
    start: string;
    end: string | null;
    frequency: 'hebdomadaire' | 'mensuelle' | 'ponctuelle';
    destination: { country: string; place: string };
    details: string;
  };
  number: string;
  created_at: string;
  /** Vrai : commande fictive, pour visualiser l'espace. */
  is_example: boolean;
  customer: { account_id: string; name: string; company: string; activity: string; email: string; phone: string; whatsapp: string };
  address: string;
  country: string;
  lines: OrderLine[];
  incoterm: 'EXW' | 'FOB' | null;
  subtotal: number;
  transport_cost: number;
  total: number;
  unpriced: number;
  /** Devise de la commande (ISO 4217), envoyée par l'application ; absente : EUR. */
  currency?: string;
  payment: string | null;
  note: string;
  status: OrderStatus;
  status_at: string;
  /** Paiement reçu, pointé à la main par l'équipe : aucun prestataire de paiement n'est relié. */
  paid_at: string | null;
  /** Moyen par lequel le paiement a été reçu. */
  paid_via?: PayMethod | null;
  /** Livreur choisi par l'équipe. Jamais attribué automatiquement. */
  courier?: { id: string; name: string } | null;
  /** International : aéroport d'arrivée, où le client récupère sa commande. */
  airport?: string;
  /** International : choix fait sur cette commande (sinon, le réglage général du GP s'applique). */
  delivery?: 'aeroport' | 'domicile';
  /** Mode de livraison effectif, calculé par le serveur. */
  delivery_mode?: 'aeroport' | 'domicile';
  /** Position du téléphone du client, s'il l'a autorisée : à la commande, puis tant qu'elle est en cours. */
  location?: { lat: number; lng: number; accuracy: number | null; at: string } | null;
  /** Date à laquelle le message WhatsApp au GP a été ouvert depuis cette fiche. */
  gp_at?: string | null;
  /** Passages de statut, datés, du plus ancien au plus récent. */
  history?: { status: OrderStatus; stage?: string; at: string; notified_at?: string; notified_via?: 'whatsapp' | 'email' }[];
  /** Demande professionnelle : étape du parcours (intérêt reçu, contacté… livrée). */
  stage?: string;
};

export type PayMethod = 'orange_money' | 'wave' | 'virement' | 'carte';
export type Courier = { id: string; name: string; phone: string };
/** Le GP (transit international) et nos livreurs. Réservé aux comptes autorisés. */
export type Logistics = { gp: { name: string; whatsapp: string }; gpDelivery: 'aeroport' | 'domicile'; gpCountries: string[]; couriers: Courier[] };
export type OrderPatch = { status?: OrderStatus; paid?: boolean; via?: PayMethod; courier_id?: string | null; airport?: string; delivery?: 'aeroport' | 'domicile'; gp_notified?: boolean; notified_via?: 'whatsapp' | 'email'; stage?: string };

/** Ligne d'un panier en cours, chiffrée par la tour d'après le catalogue publié. */
export type CartLine = {
  line_id: string;
  product_id: string;
  name: string;
  format_label: string | null;
  mode: 'avion' | 'bateau' | null;
  qty: number;
  unit: 'kg' | 'unit' | 'conteneur';
  noun: [string, string] | null;
  /** `null` : prix à confirmer — la ligne n'entre dans aucun total. */
  unit_price: number | null;
  currency: string;
  total: number | null;
  /** Faux : la ligne ne correspond plus à rien de commandable pour ce client. */
  known: boolean;
  added_at: string;
  updated_at: string;
};

/** Panier en cours d'un client de l'application (un par compte). */
export type Cart = {
  id: string;
  account: { name: string; type: 'particulier' | 'pro'; activity: string | null; company: string; phone: string; email: string; whatsapp: string; country: string };
  country: string;
  incoterm: 'EXW' | 'FOB' | null;
  lines: CartLine[];
  /** Un total par devise, jamais additionnés entre eux. */
  totals: { currency: string; amount: number }[];
  unpriced: number;
  /** Dernière modification du panier dans l'application. */
  updated_at: string;
  changed_at: string;
  created_at: string;
  status: CartStatusId;
  /** Statut « commandé » : la commande reçue après la dernière modification du panier. */
  order: { id: string; number: string; received_at: string } | null;
  /** Relances du client depuis la fiche du panier. */
  contacts: { via: ContactWay; at: string }[];
};

type Value = {
  orders: Order[];
  /** Paniers en cours (équipe). Vide en mode visite. */
  carts: Cart[];
  cartsError: string | null;
  /** Note que le client a été relancé (WhatsApp, appel, e-mail). */
  contactCart: (id: string, via: ContactWay) => Promise<void>;
  removeCart: (id: string) => Promise<void>;
  /** 'examples' : mode visite, seules les commandes fictives sont transmises par le serveur. */
  scope: 'all' | 'examples';
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  loadedAt: number | null;
  reload: () => Promise<void>;
  /** `null` en mode visite : les numéros ne sortent pas du serveur. */
  logistics: Logistics | null;
  update: (id: string, patch: OrderPatch) => Promise<void>;
  saveLogistics: (value: Logistics) => Promise<void>;
  remove: (id: string) => Promise<void>;
  seedExamples: () => Promise<void>;
  clearExamples: () => Promise<void>;
};

const OrdersContext = createContext<Value | null>(null);

/** Les commandes sont relues toutes les trente secondes tant que l'espace est à l'écran. */
const EVERY = 30000;

export function OrdersProvider({ children }: { children: ReactNode }) {
  const { canEdit } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [scope, setScope] = useState<'all' | 'examples'>('examples');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [logistics, setLogistics] = useState<Logistics | null>(null);
  const [carts, setCarts] = useState<Cart[]>([]);
  const [cartsError, setCartsError] = useState<string | null>(null);
  const alive = useRef(true);

  const fetchAll = useCallback(async (quiet: boolean) => {
    if (!quiet) setRefreshing(true);
    try {
      // Les paniers sont relus avec les commandes ; s'ils échouent, les commandes restent affichées.
      const [data, cartData] = await Promise.all([
        api<{ orders: Order[]; scope: 'all' | 'examples'; logistics: Logistics | null }>('/api/orders'),
        api<{ carts: Cart[] }>('/api/orders?vue=paniers').catch((err: unknown) => ({ carts: null, error: messageOf(err) })),
      ]);
      if (!alive.current) return;
      if (Array.isArray(cartData.carts)) {
        // Paniers en cours : ceux des particuliers (l'espace Pros n'a pas de paniers).
        setCarts(cartData.carts.filter((c) => c.account?.type !== 'pro'));
        setCartsError(null);
      } else if (!quiet) {
        setCartsError('error' in cartData ? String(cartData.error) : 'Paniers indisponibles.');
      }
      // Deux espaces : Particuliers = commandes ; Pros = demandes et programmes. Jamais mélangés.
      const pro = apiSpace() === 'b2b';
      setOrders(data.orders.filter((o) => (o.type === 'pro') === pro).sort((a, b) => b.created_at.localeCompare(a.created_at)));
      setScope(data.scope);
      setLogistics(data.logistics ?? null);
      setLoadedAt(Date.now());
      setError(null);
    } catch (err) {
      // Une relecture silencieuse qui échoue garde l'écran en l'état ; la suivante réessaiera.
      if (alive.current && !quiet) setError(messageOf(err));
    } finally {
      if (alive.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    fetchAll(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchAll(true);
    }, EVERY);
    const onShow = () => {
      if (document.visibilityState === 'visible') fetchAll(true);
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [fetchAll]);

  const guard = () => {
    if (!canEdit) throw new ApiError('Mode visite, en lecture seule : connectez-vous pour modifier une commande.', 401);
  };

  const value: Value = {
    orders,
    carts,
    cartsError,
    contactCart: async (id, via) => {
      guard();
      const row = await api<Cart>('/api/orders', { method: 'PUT', body: { cart: { id, contacted_via: via } } });
      setCarts((list) => list.map((c) => (c.id === id ? row : c)));
    },
    removeCart: async (id) => {
      guard();
      await api('/api/orders', { method: 'DELETE', body: { cartId: id } });
      setCarts((list) => list.filter((c) => c.id !== id));
    },
    scope,
    loading,
    refreshing,
    error,
    loadedAt,
    logistics,
    reload: () => fetchAll(false),
    saveLogistics: async (value) => {
      guard();
      setLogistics(await api<Logistics>('/api/orders', { method: 'PUT', body: { logistics: value } }));
      // Le réglage du GP change le mode de livraison des commandes qui n'ont pas de choix propre.
      fetchAll(true);
    },
    update: async (id, patch) => {
      guard();
      const row = await api<Order>('/api/orders', { method: 'PUT', body: { id, ...patch } });
      setOrders((list) => list.map((o) => (o.id === id ? row : o)));
    },
    remove: async (id) => {
      guard();
      await api('/api/orders', { method: 'DELETE', body: { id } });
      setOrders((list) => list.filter((o) => o.id !== id));
    },
    seedExamples: async () => {
      guard();
      await api('/api/orders', { method: 'POST', body: { action: 'examples' } });
      await fetchAll(true);
    },
    clearExamples: async () => {
      guard();
      await api('/api/orders', { method: 'DELETE', body: { examples: true } });
      await fetchAll(true);
    },
  };

  return <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>;
}

export function useOrders() {
  const ctx = useContext(OrdersContext);
  if (!ctx) throw new Error('useOrders hors de OrdersProvider');
  return ctx;
}
