import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Reorder } from 'framer-motion';
import { useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  archiveOutline,
  arrowBack,
  arrowUndoOutline,
  cameraOutline,
  checkmarkCircle,
  ellipsisHorizontal,
  leafOutline,
  shieldCheckmarkOutline,
  star,
  trashOutline,
  warningOutline,
} from '../lib/glyphs';
import { useAuth } from '../contexts/AuthContext';
import { useData, type Product } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { Icon } from '../components/Icon';
import { CardPreview, CategoryRound, ProductArt, SeasonStrip } from '../components/catalog';
import { embeddedAssetsOf } from '../../shared/assets.js';
import { NewCategorySheet } from '../components/NewCategorySheet';
import { ZonePicker } from '../components/ZonePicker';
import { BenchContext, ProductPreview, Workbench, useBench } from '../components/Preview';
import {
  Chip,
  ConfirmSheet,
  Dock,
  EmptyState,
  ErrorPanel,
  Field,
  GhostButton,
  Notice,
  Page,
  PrimaryButton,
  RoundButton,
  Segmented,
  Sheet,
  SkeletonRows,
  Switch,
  TextArea,
} from '../components/ui';
import { ApiError, messageOf } from '../lib/api';
import { ago, amount, euro, parseNum, plural, seasonText, unitTiny } from '../lib/format';
import { prepareImage, type Prepared } from '../lib/image';
import { newPack, newRetailGroup, packInput, toForm, toInput, type Form, type PackForm } from '../lib/productForm';
import { Choice, CountryList, CountryPrices, RuleRow } from '../components/CountryPrices';
import { CURRENCIES, CURRENCY_SIGN, ZONE_LABEL, priceAlerts } from '../../shared/zones.js';
import { countryName } from '../../shared/catalog.js';
import { PackPhoto } from '../components/PackPhoto';
import { cx, glow } from '../lib/ui';
import {
  ALL_MONTHS,
  DEFAULT_RULES,
  PACK_DESCRIPTION_MAX,
  PACK_LIMIT,
  isKiloLabel,
  packContent,
  packRange,
  packRuleText,
  packTotal,
  pieceLabel,
  slugify,
  validatePackagings,
  validateZone,
  zoneLabel,
  validateProduct,
  type Errors,
  type Zone,
  type ProductInput,
} from '../../shared/catalog.js';
import { sp, useSpace } from '../lib/space';
import ProEditor from './ProEditor';

const BENCH_TITLE: Record<string, string> = {
  identite: 'Identité',
  photo: 'Photo et teinte',
  particuliers: 'Prix particuliers',
  emballages: 'Emballages',
  disponibilite: 'Disponibilité',
  apercu: 'Aperçu client',
};

/**
 * Bloc de la fiche. Avec `expand`, il peut s'ouvrir en grand : son contenu se déploie alors dans
 * l'atelier (tout l'écran, aperçu client à côté), puis reprend sa place une fois « Terminé ».
 */
function Section({ id, title, aside, children, expand }: { id: string; title: string; aside?: ReactNode; children: ReactNode; expand?: boolean }) {
  const bench = useBench();
  const active = !!expand && bench?.active === id;
  const body = (
    <section id={id} aria-labelledby={`${id}-titre`} className={cx('card mx-5 mt-3.5 scroll-mt-24 p-[18px]', active && 'mt-0')}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id={`${id}-titre`} className="font-display text-[19px] font-semibold leading-6">
          {title}
        </h2>
        <span className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {aside}
          {expand && bench && !active && (
            <button
              type="button"
              onClick={() => bench.open(id)}
              aria-label={`Agrandir « ${title} », avec l’aperçu client`}
              className="press flex h-11 items-center rounded-full border border-line bg-surface px-3.5 text-[12.5px] font-bold text-fg-dim"
            >
              Agrandir
            </button>
          )}
        </span>
      </div>
      {children}
    </section>
  );
  if (active && bench?.el) {
    return (
      <>
        <div className="card mx-5 mt-3.5 p-[18px] text-[13.5px] leading-5 text-fg-dim">
          <strong className="font-display text-[17px] font-semibold text-fg">{title}</strong> · ouvert en grand
        </div>
        {createPortal(body, bench.el)}
      </>
    );
  }
  return body;
}

function GroupError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" data-invalid="true" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
      {message}
    </p>
  );
}

function ToggleRow({ title, detail, checked, onChange, disabled }: { title: string; detail: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="mt-3.5 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold leading-5">{title}</p>
        <p className="mt-0.5 text-[13px] leading-[18px] text-fg-dim">{detail}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

export default function ProductEditor() {
  const { id } = useParams();
  const { products, categories, loading, error, reload } = useData();
  const navigate = useNavigate();
  const product = id ? (products.find((p) => p.id === id) ?? null) : null;
  const { space } = useSpace();

  if (error && products.length === 0) {
    return (
      <Page className="pt-10">
        <ErrorPanel message={error} onRetry={reload} />
      </Page>
    );
  }
  if (loading && products.length === 0) {
    return (
      <Page className="pt-16">
        <SkeletonRows rows={5} />
      </Page>
    );
  }
  if (id && !product) {
    return (
      <Page className="pt-12">
        <EmptyState
          title="Produit introuvable"
          body={`Aucune fiche ne porte l’identifiant « ${id} ». Elle a peut-être été supprimée.`}
          cta="Retour aux produits"
          onPress={() => navigate(sp('/produits'))}
        />
      </Page>
    );
  }
  if (categories.length === 0) {
    return (
      <Page className="pt-12">
        <EmptyState title="Aucun rayon" body="Un produit se range dans un rayon. Créez d’abord un rayon." cta="Créer un rayon" onPress={() => navigate(sp('/rayons'))} />
      </Page>
    );
  }
  // Espace Pros : sa propre fiche (statut, offres par groupe de pays, logistique, médias…).
  if (space === 'b2b') return <ProEditor key={product?.id ?? 'nouveau'} product={product} />;
  return <Editor key={product?.id ?? 'nouveau'} product={product} />;
}

function Editor({ product }: { product: Product | null }) {
  const isNew = !product;
  const { products, categories, settings, artOf, photoOf, createProduct, updateProduct, deleteProduct, uploadImage } = useData();
  const { isOwner } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const rules = settings?.rules ?? DEFAULT_RULES;

  const [initial, setInitial] = useState<Form>(() => toForm(product, ''));
  // Venu d'une demande de produit introuvable (`?nom=Papaye`) : le nom demandé est déjà écrit.
  const [params] = useSearchParams();
  const [form, setForm] = useState<Form>(() => {
    const wished = isNew ? (params.get('nom') ?? '').trim().replace(/\s+/g, ' ').slice(0, 60) : '';
    return wished ? { ...initial, name: wished, id: slugify(wished) } : initial;
  });
  const [pending, setPending] = useState<Prepared | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const [working, setWorking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [newCategory, setNewCategory] = useState(false);
  // Atelier : le bloc en cours de configuration prend tout l'écran, aperçu client à côté.
  const [bench, setBench] = useState<string | null>(null);
  const [benchEl, setBenchEl] = useState<HTMLDivElement | null>(null);
  const [focusPack, setFocusPack] = useState<string | null>(null);
  // Un seul emballage ouvert à la fois dans la configuration ; les autres tiennent en une ligne.
  const [openPack, setOpenPack] = useState<string | null>(null);
  const benchValue = useMemo(() => ({ active: bench, el: benchEl, open: setBench }), [bench, benchEl]);
  const leaving = useRef(false);

  const dirty = pending !== null || JSON.stringify(form) !== JSON.stringify(initial);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  });

  // La fiche a été relue depuis le serveur (après un enregistrement, ou par un collègue) : on suit,
  // sauf si une saisie est en cours — le serveur signalera alors le conflit à l'enregistrement.
  const stamp = product?.updated_at;
  useEffect(() => {
    if (!product || dirtyRef.current) return;
    const next = toForm(product, product.category);
    setInitial(next);
    setForm(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  // Fermeture ou rechargement de l'onglet avec des changements non enregistrés.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => () => {
    if (pending) URL.revokeObjectURL(pending.previewUrl);
  }, [pending]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );

  const input = useMemo(() => toInput(form), [form]);
  const check = useMemo(
    () =>
      validateProduct(input, {
        isNew,
        existingIds: products.map((p) => p.id),
        categoryIds: categories.map((c) => c.id),
        rules,
      }),
    [input, isNew, products, categories, rules],
  );
  const packCheck = useMemo(() => validatePackagings(input.packagings ?? []), [input]);
  const zoneCheck = useMemo(() => validateZone(input.zone), [input]);
  const errors = useMemo<Errors>(() => ({ ...check.errors, ...packCheck.errors, ...zoneCheck.errors }), [check, packCheck, zoneCheck]);
  const errorCount = Object.keys(errors).length;
  const err = (path: string) => serverErrors[path] ?? (attempted || touched[path] ? errors[path] : undefined);
  /** Une erreur affichée quelque part sous ce chemin : le bloc concerné ne reste alors jamais replié. */
  const shownUnder = (prefix: string) => Object.keys({ ...errors, ...serverErrors }).some((path) => path.startsWith(prefix) && !!err(path));
  const touch = (path: string) => setTouched((t) => (t[path] ? t : { ...t, [path]: true }));

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServerErrors((e) => (Object.keys(e).length ? {} : e));
  };
  // « Modifier » sur un emballage : sa configuration s'ouvre en grand, placée sur cet emballage.
  useEffect(() => {
    if (bench !== 'emballages' || !focusPack) return;
    const timer = window.setTimeout(() => document.getElementById(`emballage-${focusPack}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 160);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bench]);

  const setPack = (key: string, patch: Partial<PackForm>) => {
    setForm((f) => ({ ...f, packs: f.packs.map((k) => (k.key === key ? { ...k, ...patch } : k)) }));
    setFocusPack(key);
    setServerErrors((e) => (Object.keys(e).length ? {} : e));
  };
  const addPack = () => {
    const pack = newPack();
    setForm((f) => ({ ...f, packs: [...f.packs, pack] }));
    setFocusPack(pack.key);
    setOpenPack(pack.key);
  };
  const removePack = (key: string) => {
    const before = form.packs;
    const gone = before.find((k) => k.key === key);
    setForm((f) => ({ ...f, packs: f.packs.filter((k) => k.key !== key) }));
    // Un retrait se rattrape : rien n'est perdu par un toucher de trop.
    if (gone && (gone.label.trim() || gone.qty.trim() || Object.values(gone.prices).some((v) => v.trim()) || gone.photo)) {
      toast(`Emballage « ${gone.label.trim() || 'sans nom'} » retiré`, { action: { label: 'Annuler', onPress: () => setForm((f) => ({ ...f, packs: before })) } });
    }
  };
  /** Envoi d'une photo d'emballage, rangée sous le nom du produit. */
  const uploadPackPhoto = (blob: Blob) => {
    const id = form.id.trim();
    return uploadImage('packagings', /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 40 ? id : 'emballage', blob);
  };
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const prepared = await prepareImage(file);
      setPending(prepared);
    } catch (e) {
      setPhotoError(messageOf(e));
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const save = async (): Promise<boolean> => {
    setAttempted(true);
    if (errorCount > 0) {
      toast(`${plural(errorCount, 'point à corriger', 'points à corriger')} avant d’enregistrer`, { tone: 'error' });
      // Une erreur dans un emballage : on ouvre sa configuration, sinon elle resterait invisible.
      if (Object.keys(packCheck.errors).length > 0 && Object.keys(check.errors).length === 0) setBench('emballages');
      requestAnimationFrame(() => {
        document.querySelector('[aria-invalid="true"], [data-invalid="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return false;
    }
    setSaving(true);
    try {
      const payload = { ...check.value, packagings: packCheck.value, zone: zoneCheck.value } as ProductInput;
      if (pending) {
        payload.photo_url = await uploadImage('products', payload.id, pending.blob);
        payload.photo_ratio = pending.ratio;
      }
      const row = isNew ? await createProduct(payload) : await updateProduct(product.id, payload, product.updated_at);
      const next = toForm(row, row.category);
      setInitial(next);
      setForm(next);
      setPending(null);
      setTouched({});
      setAttempted(false);
      setServerErrors({});
      toast(isNew ? `Fiche « ${row.name} » créée${row.available ? '' : ' (masquée pour l’instant)'}` : `Fiche « ${row.name} » enregistrée`);
      if (isNew) {
        leaving.current = true;
        navigate(sp(`/produits/${row.id}`), { replace: true });
      }
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.fields) setServerErrors(e.fields);
      toast(`Non enregistré. ${messageOf(e)}`, { tone: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!product) return;
    setWorking(true);
    try {
      const row = await updateProduct(product.id, { ...toInput(initial), archived: !product.archived }, product.updated_at);
      toast(row.archived ? `Fiche « ${row.name} » archivée : elle n’est plus publiée` : `Fiche « ${row.name} » remise au catalogue`);
      setConfirm(null);
      setMenu(false);
    } catch (e) {
      toast(messageOf(e), { tone: 'error' });
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    if (!product) return;
    setWorking(true);
    try {
      await deleteProduct(product.id);
      toast(`Fiche « ${product.name} » supprimée définitivement`);
      leaving.current = true;
      navigate(sp('/produits'), { replace: true });
    } catch (e) {
      toast(messageOf(e), { tone: 'error' });
      setWorking(false);
    }
  };

  // ───── Affichage
  const embedded = embeddedAssetsOf(settings?.compat);
  const hasEmbedded = !!form.photo_asset && embedded.includes(form.photo_asset);
  const shownSrc = pending ? pending.previewUrl : photoOf(form, 'full');
  const shownRatio = pending ? pending.ratio : form.photo_ratio;
  const unknownCategory = !!form.category && !!settings?.compat && !settings.compat.categoryIds.includes(form.category);
  const sealIssue = product && product._seal && product._seal !== 'ok';

  const palette = useMemo(() => {
    const seen = new Set<string>();
    return products
      .map((p) => p.tint?.toUpperCase())
      .filter((t): t is string => !!t && !seen.has(t) && !!seen.add(t))
      .slice(0, 14);
  }, [products]);

  const presets = useMemo(() => {
    const seen = new Map<string, [string, string]>();
    for (const p of products) {
      if (p.retail?.unit === 'unit' && !seen.has(p.retail.unitLabel)) seen.set(p.retail.unitLabel, p.retail.noun);
    }
    return [...seen.entries()].slice(0, 10);
  }, [products]);

  const priceNumber = check.value.retail?.price ?? null;
  const zone: Zone = { mode: form.zoneMode, except: form.zoneExcept };
  const canSave = dirty || isNew || !!sealIssue;
  const saveLabel = isNew ? 'Créer le produit' : sealIssue && !dirty ? 'Valider cette fiche' : 'Enregistrer';

  // Ce que le client verrait, recalculé à chaque frappe.
  const shown = (n: number | null) => (n !== null && Number.isFinite(n) && n > 0 ? n : null);
  // Règle de vente au détail en clair, avec ses unités (kg, pièces, bottes…).
  const retailUnitWord = form.unit === 'kg' ? 'kilos' : form.nounMany.trim() || 'pièces';
  const retailRule = (() => {
    const r = form.sold ? check.value.retail : null;
    if (!r || !(r.step > 0) || errors['retail.step'] || errors['retail.min'] || errors['retail.max']) return '';
    const say = (n: number) => `${String(Math.round(n * 1000) / 1000).replace('.', ',')}\u00A0${r.unit === 'kg' ? 'kg' : n > 1 ? r.noun[1] || 'pièces' : r.noun[0] || 'pièce'}`;
    return `Le client commande de ${say(r.min ?? r.step)} à ${say(r.max ?? r.step * 20)}, par paliers de ${say(r.step)}.`;
  })();
  const previewProduct = {
    name: form.name,
    variety: form.variety,
    origin: form.origin,
    description: form.description,
    tint: form.tint,
    src: shownSrc,
    rayon: categories.find((c) => c.id === form.category)?.label ?? '',
    bio: form.bio,
    months: form.months,
    available: form.available,
    price: form.sold ? priceNumber : null,
    unit: form.unit === 'kg' ? 'le kg' : form.unitLabel,
    countryPrices: form.sold ? form.countryPrices.flatMap((g) => { const price = shown(parseNum(g.price)); return g.countries.length > 0 && price !== null ? [{ countries: g.countries, price }] : []; }) : [],
    retail: form.sold
      ? {
          unit: form.unit,
          step: shown(parseNum(form.step)) ?? (form.unit === 'kg' ? 0.5 : 1),
          min: shown(parseNum(form.min)),
          max: shown(parseNum(form.max)),
          noun: (form.unit === 'kg' ? ['kg', 'kg'] : [form.nounOne.trim() || 'pièce', form.nounMany.trim() || 'pièces']) as [string, string],
        }
      : null,
    kind: form.kind,
    packs: form.packs.map((k) => ({ ...packInput(k), id: k.key, qty: shown(parseNum(k.qty)), price: shown(parseNum(k.prices.EUR)), ...packRange({ step: parseNum(k.step), min: parseNum(k.min), max: parseNum(k.max) }) })),
    zone: { mode: form.zoneMode, except: form.zoneExcept },
  };
  // La règle : le prix au kilo ou à la pièce est le prix global ; un emballage a son propre prix,
  // pour l'emballage entier. Chaque emballage est comparé au prix global, où qu'on soit dans la fiche.
  // Alerte (non bloquante) : un prix qui semble saisi dans la mauvaise devise.
  const packAlerts = form.packs.map((k) => priceAlerts(packInput(k).prices)[0] ?? '');
  const alertNames = form.packs.filter((_, i) => packAlerts[i]).map((k) => `« ${k.label.trim() || 'Emballage sans nom'} »`);

  /** Un emballage en une ligne : sa photo, son nom, son contenu et son prix, sa règle — « Modifier » ouvre sa configuration. */
  const packRow = (k: PackForm, i: number) => {
    const v = { ...packInput(k), qty: shown(parseNum(k.qty)), price: shown(parseNum(k.prices.EUR)) };
    const bad = Object.keys(errors).some((path) => path.startsWith(`packagings.${i}.`));
    const content = packContent(v);
    const name = k.label.trim() || 'Emballage sans nom';
    const pricesText = CURRENCIES.map((c) => (v.prices?.[c] ? amount(v.prices[c] as number, c) : '—')).join(' · ');
    const where = k.countries.mode === 'zone' ? 'Toutes les zones avec un prix' : `${k.countries.mode === 'pays' ? 'Seulement' : 'Sauf'} : ${k.countries.list.map(countryName).join(', ') || 'à choisir'}`;
    return (
      <RuleRow
        key={k.key}
        id={`emballage-${k.key}`}
        title={name}
        muted={!k.label.trim()}
        thumb={k.photo || null}
        summary={[content || 'Contenu à préciser', pricesText, where, bad ? '' : packRuleText(v)].filter(Boolean).join(' · ')}
        extra={
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, packs: f.packs.map((x) => ({ ...x, isDefault: x.key === k.key ? !k.isDefault : false })) }))}
            aria-pressed={k.isDefault}
            aria-label={k.isDefault ? `${name} : emballage par défaut` : `Choisir ${name} comme emballage par défaut`}
            className={cx('press flex min-h-11 items-center rounded-full px-2.5 text-[13.5px] font-bold', k.isDefault ? 'text-star' : 'text-fg-faint')}
          >
            {k.isDefault ? '★ Par défaut' : '☆'}
          </button>
        }
        chips={
          !k.available || bad || packAlerts[i] || !k.photo ? (
            <>
              {!k.photo && <Chip tone="star">Photo à ajouter</Chip>}
              {!k.available && <Chip>Masqué</Chip>}
              {bad && <Chip tone="danger">À corriger</Chip>}
              {!bad && packAlerts[i] && <Chip tone="star">Prix à vérifier</Chip>}
            </>
          ) : undefined
        }
        onEdit={() => {
          setFocusPack(k.key);
          setOpenPack(k.key);
          setBench('emballages');
        }}
        editLabel={`Modifier l’emballage ${name}`}
        onRemove={() => removePack(k.key)}
        removeLabel={`Retirer l’emballage ${name}`}
      />
    );
  };

  return (
    <BenchContext.Provider value={benchValue}>
    <Page>
      {/* Modifications non enregistrées : la mise à jour automatique attend (components/Update.tsx). */}
      <span hidden data-dirty={dirty ? 'true' : undefined} />
      {/* Barre du haut : en tête de page seulement. Elle ne suit pas le défilement, pour laisser toute la place à la fiche. */}
      <div
        data-barre="haut"
        className="relative z-20 flex items-center justify-between gap-3 px-[18px] pb-2"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 10px) + 6px)' }}
      >
        <RoundButton icon={arrowBack} label="Retour" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(sp('/produits')))} />
        <h1 className="min-w-0 flex-1 truncate text-center font-display text-[18px] font-semibold">
          {isNew ? form.name || 'Nouveau produit' : form.name || product.name}
        </h1>
        {isNew ? <span className="w-[46px]" /> : <RoundButton icon={ellipsisHorizontal} label="Archiver ou supprimer" onClick={() => setMenu(true)} />}
      </div>

      <div className="page-in mx-auto max-w-[720px] lg:max-w-[1180px]">
        {/* Scène : la photo détourée sur sa teinte, entre les feuilles du décor. */}
        <div className="relative mx-auto h-[236px] overflow-hidden">
          <span className="absolute left-1/2 top-0 h-[250px] w-[120%] max-w-[560px] -translate-x-1/2" style={{ backgroundImage: glow(form.tint || '#7AAA2C', 0.42) }} />
          <img src="/decor/leaf-blur.webp" alt="" className="drift absolute left-[5%] top-[18%] w-[58px] opacity-60" style={{ ['--r' as string]: '-24deg', ['--d' as string]: '9s' }} />
          <img src="/decor/leaf.webp" alt="" className="drift absolute right-[7%] top-[10%] w-[46px] opacity-90" style={{ ['--r' as string]: '38deg', ['--d' as string]: '7.5s' }} />
          <img src="/decor/leaf-soft.webp" alt="" className="drift absolute bottom-[14%] left-[14%] w-[34px] opacity-70" style={{ ['--r' as string]: '140deg', ['--d' as string]: '8.5s' }} />
          <div className="float absolute inset-0 grid place-items-center">
            <ProductArt product={form} size={206} variant="full" halo={0} src={shownSrc} ratio={shownRatio} eager />
          </div>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={photoBusy}
            className="press absolute bottom-2 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full border border-line-strong bg-bar/90 px-4 text-[13.5px] font-bold backdrop-blur"
          >
            {photoBusy ? <span className="spinner" style={{ width: 15, height: 15 }} /> : <Icon src={cameraOutline} size={17} />}
            {photoBusy ? 'Préparation…' : shownSrc ? 'Remplacer la photo' : 'Ajouter une photo'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/webp,image/jpeg"
            className="sr-only"
            tabIndex={-1}
            aria-label="Choisir une photo du produit"
            onChange={(e) => pickPhoto(e.target.files?.[0])}
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 px-5 pt-3">
          <Chip tone={form.available ? 'leaf' : 'neutral'}>{form.available ? 'Visible' : 'Masqué'}</Chip>
          <button
            type="button"
            onClick={() => document.getElementById('pays')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            aria-label={`Pays où le produit s’affiche : ${zoneLabel({ mode: form.zoneMode, except: form.zoneExcept })}. Modifier.`}
            className="press flex min-h-11 items-center"
          >
            <Chip tone={form.zoneMode === 'all' ? 'neutral' : 'leaf'}>Pays · {zoneLabel({ mode: form.zoneMode, except: form.zoneExcept }, true)}</Chip>
          </button>
          {form.archived && <Chip>Archivé</Chip>}
          {form.is_example && <Chip>Données d’exemple</Chip>}
          {!isNew && <Chip>{form.id}</Chip>}
        </div>

        {sealIssue && (
          <div className="mx-5 mt-4">
            <Notice tone="danger" icon={shieldCheckmarkOutline} title="Fiche à valider — non publiée">
              {product._seal === 'missing'
                ? 'Cette fiche vient de l’import initial ou a été écrite directement dans la base. Vérifiez-la, puis enregistrez : elle sera alors publiée.'
                : 'Cette fiche a été modifiée en dehors de l’administration depuis sa dernière validation. Vérifiez chaque information, puis enregistrez.'}
            </Notice>
          </div>
        )}
        {form.archived && (
          <div className="mx-5 mt-4">
            <Notice icon={archiveOutline} title="Produit archivé">
              Il n’est plus publié à l’application, mais sa fiche est conservée. Le menu en haut à droite permet de le remettre au catalogue.
            </Notice>
          </div>
        )}

        {/* Qui voit le produit, et où : les deux réglages côte à côte, dès l'ouverture de la fiche. */}
        <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-1">
        <div className="min-w-0">
        {/* ───── Commercialisation : trois interrupteurs, à la création comme ensuite. */}
        {/* ───── Particuliers : produit emballé (vendu par ses emballages) ou frais (au kilo, à la pièce) */}
        <Section id="b2c" title="Particuliers" aside={<Chip tone="leaf">{form.kind === 'emballe' ? 'Emballé' : 'Frais'}</Chip>}>
          <div className="mt-3">
            <Choice
              label="Type de produit pour les particuliers"
              value={form.kind}
              onChange={(kind) => {
                set('kind', kind);
                if (kind === 'emballe') setBench('emballages');
              }}
              options={[
                ['emballe', 'Emballé'],
                ['frais', 'Frais'],
              ]}
            />
          </div>
          <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">
            {form.kind === 'emballe' ? 'Vendu uniquement par ses emballages, à leur prix.' : 'Vendu au kilo ou à la pièce, au prix particulier.'}
          </p>
        </Section>

        <Section id="commercialisation" title="Commercialisation" aside={<Chip tone={form.available ? 'leaf' : 'neutral'}>{form.available ? 'Commercialisé' : 'Non commercialisé'}</Chip>}>
          <div>
            <ToggleRow
              title="Produit commercialisé"
              detail={form.available ? 'Le produit apparaît dans l’application.' : 'Éteint : personne ne voit ce produit, quels que soient les deux autres interrupteurs.'}
              checked={form.available}
              onChange={(v) => set('available', v)}
            />
            {form.kind === 'frais' && <ToggleRow
              title="Pour les particuliers"
              detail={
                !form.sold
                  ? 'Éteint : les particuliers ne voient pas ce produit.'
                  : priceNumber === null
                    ? 'Allumé, mais sans prix : fixez-le dans « Prix particuliers » pour qu’il leur soit proposé.'
                    : 'Les particuliers voient ce produit et peuvent le commander.'
              }
              checked={form.sold}
              onChange={(v) => {
                set('sold', v);
                // Allumer ce public ouvre la fenêtre de ses prix : ils lui sont propres.
                if (v) setBench('particuliers');
              }}
            />}
          </div>
          {form.available && form.months.length === 0 && (
            <p className="mt-3 px-1 text-[12.5px] leading-[18px] text-star">Pour commercialiser ce produit, indiquez aussi ses mois de disponibilité, plus bas.</p>
          )}
          {form.available && form.kind === 'frais' && !form.sold && (
            <p className="mt-3 px-1 text-[12.5px] leading-[18px] text-star">Commercialisé, mais pas pour les particuliers : allumez « Pour les particuliers ».</p>
          )}
        </Section>

        </div>
        <div className="min-w-0">
        {/* ───── Pays : où le produit s'affiche. Trois niveaux, au choix dès la création. */}
        <Section id="pays" expand title="Pays" aside={<Chip tone={form.zoneMode === 'all' ? 'neutral' : 'leaf'}>{zoneLabel({ mode: form.zoneMode, except: form.zoneExcept }, true)}</Chip>}>
          <p className="mb-3 mt-2 text-[13.5px] leading-5 text-fg-dim">Dans quels pays ce produit s’affiche-t-il ?</p>
          <ZonePicker
            mode={form.zoneMode}
            except={form.zoneExcept}
            error={err('zone')}
            onChange={(next) => {
              setForm((f) => ({ ...f, zoneMode: next.mode, zoneExcept: next.except }));
              setTouched((t) => ({ ...t, zone: true }));
              setServerErrors((e) => (Object.keys(e).length ? {} : e));
            }}
          />
        </Section>
        </div>
        </div>

        {/* ───── Rayon : à quel rayon appartient le produit. Aucun n'est choisi d'avance à la création. */}
        <Section
          id="rayon"
          title="Rayon du produit"
          aside={<Chip tone={form.category ? 'leaf' : 'star'}>{form.category ? (categories.find((c) => c.id === form.category)?.label ?? form.category) : 'À choisir'}</Chip>}
        >
          <p className="mt-2 text-[13.5px] leading-5 text-fg-dim">
            {form.category ? 'Le produit est rangé dans ce rayon. Touchez-en un autre pour le déplacer.' : 'À quel rayon appartient ce produit ? Fruits, légumes, agrumes… touchez le bon rayon.'}
          </p>
          <div className="no-scrollbar -mx-[18px] mt-4 flex gap-x-1.5 overflow-x-auto px-3 lg:flex-wrap lg:gap-y-4 lg:overflow-visible" role="radiogroup" aria-label="Rayon du produit">
            {categories.map((c) => {
              const art = artOf(c);
              return <CategoryRound key={c.id} src={art.src} ratio={art.ratio} label={c.label} active={form.category === c.id} onClick={() => set('category', c.id)} roomy />;
            })}
            {/* Le rayon n'existe pas encore : on le crée ici, avec sa photo, sans quitter la fiche. */}
            <button type="button" onClick={() => setNewCategory(true)} aria-label="Créer un nouveau rayon" className="press flex w-[84px] shrink-0 flex-col items-center gap-2 lg:w-[92px]">
              <span className="grid h-[58px] w-[58px] place-items-center rounded-full border border-dashed border-leaf/60 text-[26px] font-bold leading-none text-leaf">+</span>
              <span className="w-full text-center text-[12px] font-bold leading-[15px] text-leaf lg:text-[13px] lg:leading-4">Nouveau rayon</span>
            </button>
          </div>
          <GroupError message={err('category')} />
          {unknownCategory && (
            <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-star">Ce rayon n’existe pas encore dans l’application d’achat : tant qu’elle n’est pas mise à jour, elle rangera ce produit dans « Fruits ».</p>
          )}
          <p className="mt-2.5 px-1 text-[12.5px] leading-[18px] text-fg-faint">Le rayon n’existe pas encore ? Touchez « Nouveau rayon » pour le créer ici, avec sa photo.</p>
          <NewCategorySheet open={newCategory} onClose={() => setNewCategory(false)} onCreated={(id) => set('category', id)} />
        </Section>

        {/* Ordinateur : la fiche se déploie sur deux colonnes. */}
        <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-1">
          <div className="min-w-0">
        {/* ───── Identité */}
        <Section id="identite" expand title="Identité">
          <Field
            label="Nom"
            value={form.name}
            placeholder="Mangue séchée"
            maxLength={80}
            onValue={(v) => {
              setForm((f) => ({ ...f, name: v, id: isNew && !f.idTouched ? slugify(v) : f.id }));
              setServerErrors({});
            }}
            onBlur={() => touch('name')}
            error={err('name')}
          />
          {isNew && (
            <Field
              label="Identifiant"
              value={form.id}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="mangue-sechee"
              maxLength={40}
              onValue={(v) => setForm((f) => ({ ...f, id: v.toLowerCase(), idTouched: true }))}
              onBlur={() => touch('id')}
              error={err('id')}
              hint="Référence du produit dans l’application (paniers, favoris, commandes). Il ne pourra plus être modifié ensuite."
            />
          )}
          <Field label="Variété" optional value={form.variety} placeholder="Kent" maxLength={80} onValue={(v) => set('variety', v)} error={err('variety')} />


          <Field label="Origine" value={form.origin} placeholder="Région ou pays" maxLength={80} onValue={(v) => set('origin', v)} error={err('origin')} hint="Affichée sous le nom, sur chaque carte du catalogue." />
          <TextArea
            label="Description"
            value={form.description}
            maxLength={1300}
            placeholder="Goût, texture, idées d’utilisation…"
            onValue={(v) => set('description', v)}
            error={err('description')}
            hint={`${form.description.trim().length} / 1 200 caractères`}
          />
          <ToggleRow title="Produit bio" detail="Affiche la mention « Bio » sur la fiche." checked={form.bio} onChange={(v) => set('bio', v)} />
        </Section>

        {/* ───── Emballages */}
        <Section id="emballages" expand title="Emballages" aside={<Chip>{plural(form.packs.length, 'emballage', 'emballages')}</Chip>}>
          {bench !== 'emballages' ? (
            <>
              <p className="mt-2 text-[13.5px] leading-5 text-fg-dim">Box, carton, sachet… Chaque emballage a un contenu fixe et un prix pour l’emballage entier, dans chaque devise où il est vendu (F CFA, €, $). Le premier de la liste, ou celui marqué ★, s’ouvre par défaut.</p>
              {form.packs.length > 0 && (
                // Glisser une ligne pour réordonner : le premier emballage proposé sert de défaut.
                <Reorder.Group axis="y" values={form.packs} onReorder={(packs) => setForm((f) => ({ ...f, packs }))} className="mt-3 flex flex-col gap-2" as="div">
                  {form.packs.map((k, i) => (
                    <Reorder.Item key={k.key} value={k} as="div" className="cursor-grab active:cursor-grabbing">
                      {packRow(k, i)}
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              )}
              <GhostButton
                className="mt-3 w-full"
                tone="leaf"
                label={form.packs.length > 0 ? 'Configurer les emballages' : 'Ajouter un emballage'}
                onClick={() => {
                  if (form.packs.length === 0) addPack();
                  setBench('emballages');
                }}
              />
            </>
          ) : (
            <>
              <p className="mt-2 rounded-2xl border border-leaf/30 bg-leaf-wash px-3.5 py-2.5 text-[13px] leading-[19px]" data-regle="prix">
                <span className="font-extrabold text-leaf">Règle.</span> Le prix au kilo ou à la pièce est le prix global du produit : il se règle dans « Prix particuliers ». Un emballage, lui, a un contenu fixe et un prix fixe pour l’emballage entier.
              </p>
              {form.packs.map((k, i) => {
                // Replié : une ligne. Ouvert — ou à corriger : sa configuration complète.
                if (openPack !== k.key && !shownUnder(`packagings.${i}.`)) {
                  return (
                    <div key={k.key} className="mt-2">
                      {packRow(k, i)}
                    </div>
                  );
                }
                const v = { ...packInput(k), qty: shown(parseNum(k.qty)), price: shown(parseNum(k.prices.EUR)) };
                const range = packRange(v);
                const ruleBad = ['step', 'min', 'max'].some((f) => errors[`packagings.${i}.${f}`]);
                const priceAlert = packAlerts[i];
                const low = packTotal(v, range.min);
                const high = range.max !== null ? packTotal(v, range.max) : '';
                const head = 'mb-0 mt-5 text-[12.5px] font-extrabold uppercase tracking-[0.08em] text-fg-faint';
                return (
                  <div
                    key={k.key}
                    id={`emballage-${k.key}`}
                    className="mt-2 rounded-[22px] border border-leaf/50 bg-black/20 p-3.5"
                    onFocusCapture={() => setFocusPack(k.key)}
                    data-ouvert="true"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="shrink-0 whitespace-nowrap text-[12.5px] font-extrabold uppercase tracking-[0.08em] text-fg-faint">Emballage {i + 1}</p>
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        <GhostButton compact tone="danger" label="Retirer" onClick={() => removePack(k.key)} aria-label={`Retirer l’emballage ${i + 1}`} />
                        <GhostButton compact label="Terminé" onClick={() => setOpenPack(null)} aria-label={`Replier l’emballage ${i + 1}`} />
                      </span>
                    </div>
                    <Field
                      label="Nom de l’emballage"
                      value={k.label}
                      maxLength={40}
                      placeholder="Box de 4 kg"
                      onValue={(val) => setPack(k.key, { label: val })}
                      onBlur={() => touch(`packagings.${i}.label`)}
                      error={err(`packagings.${i}.label`)}
                    />
                    <PackPhoto
                      label="Emballage seul"
                      value={k.photo}
                      onChange={(photo) => setPack(k.key, { photo })}
                      upload={uploadPackPhoto}
                      error={err(`packagings.${i}.photo_url`)}
                      hint="La photo de l’emballage, montrée dans la liste des emballages."
                    />
                    <PackPhoto
                      label="Produit dans l’emballage"
                      value={k.preview}
                      onChange={(preview) => setPack(k.key, { preview })}
                      upload={uploadPackPhoto}
                      error={err(`packagings.${i}.preview_url`)}
                      hint="Le grand aperçu de la fiche quand le client choisit cet emballage."
                    />
                    <TextArea
                      label="Description de l’emballage"
                      optional
                      value={k.description}
                      maxLength={PACK_DESCRIPTION_MAX}
                      className="!min-h-[112px]"
                      placeholder="Pot en verre refermable de 200 g : la poudre reste à l’abri de l’humidité, prête à doser à la cuillère."
                      onValue={(val) => setPack(k.key, { description: val })}
                      onBlur={() => touch(`packagings.${i}.description`)}
                      error={err(`packagings.${i}.description`)}
                      hint={`${k.description.trim().length} / ${PACK_DESCRIPTION_MAX} · affichée sur la fiche du produit, au-dessus de sa description, quand le client choisit cet emballage.`}
                    />

                    {/* 1. Ce qu'il y a dans UN emballage */}
                    <p className={head}>Contenu d’un emballage</p>
                    <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                      <Field
                        label="Quantité contenue"
                        inputMode="decimal"
                        placeholder="4"
                        suffix={k.unit === 'piece' ? 'pièces' : k.unit}
                        className="pr-[74px]"
                        value={k.qty}
                        onValue={(val) => setPack(k.key, { qty: val })}
                        onBlur={() => touch(`packagings.${i}.qty`)}
                        error={err(`packagings.${i}.qty`)}
                      />
                      <div>
                        <p className="mb-[7px] mt-4 text-[13px] font-semibold text-fg-dim">Unité du contenu</p>
                        <Segmented
                          label={`Unité du contenu de l’emballage ${i + 1}`}
                          full
                          value={k.unit}
                          onChange={(u) => setPack(k.key, { unit: u })}
                          options={[
                            { value: 'kg', label: 'kg' },
                            { value: 'g', label: 'g' },
                            { value: 'piece', label: 'pièces' },
                          ]}
                        />
                      </div>
                    </div>
                    <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">Obligatoire. Ce qu’il y a dans un seul emballage : 4 kg de fruits, 500 g, 6 pièces…</p>

                    {/* 2. Son prix */}
                    <p className={head}>Prix</p>
                    <p className="mt-1 px-1 text-[12.5px] leading-[18px] text-fg-faint">Le prix de l’emballage entier, dans chaque zone. Case vide : non vendu dans cette zone.</p>
                    <div className="grid grid-cols-1 gap-x-2.5 sm:grid-cols-3">
                      {CURRENCIES.map((c) => (
                        <Field
                          key={c}
                          label={`${ZONE_LABEL[c]} — ${CURRENCY_SIGN[c]}`}
                          compact
                          inputMode={c === 'XOF' ? 'numeric' : 'decimal'}
                          placeholder="—"
                          suffix={CURRENCY_SIGN[c]}
                          value={k.prices[c]}
                          onValue={(val) => setPack(k.key, { prices: { ...k.prices, [c]: val } })}
                          onBlur={() => touch(`packagings.${i}.prices.${c}`)}
                          error={err(`packagings.${i}.prices.${c}`)}
                          className="pr-[64px]"
                        />
                      ))}
                    </div>
                    <GroupError message={attempted ? errors[`packagings.${i}.prices`] : undefined} />
                    {priceAlert && (
                      <p role="status" className="mt-2.5 rounded-2xl border border-star/40 bg-star/10 px-3.5 py-2.5 text-[13px] font-semibold leading-[19px] text-star" data-alerte="devise">
                        À vérifier : {priceAlert}
                      </p>
                    )}

                    {/* 3. Combien d'emballages le client commande */}
                    <p className={head}>Nombre d’emballages par commande</p>
                    <div className="grid grid-cols-3 gap-2.5">
                      <Field label="Palier" inputMode="numeric" compact placeholder="1" value={k.step} onValue={(val) => setPack(k.key, { step: val })} onBlur={() => touch(`packagings.${i}.step`)} error={err(`packagings.${i}.step`)} />
                      <Field label="Minimum" inputMode="numeric" compact placeholder="Vide" value={k.min} onValue={(val) => setPack(k.key, { min: val })} onBlur={() => touch(`packagings.${i}.min`)} error={err(`packagings.${i}.min`)} />
                      <Field label="Maximum" inputMode="numeric" compact placeholder="Aucun" value={k.max} onValue={(val) => setPack(k.key, { max: val })} onBlur={() => touch(`packagings.${i}.max`)} error={err(`packagings.${i}.max`)} />
                    </div>
                    {!ruleBad && (
                      <p className="mt-3 rounded-2xl bg-black/20 px-3.5 py-2.5 text-[13px] font-semibold leading-[19px]" data-regle="emballage">
                        {packRuleText(v)}
                        {low && <span className="font-medium text-fg-dim"> — soit {high ? `de ${low} à ${high}` : `${low} au minimum`}.</span>}
                      </p>
                    )}
                    <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">
                      Comptés en emballages entiers, jamais en kilos. Le palier est le nombre ajouté à chaque appui sur « + ». Minimum vide : un palier. Maximum vide : aucun maximum.
                    </p>

                    <p className="mb-[7px] mt-5 text-[13px] font-semibold text-fg-dim">Proposé à</p>
                    <Segmented
                      label={`Public de l’emballage ${i + 1}`}
                      full
                      value={k.audience}
                      onChange={(a) => setPack(k.key, { audience: a })}
                      options={[
                        { value: 'tous', label: 'Tous' },
                        { value: 'particuliers', label: 'Particuliers' },
                        { value: 'pros', label: 'Pros' },
                      ]}
                    />
                    <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">
                      {k.audience === 'pros'
                        ? 'Les professionnels commandent par offres (avion, bateau) : l’application ne leur montre pas d’emballage. Réservé aux pros, cet emballage n’est donc proposé à personne pour l’instant.'
                        : 'Dans l’application, les emballages sont proposés aux particuliers ; les professionnels commandent par offres (avion, bateau).'}
                    </p>
                    <ToggleRow
                      title={`Emballage ${i + 1} proposé`}
                      detail={k.available ? 'Visible sur la fiche du produit.' : 'Masqué : conservé ici, invisible pour les clients.'}
                      checked={k.available}
                      onChange={(val) => setPack(k.key, { available: val })}
                    />

                    {/* 4. Où cet emballage est vendu : seulement là où il a un prix */}
                    <p className="mb-[7px] mt-5 text-[13px] font-semibold text-fg-dim">Pays</p>
                    <Segmented
                      label={`Pays de l’emballage ${i + 1}`}
                      full
                      value={k.countries.mode}
                      onChange={(mode) => setPack(k.key, { countries: { ...k.countries, mode } })}
                      options={[
                        { value: 'zone', label: 'Toutes les zones avec un prix' },
                        { value: 'pays', label: 'Seulement ces pays' },
                        { value: 'sauf', label: 'Sauf ces pays' },
                      ]}
                    />
                    {k.countries.mode !== 'zone' && (
                      <div className="mt-2.5">
                        <CountryList
                          noun="emballage"
                          countries={k.countries.list}
                          taken={new Set()}
                          label={`Pays de l’emballage ${i + 1}`}
                          onChange={(list) => setPack(k.key, { countries: { ...k.countries, list } })}
                        />
                      </div>
                    )}
                    <GroupError message={err(`packagings.${i}.countries`)} />
                    <ToggleRow
                      title="Emballage par défaut"
                      detail={k.isDefault ? 'Sélectionné à l’ouverture de la fiche.' : 'Sinon, le premier emballage proposé au client.'}
                      checked={k.isDefault}
                      onChange={(val) => setForm((f) => ({ ...f, packs: f.packs.map((x) => ({ ...x, isDefault: x.key === k.key ? val : false })) }))}
                    />
                  </div>
                );
              })}
              <GroupError message={attempted ? errors.packagings : undefined} />
              <GhostButton className="mt-3 w-full" tone="leaf" label="Ajouter un emballage" disabled={form.packs.length >= PACK_LIMIT} onClick={addPack} />
            </>
          )}
        </Section>

        {/* ───── Photo et teinte */}
        <Section id="photo" expand title="Photo et teinte">
          <p className="mt-2 text-[13.5px] leading-5 text-fg-dim">
            {pending
              ? 'Nouvelle photo prête : elle sera envoyée à l’enregistrement de la fiche.'
              : form.photo_url
                ? 'Photo publiée depuis l’administration.'
                : hasEmbedded
                  ? `Photo embarquée dans l’application (assets/produce/${form.photo_asset}.webp).`
                  : 'Aucune photo : l’application afficherait une feuille à la place du produit.'}
          </p>
          {pending && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip tone={pending.cutout ? 'leaf' : 'star'} icon={pending.cutout ? checkmarkCircle : warningOutline}>
                {pending.cutout ? 'Fond transparent' : 'Fond plein : non détourée'}
              </Chip>
              <Chip>
                {pending.width} × {pending.height} px · {Math.max(1, Math.round(pending.bytes / 1024))} Ko
              </Chip>
              {pending.trimmed && <Chip>Marges rognées</Chip>}
            </div>
          )}
          {pending && !pending.cutout && (
            <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-star">
              Cette image a un fond : dans l’application, le produit apparaîtra dans un rectangle au lieu de flotter sur sa teinte. Préférez un PNG ou un WebP détouré.
            </p>
          )}
          {photoError && <GroupError message={photoError} />}
          <GroupError message={err('photo_url')} />
          <div className="mt-3.5 flex flex-wrap gap-2.5">
            <GhostButton compact label={shownSrc ? 'Choisir une autre photo' : 'Choisir une photo'} icon={cameraOutline} onClick={() => fileInput.current?.click()} disabled={photoBusy} />
            {pending && <GhostButton compact label="Annuler ce choix" icon={arrowUndoOutline} onClick={() => setPending(null)} />}
            {!pending && form.photo_url && (
              <GhostButton compact label={hasEmbedded ? 'Revenir à la photo embarquée' : 'Retirer la photo'} icon={arrowUndoOutline} onClick={() => set('photo_url', null)} />
            )}
          </div>
          <p className="mt-3 px-1 text-[12.5px] leading-[18px] text-fg-faint">
            PNG ou WebP sur fond transparent. L’image est rognée au plus près du produit, réduite à 900 px et jamais déformée.
          </p>

          <p className="mb-2 mt-5 text-[13px] font-semibold text-fg-dim">Teinte d’ambiance</p>
          <div className="flex flex-wrap items-center gap-2.5" role="radiogroup" aria-label="Teinte d’ambiance de la fiche">
            {pending?.tint && (
              <button
                type="button"
                onClick={() => set('tint', pending.tint as string)}
                className="press flex min-h-11 items-center gap-2 rounded-full border border-leaf/50 pl-1.5 pr-3.5 text-[13px] font-bold text-leaf"
              >
                <span className="h-8 w-8 rounded-full border border-white/25" style={{ backgroundColor: pending.tint }} />
                D’après la photo
              </button>
            )}
            {palette.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={form.tint.toUpperCase() === t}
                aria-label={`Teinte ${t}`}
                onClick={() => set('tint', t)}
                className={cx('press press-deep grid h-11 w-11 place-items-center rounded-full border-2', form.tint.toUpperCase() === t ? 'border-fg' : 'border-transparent')}
              >
                <span className="h-8 w-8 rounded-full border border-white/20" style={{ backgroundColor: t }} />
              </button>
            ))}
            <label className="press relative flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line-strong pl-1.5 pr-3.5 text-[13px] font-bold">
              <span className="h-8 w-8 rounded-full border border-white/25" style={{ backgroundColor: form.tint }} />
              <span className="tabular uppercase">{form.tint}</span>
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.tint) ? form.tint : '#7AAA2C'} onChange={(e) => set('tint', e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Choisir une autre teinte" />
            </label>
          </div>
          <GroupError message={err('tint')} />
        </Section>

          </div>
          <div className="min-w-0">
        {/* ───── Particuliers */}
        {form.kind === 'frais' && (
        <Section id="particuliers" expand title="Prix particuliers" aside={<Chip tone={form.sold && priceNumber !== null ? 'leaf' : 'neutral'}>{!form.sold ? 'Non proposé' : priceNumber === null ? 'Prix à fixer' : form.countryPrices.length > 0 ? `${euro(priceNumber)} · ${plural(new Set(form.countryPrices.flatMap((g) => g.countries)).size, 'pays à part', 'pays à part')}` : euro(priceNumber)}</Chip>}>
          {/* Le choix « par kilo » ou « par pièce » : toujours visible, à la création comme ensuite. */}
          <p className="mb-[7px] mt-3.5 text-[13px] font-semibold text-fg-dim">Ce produit se vend</p>
          <Segmented
            label="Vente par kilo ou par pièce"
            full
            value={form.sold ? form.unit : ''}
            onChange={(u) => {
              setForm((f) =>
                u === 'unit'
                  ? // Vente à la pièce : le libellé ne reprend jamais « le kg ».
                    { ...f, sold: true, unit: 'unit', unitLabel: !f.nounOne || isKiloLabel(f.unitLabel) ? pieceLabel(f.nounOne) : f.unitLabel, nounOne: f.nounOne || 'pièce', nounMany: f.nounMany || 'pièces', step: '1' }
                  : // Vente au kilo : affichée « le kg » partout ; le libellé à la pièce est gardé en mémoire.
                    { ...f, sold: true, unit: 'kg', step: '0,5' },
              );
              setServerErrors((e) => (Object.keys(e).length ? {} : e));
            }}
            options={[
              { value: 'kg', label: 'Par kilo' },
              { value: 'unit', label: 'Par pièce' },
            ]}
          />
          <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">
            {!form.sold
              ? 'Aucun choix pour l’instant : touchez « Par kilo » ou « Par pièce » pour vendre ce produit aux particuliers.'
              : form.unit === 'kg'
                ? 'Prix global du produit, au kilogramme. Un box ou un carton a son propre prix, pour l’emballage entier : il se règle dans « Emballages ».'
                : `Prix global du produit, par ${form.nounOne.trim() || 'pièce'}. Un box ou un carton a son propre prix, pour l’emballage entier : il se règle dans « Emballages ».`}
          </p>
          {form.sold && (
            <>
              <Field
                label={form.unit === 'kg' ? 'Prix global par kilo' : `Prix global par ${form.nounOne.trim() || 'pièce'}`}
                inputMode="decimal"
                placeholder="Non fixé"
                suffix={form.unit === 'kg' ? '€ / kg' : '€'}
                value={form.price}
                onValue={(v) => set('price', v)}
                onBlur={() => touch('retail.price')}
                error={err('retail.price')}
                hint="Laissez vide tant que le prix n’est pas fixé : le produit ne sera pas proposé aux particuliers. Aucun prix n’est supposé."
                className="pr-[74px]"
              />
              {alertNames.length > 0 && (
                <p role="status" className="mt-2.5 rounded-2xl border border-star/40 bg-star/10 px-3.5 py-2.5 text-[13px] font-semibold leading-[19px] text-star" data-alerte="global">
                  À vérifier : avec ce prix global, {alertNames.join(', ')} {alertNames.length > 1 ? 'coûtent' : 'coûte'} autant ou moins qu’{form.unit === 'kg' ? 'un seul kilo' : 'une seule pièce'}. Le prix d’un emballage est celui de l’emballage entier.{' '}
                  <button type="button" className="underline underline-offset-2" onClick={() => { const key = form.packs[packAlerts.findIndex(Boolean)].key; setFocusPack(key); setOpenPack(key); setBench('emballages'); }}>
                    Corriger l’emballage
                  </button>
                </p>
              )}
              <CountryPrices
                groups={form.countryPrices}
                onChange={(countryPrices) => {
                  setForm((f) => ({ ...f, countryPrices }));
                  setServerErrors((e) => (Object.keys(e).length ? {} : e));
                }}
                make={newRetailGroup}
                base="retail.countryPrices"
                summary={(g) => {
                  const n = shown(parseNum(g.price));
                  return n !== null ? `${euro(n)} ${form.unit === 'kg' ? 'le kg' : form.unitLabel}` : 'Prix à saisir';
                }}
                error={err}
                zone={zone}
                who="les particuliers"
                globalText={priceNumber !== null ? `${euro(priceNumber)} ${form.unit === 'kg' ? 'le kg' : form.unitLabel}` : 'non fixé'}
                fields={(g, j, patch) => (
                  <Field
                    label={form.unit === 'kg' ? 'Prix par kilo dans ces pays' : `Prix par ${form.nounOne.trim() || 'pièce'} dans ces pays`}
                    inputMode="decimal"
                    placeholder="À saisir"
                    suffix={form.unit === 'kg' ? '€ / kg' : '€'}
                    value={g.price}
                    onValue={(v) => patch({ price: v })}
                    onBlur={() => touch(`retail.countryPrices.${j}.price`)}
                    error={err(`retail.countryPrices.${j}.price`)}
                    className="pr-[74px]"
                  />
                )}
              />
              {form.unit === 'unit' && (
                <>
                  {presets.length > 0 && (
                    <div className="no-scrollbar -mx-[18px] mt-3 flex gap-2 overflow-x-auto px-[18px]" aria-label="Unités déjà utilisées au catalogue">
                      {presets.map(([label, noun]) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, unitLabel: label, nounOne: noun[0], nounMany: noun[1] }))}
                          className={cx(
                            'press min-h-11 shrink-0 rounded-full border px-3.5 text-[13px] font-bold',
                            form.unitLabel === label ? 'border-leaf bg-leaf-wash text-leaf' : 'border-line text-fg-dim',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <Field
                    label="Libellé de l’unité"
                    value={form.unitLabel}
                    placeholder="le sachet de 200 g"
                    maxLength={40}
                    onValue={(v) => set('unitLabel', v)}
                    onBlur={() => touch('retail.unitLabel')}
                    error={err('retail.unitLabel')}
                    hint="Conditionnement tel qu’il s’affiche à côté du prix."
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Nom, au singulier" value={form.nounOne} placeholder="sachet" maxLength={24} onValue={(v) => set('nounOne', v)} onBlur={() => touch('retail.noun.0')} error={err('retail.noun.0')} />
                    <Field label="Au pluriel" value={form.nounMany} placeholder="sachets" maxLength={24} onValue={(v) => set('nounMany', v)} onBlur={() => touch('retail.noun.1')} error={err('retail.noun.1')} />
                  </div>
                </>
              )}
              <p className="-mb-2 mt-5 text-[13px] font-semibold text-fg-dim">Quantité commandée, en {retailUnitWord}</p>
              <div className="grid grid-cols-3 gap-2.5">
                <Field label="Palier" inputMode="decimal" compact value={form.step} onValue={(v) => set('step', v)} onBlur={() => touch('retail.step')} error={err('retail.step')} suffix={form.unit === 'kg' ? 'kg' : undefined} />
                <Field label="Minimum" inputMode="decimal" compact placeholder="Vide" value={form.min} onValue={(v) => set('min', v)} onBlur={() => touch('retail.min')} error={err('retail.min')} />
                <Field label="Maximum" inputMode="decimal" compact placeholder="Vide" value={form.max} onValue={(v) => set('max', v)} onBlur={() => touch('retail.max')} error={err('retail.max')} />
              </div>
              {retailRule && (
                <p className="mt-3 rounded-2xl bg-black/20 px-3.5 py-2.5 text-[13px] font-semibold leading-[19px]" data-regle="vente">
                  {retailRule}
                </p>
              )}
              <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">
                Le palier est la quantité ajoutée à chaque appui sur « + ». Sans minimum ni maximum, l’application applique un palier et vingt paliers.
              </p>
            </>
          )}
        </Section>
        )}

        {/* ───── Disponibilité */}
        <Section id="disponibilite" expand title="Disponibilité" aside={<Chip tone={form.months.length === 0 ? 'star' : 'neutral'}>{seasonText(form.months)}</Chip>}>
          <p className="mt-3 rounded-2xl bg-black/20 px-3.5 py-2.5 text-[12.5px] leading-[18px] text-fg-faint">
            L’application ne gère pas de stock : il n’y a pas de quantité disponible à saisir. « Commercialisé » ou non (interrupteurs en haut
            de la fiche) est le seul état de disponibilité d’un produit.
          </p>

          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-[13px] font-semibold text-fg-dim">Mois de disponibilité</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => set('months', [...ALL_MONTHS])} className="press min-h-11 rounded-full border border-line px-3.5 text-[12.5px] font-bold text-fg-dim">
                Toute l’année
              </button>
              <button type="button" onClick={() => set('months', [])} className="press min-h-11 rounded-full border border-line px-3.5 text-[12.5px] font-bold text-fg-dim">
                Effacer
              </button>
            </div>
          </div>
          <div className="mt-3">
            <SeasonStrip
              months={form.months}
              tint={form.tint}
              onToggle={(m) => set('months', form.months.includes(m) ? form.months.filter((x) => x !== m) : [...form.months, m].sort((a, b) => a - b))}
            />
          </div>
          <GroupError message={err('months')} />
        </Section>

        {/* ───── Données d'exemple */}
        {(initial.is_example || initial.reviews > 0) && (
          <Section id="exemple" title="Données d’exemple">
            {initial.is_example && (
              <ToggleRow
                title="Informations vérifiées"
                detail="Cette fiche vient du catalogue d’exemple de l’application. Activez une fois le prix, l’origine et la saison contrôlés : la mention « Exemple » disparaît."
                checked={!form.is_example}
                onChange={(v) => set('is_example', !v)}
              />
            )}
            {initial.reviews > 0 && (
              <div className="mt-4 flex items-center gap-3 rounded-2xl bg-black/20 p-3.5">
                <Icon src={star} size={20} className={form.reviews > 0 ? 'text-star' : 'text-fg-faint'} />
                <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-fg-dim">
                  {form.reviews > 0
                    ? `Note affichée : ${String(form.rating).replace('.', ',')} sur 5 (${form.reviews} avis). Aucun système d’avis n’existe : ces chiffres sont des exemples.`
                    : 'La note et les avis d’exemple seront retirés à l’enregistrement.'}
                </p>
                <GhostButton
                  compact
                  label={form.reviews > 0 ? 'Retirer' : 'Rétablir'}
                  onClick={() => setForm((f) => (f.reviews > 0 ? { ...f, rating: 0, reviews: 0 } : { ...f, rating: initial.rating, reviews: initial.reviews }))}
                />
              </div>
            )}
          </Section>
        )}

        {/* ───── Aperçu */}
        <Section id="apercu" expand title="Aperçu client">
          <div className="mt-3 flex flex-wrap items-end gap-5">
            <CardPreview
              name={form.name}
              origin={form.origin}
              tint={form.tint}
              src={shownSrc}
              ratio={shownRatio}
              price={form.sold && priceNumber !== null ? euro(priceNumber) : null}
              unit={form.unit === 'kg' ? 'le kg' : unitTiny(form.unitLabel)}
            />
            <p className="min-w-[180px] flex-1 text-[13px] leading-[19px] text-fg-dim">
              La carte telle qu’elle apparaît dans le catalogue des particuliers, aux cotes de l’application.{' '}
              {!form.available
                ? 'Le produit est masqué : elle n’est pas affichée pour l’instant.'
                : !form.sold || priceNumber === null
                  ? 'Sans prix particulier, cette carte n’est pas affichée aux particuliers.'
                  : ''}
            </p>
          </div>
        </Section>

          </div>
        </div>

        {check.warnings.map((w) => (
          <div key={w} className="mx-5 mt-3.5">
            <Notice tone="star" icon={warningOutline}>
              {w}
            </Notice>
          </div>
        ))}

        {product && (
          <p className="px-6 pt-5 text-center text-[12.5px] text-fg-faint">Dernier enregistrement {ago(product.updated_at)}</p>
        )}
      </div>

      {/* Enregistrement : tout en bas de la page, sans suivre le défilement */}
      <Dock flow>
          <p className="mb-2 flex items-center justify-center gap-2 text-[12.5px] font-semibold" role="status">
            {attempted && errorCount > 0 ? (
              <span className="text-danger">{plural(errorCount, 'point à corriger', 'points à corriger')}</span>
            ) : dirty ? (
              <>
                <span className="h-2 w-2 rounded-full bg-star" />
                <span className="text-star">Modifications non enregistrées</span>
              </>
            ) : isNew ? (
              <span className="text-fg-faint">Nouveau produit — rien n’est enregistré pour l’instant</span>
            ) : (
              <>
                <Icon src={checkmarkCircle} size={15} className="text-leaf" />
                <span className="text-fg-dim">Tout est enregistré</span>
              </>
            )}
          </p>
          <PrimaryButton label={saveLabel} loading={saving} loadingLabel={pending ? 'Envoi de la photo…' : 'Enregistrement…'} disabled={!canSave} onClick={save} icon={leafOutline} />
      </Dock>

      {/* Quitter avec des changements en cours */}
      <Sheet open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title="Modifications non enregistrées">
        <p className="text-[15px] leading-[23px] text-fg-dim">
          Vous avez modifié cette fiche sans l’enregistrer. En quittant maintenant, ces changements seront perdus.
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
          <GhostButton label="Rester sur la fiche" onClick={() => blocker.reset?.()} disabled={saving} />
        </div>
      </Sheet>

      {/* Archiver / supprimer */}
      <Sheet open={menu && !confirm} onClose={() => setMenu(false)} title={product?.name ?? ''}>
        {dirty && (
          <Notice tone="star" icon={warningOutline}>
            Enregistrez ou abandonnez d’abord vos modifications : ces actions portent sur la fiche enregistrée.
          </Notice>
        )}
        <div className="mt-3 flex flex-col gap-2.5">
          <GhostButton
            label={product?.archived ? 'Remettre au catalogue' : 'Archiver le produit'}
            icon={archiveOutline}
            disabled={dirty}
            onClick={() => (product?.archived ? archive() : setConfirm('archive'))}
            loading={working && !!product?.archived}
          />
          <p className="px-2 text-[12.5px] leading-[18px] text-fg-faint">
            Archiver retire le produit du catalogue publié sans effacer sa fiche. Pour une absence courte, masquez-le simplement.
          </p>
          <GhostButton label="Supprimer définitivement" icon={trashOutline} tone="danger" disabled={dirty || !isOwner} onClick={() => setConfirm('delete')} />
          {!isOwner && <p className="px-2 text-[12.5px] leading-[18px] text-fg-faint">La suppression définitive est réservée aux responsables.</p>}
        </div>
      </Sheet>

      <ConfirmSheet open={confirm === 'archive'} onClose={() => setConfirm(null)} title="Archiver ce produit ?" confirmLabel="Archiver" onConfirm={archive} busy={working}>
        <p>
          <strong className="text-fg">{product?.name}</strong> ne sera plus publié à l’application. Sa fiche, ses prix et ses offres sont conservés : vous
          pourrez le remettre au catalogue à tout moment.
        </p>
      </ConfirmSheet>

      <ConfirmSheet open={confirm === 'delete'} onClose={() => setConfirm(null)} title="Supprimer définitivement ?" confirmLabel="Supprimer définitivement" danger onConfirm={remove} busy={working}>
        <p>
          La fiche de <strong className="text-fg">{product?.name}</strong>, ses prix, ses offres et sa photo publiée seront effacés. Cette action ne peut pas être
          annulée.
        </p>
        <p className="mt-3">
          Les paniers, favoris et commandes déjà enregistrés sur les téléphones des clients désignent ce produit par son identifiant «&nbsp;{product?.id}&nbsp;» :
          l’application le retire d’elle-même des paniers et des favoris, mais son nom ne s’affichera plus dans les anciennes commandes.
        </p>
        <p className="mt-3">Pour le retirer de la vente sans rien casser, préférez « Masquer » ou « Archiver ».</p>
      </ConfirmSheet>

      <Workbench
        open={bench !== null}
        onClose={() => setBench(null)}
        title={BENCH_TITLE[bench ?? ''] ?? ''}
        bodyRef={setBenchEl}
        preview={<ProductPreview product={previewProduct} focusPack={bench === 'emballages' ? focusPack : null} />}
        footer={
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-fg-dim" role="status">
              {dirty ? 'Modifications non enregistrées' : 'Tout est enregistré'}
            </p>
            <PrimaryButton label={saveLabel} loading={saving} loadingLabel="Enregistrement…" disabled={!canSave} onClick={save} className="!w-auto min-w-[190px] shrink-0 sm:min-w-[260px]" />
          </div>
        }
      />
    </Page>
    </BenchContext.Provider>
  );
}
