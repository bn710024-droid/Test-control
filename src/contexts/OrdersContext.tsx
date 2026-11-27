import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, messageOf } from '../lib/api';
import { useAuth } from './AuthContext';

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

type Value = {
  orders: Order[];
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
  const alive = useRef(true);

  const fetchAll = useCallback(async (quiet: boolean) => {
    if (!quiet) setRefreshing(true);
    try {
      const data = await api<{ orders: Order[]; scope: 'all' | 'examples'; logistics: Logistics | null }>('/api/orders');
      if (!alive.current) return;
      setOrders([...data.orders].sort((a, b) => b.created_at.localeCompare(a.created_at)));
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
