import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RequestMessage } from '../../shared/requests.js';
import { embeddedAssetsOf } from '../../shared/assets.js';
import { ApiError, api, messageOf } from '../lib/api';
import { useAuth } from './AuthContext';
import { blobToBase64 } from '../lib/image';
import { currentMonth } from '../lib/format';
import {
  completeness,
  type CategoryRow,
  type Issue,
  type ProductInput,
  type ProductRow,
  type QuantityRules,
} from '../../shared/catalog.js';

export type Seal = 'ok' | 'missing' | 'invalid';
export type Product = ProductRow & { _seal?: Seal };
export type Category = CategoryRow & { _seal?: Seal };

/** Ce que l'application d'achat connaît en dur, relevé dans son code. */
export type Compat = { repo: string; commit: string; schema: number; categoryIds: string[]; embeddedAssets: string[] };
export type Link = { appLinked: boolean; note: string; declaredBy: string; declaredAt: string };
/** Filtre de l'accueil de l'application (« Tout », « De saison ») : nom et photo. */
export type HomeFilterId = 'tout' | 'saison';
export type HomeFilter = { label: string; image_url: string | null; image_ratio: number };
export type Settings = {
  rules: QuantityRules;
  compat: Compat | null;
  link: Link | null;
  filters: Record<HomeFilterId, HomeFilter> | null;
  /** Message des produits introuvables. `null` : jamais réglé, les textes par défaut s'appliquent. */
  missing: RequestMessage | null;
  updated: Record<string, string>;
  seals: Record<string, Seal>;
};
export type Activity = {
  id: number;
  at: string;
  by: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string;
};

export type BulkUpdate = { id: string; expected_updated_at?: string; changes: Partial<ProductInput> };
export type BulkResult = { id: string; ok: boolean; error?: string; fields?: Record<string, string>; row?: Product };

type DataValue = {
  products: Product[];
  categories: Category[];
  settings: Settings | null;
  activity: Activity[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;

  /** Adresse de la photo d'un produit, ou `null` s'il n'en a pas. */
  photoOf: (p: Pick<ProductRow, 'photo_url' | 'photo_asset'>, size?: 'thumb' | 'full') => string | null;
  /** Illustration ronde d'un rayon. */
  artOf: (c: Category) => { src: string | null; ratio: number };
  /** Nom et illustration d'un filtre de l'accueil ; `base` : l'illustration d'origine. */
  filterOf: (id: HomeFilterId) => { label: string; src: string | null; ratio: number; base: { src: string | null; ratio: number } };
  issuesOf: (p: Product) => Issue[];
  categoryLabel: (id: string) => string;
  /** Lignes à valider par un responsable avant publication (écrites hors de l'administration). */
  pendingRefs: { ref: string; label: string; state: Seal }[];

  createProduct: (input: ProductInput) => Promise<Product>;
  updateProduct: (id: string, input: Partial<ProductInput>, expected?: string) => Promise<Product>;
  bulkUpdate: (updates: BulkUpdate[]) => Promise<BulkResult[]>;
  deleteProduct: (id: string) => Promise<void>;

  createCategory: (input: Partial<CategoryRow>) => Promise<Category>;
  updateCategory: (id: string, input: Partial<CategoryRow>) => Promise<Category>;
  reorderCategories: (ids: string[]) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;

  saveRules: (rules: unknown) => Promise<void>;
  saveLink: (link: { appLinked: boolean; note: string }) => Promise<void>;
  saveFilters: (filters: Record<HomeFilterId, HomeFilter>) => Promise<void>;
  saveRequestMessage: (message: RequestMessage) => Promise<void>;
  sealRefs: (refs: string[]) => Promise<{ sealed: string[]; refused: { ref: string; error: string }[] }>;
  uploadImage: (kind: 'products' | 'categories' | 'packagings', id: string, blob: Blob) => Promise<string>;
};

const DataContext = createContext<DataValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const { canEdit } = useAuth();
  /** Mode visite : rien n'est envoyé au serveur, qui refuserait de toute façon. */
  const guard = () => {
    if (!canEdit) throw new ApiError('Mode visite, en lecture seule : connectez-vous pour enregistrer des modifications.', 401);
  };

  const fetchAll = useCallback(async () => {
    const [p, c, s] = await Promise.all([
      api<Product[]>('/api/products'),
      api<Category[]>('/api/categories'),
      api<Settings>('/api/settings'),
    ]);
    if (!alive.current) return;
    setProducts(p);
    setCategories(c);
    setSettings(s);
    // Le journal est secondaire : son échec ne doit pas masquer le catalogue.
    api<Activity[]>('/api/activity')
      .then((a) => alive.current && setActivity(a))
      .catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchAll();
    } catch (err) {
      if (alive.current) setError(messageOf(err));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [fetchAll]);

  /** Relecture silencieuse après une écriture : l'écran reste en place. */
  const refresh = useCallback(async () => {
    try {
      await fetchAll();
    } catch {
      // La prochaine action, ou « Réessayer », relira les données.
    }
  }, [fetchAll]);

  useEffect(() => {
    alive.current = true;
    reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  // Photos connues : celles de l'application et celles fournies avec la tour (base neuve comprise).
  const embedded = useMemo(() => embeddedAssetsOf(settings?.compat), [settings?.compat]);
  const photoOf = useCallback<DataValue['photoOf']>(
    (p, size = 'thumb') => {
      if (p.photo_url) return p.photo_url;
      if (p.photo_asset && embedded.includes(p.photo_asset)) {
        return size === 'thumb' ? `/produce/thumb/${p.photo_asset}.webp` : `/produce/${p.photo_asset}.webp`;
      }
      return null;
    },
    [embedded],
  );

  const artOf = useCallback<DataValue['artOf']>(
    (c) => {
      if (c.image_url) return { src: c.image_url, ratio: c.image_ratio || 1 };
      const p = products.find((x) => x.id === c.illustration_product);
      const src = p ? photoOf(p, 'thumb') : null;
      return { src, ratio: src && p ? p.photo_ratio || 1 : 1 };
    },
    [products, photoOf],
  );

  const filterOf = useCallback<DataValue['filterOf']>(
    (id) => {
      const saved = settings?.filters?.[id];
      let base: { src: string | null; ratio: number } = { src: '/categories/tout.webp', ratio: 1.018 };
      if (id === 'saison') {
        // Comme dans l'application : « De saison » montre un produit réellement de saison ce mois-ci.
        const month = currentMonth();
        const p = products.find((x) => !x.archived && x.available && x.months.includes(month) && x.months.length < 12 && photoOf(x));
        base = { src: p ? photoOf(p) : null, ratio: p?.photo_ratio ?? 1 };
      }
      return {
        label: saved?.label?.trim() || (id === 'tout' ? 'Tout' : 'De saison'),
        src: saved?.image_url ?? base.src,
        ratio: saved?.image_url ? saved.image_ratio || 1 : base.ratio,
        base,
      };
    },
    [settings, products, photoOf],
  );

  const issuesOf = useCallback(
    (p: Product) =>
      completeness(p, {
        embeddedAssets: embedded,
        appCategoryIds: settings?.compat?.categoryIds,
        rules: settings?.rules,
      }),
    [settings, embedded],
  );

  const categoryLabel = useCallback(
    (id: string) => categories.find((c) => c.id === id)?.label ?? id,
    [categories],
  );

  const pendingRefs = useMemo(() => {
    const out: DataValue['pendingRefs'] = [];
    for (const c of categories) {
      if (c._seal && c._seal !== 'ok') out.push({ ref: `categories:${c.id}`, label: `Rayon « ${c.label} »`, state: c._seal });
    }
    for (const p of products) {
      if (p._seal && p._seal !== 'ok') out.push({ ref: `products:${p.id}`, label: p.name, state: p._seal });
    }
    const names: Record<string, string> = {
      rules: 'Règles de quantité',
      compat: 'Compatibilité avec l’application',
      link: 'État du branchement',
      audience: 'Rayons visibles par les grossistes et importateurs',
      filters: 'Filtres de l’accueil (Tout, De saison)',
      missing: 'Message des produits introuvables',
    };
    for (const [key, state] of Object.entries(settings?.seals ?? {})) {
      if (state !== 'ok') out.push({ ref: `settings:${key}`, label: names[key] ?? key, state });
    }
    return out;
  }, [products, categories, settings]);

  const value: DataValue = {
    products,
    categories,
    settings,
    activity,
    loading,
    error,
    reload,
    photoOf,
    artOf,
    filterOf,
    issuesOf,
    categoryLabel,
    pendingRefs,

    createProduct: async (input) => {
      guard();
      const row = await api<Product>('/api/products', { method: 'POST', body: input });
      setProducts((list) => [...list, row]);
      refresh();
      return row;
    },
    updateProduct: async (id, input, expected) => {
      guard();
      const row = await api<Product>('/api/products', {
        method: 'PUT',
        body: { ...input, id, expected_updated_at: expected, full: true },
      });
      setProducts((list) => list.map((p) => (p.id === id ? row : p)));
      refresh();
      return row;
    },
    bulkUpdate: async (updates) => {
      guard();
      const { results } = await api<{ results: BulkResult[] }>('/api/products', { method: 'PUT', body: { updates } });
      const rows = new Map(results.filter((r) => r.ok && r.row).map((r) => [r.id, r.row as Product]));
      if (rows.size > 0) setProducts((list) => list.map((p) => rows.get(p.id) ?? p));
      refresh();
      return results;
    },
    deleteProduct: async (id) => {
      guard();
      await api('/api/products', { method: 'DELETE', body: { id } });
      setProducts((list) => list.filter((p) => p.id !== id));
      refresh();
    },

    createCategory: async (input) => {
      guard();
      const row = await api<Category>('/api/categories', { method: 'POST', body: input });
      await refresh();
      return row;
    },
    updateCategory: async (id, input) => {
      guard();
      const row = await api<Category>('/api/categories', { method: 'PUT', body: { ...input, id } });
      setCategories((list) => list.map((c) => (c.id === id ? row : c)));
      refresh();
      return row;
    },
    reorderCategories: async (ids) => {
      guard();
      await api('/api/categories', { method: 'PUT', body: { order: ids } });
      await refresh();
    },
    deleteCategory: async (id) => {
      guard();
      await api('/api/categories', { method: 'DELETE', body: { id } });
      await refresh();
    },

    saveRules: async (rules) => {
      guard();
      await api('/api/settings', { method: 'PUT', body: { key: 'rules', value: rules } });
      await refresh();
    },
    saveFilters: async (filters) => {
      guard();
      await api('/api/settings', { method: 'PUT', body: { key: 'filters', value: filters } });
      await refresh();
    },
    saveRequestMessage: async (message) => {
      guard();
      await api('/api/settings', { method: 'PUT', body: { key: 'missing', value: message } });
      await refresh();
    },
    saveLink: async (link) => {
      guard();
      await api('/api/settings', { method: 'PUT', body: { key: 'link', value: link } });
      await refresh();
    },
    sealRefs: async (refs) => {
      guard();
      const out = await api<{ sealed: string[]; refused: { ref: string; error: string }[] }>('/api/settings', {
        method: 'POST',
        body: { refs },
      });
      await refresh();
      return out;
    },
    uploadImage: async (kind, id, blob) => {
      guard();
      const fileBase64 = await blobToBase64(blob);
      const { url } = await api<{ url: string }>('/api/upload', {
        method: 'POST',
        body: { kind, id, fileBase64, contentType: blob.type },
      });
      return url;
    },
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData hors de DataProvider');
  return ctx;
}
