import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBlocker, useNavigate, useSearchParams } from 'react-router-dom';
import { archiveOutline, arrowBack, cameraOutline, checkmarkCircle, ellipsisHorizontal, leafOutline, trashOutline } from '../lib/glyphs';
import { useAuth } from '../contexts/AuthContext';
import { useData, type Product } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { Icon } from '../components/Icon';
import { CategoryRound, ProductArt, SeasonStrip } from '../components/catalog';
import { NewCategorySheet } from '../components/NewCategorySheet';
import { CountryList } from '../components/CountryPrices';
import { Chip, ConfirmSheet, Dock, Field, GhostButton, Page, PrimaryButton, RoundButton, Segmented, Sheet, Switch, TextArea } from '../components/ui';
import { ProOffersEditor } from '../components/pro/ProOffers';
import { GapBadge, MediaEditor, ProPreview, TagInput, countdownText } from '../components/pro/ProParts';
import { ApiError, messageOf } from '../lib/api';
import { plural, seasonText } from '../lib/format';
import { prepareImage, type Prepared } from '../lib/image';
import { identityOf, proInputOf, toProForm, type ProForm } from '../lib/proForm';
import { sp } from '../lib/space';
import { cx, glow } from '../lib/ui';
import { ALL_MONTHS, DEFAULT_RULES, slugify, validateProduct, type Errors, type ProductInput } from '../../shared/catalog.js';
import { PRO_LIMITS, PRO_STATUSES, proStatusLabel, validatePro, type ProMode, type ProStatus } from '../../shared/pro.js';

function Block({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="card mx-5 mt-3.5 scroll-mt-24 p-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id={`${id}-titre`} className="font-display text-[19px] font-semibold leading-6">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Toggle({ title, detail, checked, onChange }: { title: string; detail: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="mt-3.5 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold leading-5">{title}</p>
        <p className="mt-0.5 text-[13px] leading-[18px] text-fg-dim">{detail}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

/** Fiche produit de l'espace Pros : 12 blocs, dans l'ordre de la spécification (28/11/2026). */
export default function ProEditor({ product }: { product: Product | null }) {
  const isNew = !product;
  const { products, categories, settings, artOf, photoOf, createProduct, updateProduct, deleteProduct, uploadImage } = useData();
  const { isOwner } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const rules = settings?.rules ?? DEFAULT_RULES;

  const [initial, setInitial] = useState<ProForm>(() => toProForm(product, settings?.terms ?? null));
  const [form, setForm] = useState<ProForm>(() => {
    const wished = isNew ? (params.get('nom') ?? '').trim().slice(0, 60) : '';
    return wished ? { ...initial, name: wished, id: slugify(wished) } : initial;
  });
  const [pending, setPending] = useState<Prepared | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);
  const [working, setWorking] = useState(false);
  const [newCategory, setNewCategory] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const leaving = useRef(false);

  const dirty = pending !== null || JSON.stringify(form) !== JSON.stringify(initial);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  });
  const stamp = product?.updated_at;
  useEffect(() => {
    if (!product || dirtyRef.current) return;
    const next = toProForm(product, null);
    setInitial(next);
    setForm(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname);

  const set = <K extends keyof ProForm>(k: K, v: ProForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setServerErrors((e) => (Object.keys(e).length ? {} : e));
  };

  const identity = useMemo(() => identityOf(form), [form]);
  const check = useMemo(
    () => validateProduct(identity, { isNew, existingIds: products.map((p) => p.id), categoryIds: categories.map((c) => c.id), rules }),
    [identity, isNew, products, categories, rules],
  );
  const proCheck = useMemo(() => validatePro(proInputOf(form)), [form]);
  const errors = useMemo<Errors>(() => ({ ...check.errors, ...proCheck.errors }), [check, proCheck]);
  const errorCount = Object.keys(errors).length;
  const err = (path: string) => serverErrors[path] ?? (attempted ? errors[path] : undefined);

  const rulesOf = (mode: ProMode) =>
    mode === 'bateau'
      ? { min: rules.bateau.minContainers, step: rules.bateau.stepContainers, max: rules.bateau.maxContainers }
      : mode === 'avion'
        ? { min: rules.avion.minKg, step: rules.avion.stepKg, max: rules.avion.maxKg }
        : { min: rules.standard.minKg, step: rules.standard.stepKg, max: rules.standard.maxKg };

  const pickPhoto = async (file?: File) => {
    if (!file) return;
    setPhotoBusy(true);
    try {
      setPending(await prepareImage(file));
    } catch (e) {
      toast(messageOf(e), { tone: 'error' });
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const save = async (): Promise<boolean> => {
    setAttempted(true);
    if (errorCount > 0) {
      toast(`${plural(errorCount, 'point à corriger', 'points à corriger')} avant d’enregistrer`, { tone: 'error' });
      requestAnimationFrame(() => document.querySelector('[aria-invalid="true"], [data-invalid="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return false;
    }
    setSaving(true);
    try {
      const payload = { ...check.value, retail: null, wholesale: [], pro: proCheck.value } as unknown as ProductInput;
      if (pending) {
        payload.photo_url = await uploadImage('products', payload.id, pending.blob);
        payload.photo_ratio = pending.ratio;
      }
      const row = isNew ? await createProduct(payload) : await updateProduct(product.id, payload, product.updated_at);
      const next = toProForm(row, null);
      setInitial(next);
      setForm(next);
      setPending(null);
      setAttempted(false);
      setServerErrors({});
      toast(isNew ? `Fiche pro « ${row.name} » créée${row.available ? '' : ' (pas encore en vente)'}` : `Fiche pro « ${row.name} » enregistrée`);
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
      const row = await updateProduct(product.id, { archived: !product.archived } as Partial<ProductInput>, product.updated_at);
      toast(row.archived ? `« ${row.name} » archivé` : `« ${row.name} » remis au catalogue`);
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
      toast(`« ${product.name} » supprimé définitivement de l’espace Pros`);
      leaving.current = true;
      navigate(sp('/produits'), { replace: true });
    } catch (e) {
      toast(messageOf(e), { tone: 'error' });
      setWorking(false);
    }
  };

  const shownSrc = pending ? pending.previewUrl : photoOf(form, 'full');
  const shownRatio = pending ? pending.ratio : form.photo_ratio;
  const countdown = form.status === 'bientot' ? countdownText(form.start || null) : null;
  const canSave = dirty || isNew || (!!product && product._seal !== 'ok');

  return (
    <Page>
      {/* Modifications non enregistrées : la mise à jour automatique attend (components/Update.tsx). */}
      <span hidden data-dirty={dirty ? 'true' : undefined} />
      <div className="relative z-20 flex items-center justify-between gap-3 px-[18px] pb-2" style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 10px) + 6px)' }}>
        <RoundButton icon={arrowBack} label="Retour" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(sp('/produits')))} />
        <h1 className="min-w-0 flex-1 truncate text-center font-display text-[18px] font-semibold">{form.name || (isNew ? 'Nouveau produit pro' : product.name)}</h1>
        {isNew ? <span className="w-[46px]" /> : <RoundButton icon={ellipsisHorizontal} label="Archiver ou supprimer" onClick={() => setMenu(true)} />}
      </div>

      <div className="page-in mx-auto max-w-[720px] lg:max-w-[1180px]">
        <div className="relative mx-auto h-[236px] overflow-hidden">
          <span className="absolute left-1/2 top-0 h-[250px] w-[120%] max-w-[560px] -translate-x-1/2" style={{ backgroundImage: glow(form.tint || '#7AAA2C', 0.42) }} />
          <div className="float absolute inset-0 grid place-items-center">
            <ProductArt product={form} size={206} variant="full" halo={0} src={shownSrc} ratio={shownRatio} eager />
          </div>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={photoBusy} className="press absolute bottom-2 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full border border-line-strong bg-bar/90 px-4 text-[13.5px] font-bold backdrop-blur">
            {photoBusy ? <span className="spinner" style={{ width: 15, height: 15 }} /> : <Icon src={cameraOutline} size={17} />}
            {photoBusy ? 'Préparation…' : shownSrc ? 'Remplacer la photo' : 'Ajouter une photo'}
          </button>
          <input ref={fileInput} type="file" accept="image/png,image/webp,image/jpeg" className="sr-only" tabIndex={-1} aria-label="Choisir une photo du produit" onChange={(e) => pickPhoto(e.target.files?.[0])} />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 px-5 pt-3">
          <Chip tone={form.available ? 'leaf' : 'neutral'}>{form.available ? 'En vente' : 'Pas en vente'}</Chip>
          <Chip tone="star">{proStatusLabel(form.status)}</Chip>
          {countdown && <Chip tone="star">{countdown}</Chip>}
          {form.globalgap && <GapBadge small />}
          {form.archived && <Chip>Archivé</Chip>}
          {!isNew && <Chip>{form.id}</Chip>}
        </div>

        <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-1">
          <div className="min-w-0">
            {/* 1. Identité, photo et teinte, « En vente » */}
            <Block id="identite" title="Identité" aside={<Chip tone={form.available ? 'leaf' : 'neutral'}>{form.available ? 'En vente' : 'Pas en vente'}</Chip>}>
              <Toggle title="En vente" detail={form.available ? 'Les acheteurs des pays de vente voient ce produit.' : 'Éteint : aucun acheteur ne voit ce produit.'} checked={form.available} onChange={(v) => set('available', v)} />
              <Field label="Nom" value={form.name} maxLength={80} placeholder="Mangue" onValue={(v) => setForm((f) => ({ ...f, name: v, id: isNew && !f.idTouched ? slugify(v) : f.id }))} error={err('name')} />
              {isNew && (
                <Field label="Identifiant" value={form.id} autoCapitalize="none" spellCheck={false} maxLength={40} onValue={(v) => setForm((f) => ({ ...f, id: v.toLowerCase(), idTouched: true }))} error={err('id')} hint="Référence du produit dans l’espace Pros. Il ne pourra plus être modifié." />
              )}
              <Field label="Variété" optional value={form.variety} maxLength={80} placeholder="Kent" onValue={(v) => set('variety', v)} error={err('variety')} />
              <Field label="Origine" value={form.origin} maxLength={80} placeholder="Région ou pays" onValue={(v) => set('origin', v)} error={err('origin')} />
              <TextArea label="Description" value={form.description} maxLength={1300} onValue={(v) => set('description', v)} error={err('description')} hint={`${form.description.trim().length} / 1 200 caractères`} />
              <div className="mt-3.5 flex items-center gap-3">
                <label className="flex items-center gap-3 text-[14px] font-semibold text-fg-dim">
                  Teinte
                  <input type="color" value={form.tint} onChange={(e) => set('tint', e.target.value.toUpperCase())} className="h-11 w-16 cursor-pointer rounded-full border border-line bg-transparent" aria-label="Teinte du produit" />
                </label>
              </div>
              <p className="mt-4 text-[13px] font-semibold text-fg-dim">Rayon</p>
              <div className="no-scrollbar -mx-[18px] mt-2 flex gap-x-1.5 overflow-x-auto px-3" role="radiogroup" aria-label="Rayon du produit">
                {categories.map((c) => {
                  const art = artOf(c);
                  return <CategoryRound key={c.id} src={art.src} ratio={art.ratio} label={c.label} active={form.category === c.id} onClick={() => set('category', c.id)} roomy />;
                })}
                <button type="button" onClick={() => setNewCategory(true)} aria-label="Créer un nouveau rayon" className="press flex w-[84px] shrink-0 flex-col items-center gap-2">
                  <span className="grid h-[58px] w-[58px] place-items-center rounded-full border border-dashed border-leaf/60 text-[26px] font-bold leading-none text-leaf">+</span>
                  <span className="w-full text-center text-[12px] font-bold leading-[15px] text-leaf">Nouveau rayon</span>
                </button>
              </div>
              {err('category') && <p className="mt-2 px-1 text-[13.5px] font-semibold text-danger" data-invalid="true">{err('category')}</p>}
              <NewCategorySheet open={newCategory} onClose={() => setNewCategory(false)} onCreated={(id) => set('category', id)} />
            </Block>

            {/* 2. Statut, campagne, volume */}
            <Block id="statut" title="Statut" aside={<Chip tone="star">{proStatusLabel(form.status)}</Chip>}>
              <div className="mt-3">
                <Segmented label="Statut du produit" full value={form.status} onChange={(v: ProStatus) => set('status', v)} options={PRO_STATUSES.map((s) => ({ value: s.id, label: s.label }))} />
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2.5">
                <Field label="Début de campagne" optional type="date" compact value={form.start} onValue={(v) => set('start', v)} />
                <Field label="Fin de campagne" optional type="date" compact value={form.end} onValue={(v) => set('end', v)} error={err('pro.campaign.end')} />
              </div>
              <p className="mt-1 px-1 text-[12.5px] leading-[18px] text-fg-faint">
                {form.status === 'bientot' ? (form.start ? `Compte à rebours dans l’application : ${countdown ?? 'la date est passée'}.` : 'Statut « Bientôt » : indiquez la date de début pour afficher un compte à rebours.') : 'Avec « Bientôt » et une date de début, l’application affiche un compte à rebours.'}
              </p>
              <div className="mt-1 grid grid-cols-[1fr_auto] items-end gap-2.5">
                <Field label="Volume annoncé" optional compact inputMode="decimal" value={form.volumeAmount} onValue={(v) => set('volumeAmount', v)} error={err('pro.volume')} />
                <div className="pb-[18px]">
                  <Segmented label="Unité du volume" value={form.volumeUnit} onChange={(v: 'tonnes' | 'conteneurs') => set('volumeUnit', v)} options={[{ value: 'tonnes', label: 'Tonnes' }, { value: 'conteneurs', label: 'Conteneurs' }]} />
                </div>
              </div>
            </Block>

            {/* 3. Le produit */}
            <Block id="produit" title="Le produit">
              <TagInput label="Variétés" values={form.varieties} onChange={(v) => set('varieties', v)} placeholder="Kent, Keitt… puis Entrée" />
              <TagInput label="Calibres" values={form.calibres} onChange={(v) => set('calibres', v)} placeholder="8, 10, 12… puis Entrée" />
              <Field label="Conditionnement export" optional maxLength={PRO_LIMITS.packaging} value={form.packaging} placeholder="Carton de 4 kg" onValue={(v) => set('packaging', v)} error={err('pro.packaging')} />
              <Field label="Mention qualité" optional maxLength={PRO_LIMITS.quality} value={form.quality} placeholder="Catégorie I" onValue={(v) => set('quality', v)} error={err('pro.quality')} />
            </Block>

            {/* 5. Pays de vente */}
            <Block id="pays" title="Pays de vente" aside={<Chip>{form.countriesMode === 'all' ? 'Monde entier' : form.countriesMode === 'pays' ? `${form.countriesList.length} pays` : `Sauf ${form.countriesList.length} pays`}</Chip>}>
              <div className="mt-3">
                <Segmented label="Pays de vente" full value={form.countriesMode} onChange={(v: 'all' | 'pays' | 'sauf') => set('countriesMode', v)} options={[{ value: 'all', label: 'Monde entier' }, { value: 'pays', label: 'Seulement ces pays' }, { value: 'sauf', label: 'Sauf ces pays' }]} />
              </div>
              {form.countriesMode !== 'all' && (
                <div className="mt-1">
                  <CountryList noun="réglage" label="Pays de vente" countries={form.countriesList} taken={new Set()} onChange={(v) => set('countriesList', v)} />
                </div>
              )}
              {err('pro.countries') && <p className="mt-2 px-1 text-[13.5px] font-semibold text-danger" data-invalid="true">{err('pro.countries')}</p>}
            </Block>

            {/* 6. Logistique (rien sur le transport) */}
            <Block id="logistique" title="Logistique">
              <Field label="Port de départ" optional maxLength={PRO_LIMITS.place} value={form.port} onValue={(v) => set('port', v)} />
              <Field label="Aéroport de départ" optional maxLength={PRO_LIMITS.place} value={form.airport} onValue={(v) => set('airport', v)} />
              <Field label="Station de conditionnement (EXW)" optional maxLength={PRO_LIMITS.place} value={form.station} onValue={(v) => set('station', v)} />
            </Block>

            {/* 7. Conditions de paiement */}
            <Block id="conditions" title="Conditions de paiement">
              <TextArea label="Conditions" rows={3} maxLength={PRO_LIMITS.terms} value={form.terms} onValue={(v) => set('terms', v)} hint={isNew ? 'Reprises des Réglages pros ; propres à cette fiche une fois enregistrées.' : undefined} />
            </Block>
          </div>

          <div className="min-w-0">
            {/* 4. Prix EXW / FOB */}
            <Block id="prix" title="Prix EXW / FOB" aside={<Chip>{plural(form.offers.length, 'mode', 'modes')}</Chip>}>
              <p className="mt-2 text-[13.5px] leading-5 text-fg-dim">Une ligne par mode. Dans chaque mode, un prix au kilo par groupe de pays, dans la devise de l’acheteur. Avion et bateau ont toujours leurs propres prix.</p>
              <ProOffersEditor offers={form.offers} onChange={(o) => set('offers', o)} err={err} rulesOf={rulesOf} />
            </Block>

            {/* 8. Certification */}
            <Block id="certification" title="Certification">
              <Toggle title="Certifié GlobalG.A.P" detail="Affiche le badge sur la fiche. À n’allumer que pour un produit réellement certifié." checked={form.globalgap} onChange={(v) => set('globalgap', v)} />
              {form.globalgap && <div className="mt-3"><GapBadge /></div>}
            </Block>

            {/* 9. Médias */}
            <Block id="medias" title="Médias" aside={<Chip>{plural(form.media.length, 'média', 'médias')}</Chip>}>
              <MediaEditor media={form.media} onChange={(m) => set('media', m)} />
            </Block>

            {/* 10. Programme */}
            <Block id="programme" title="Programme">
              <Toggle title="Accepter les programmes" detail={form.programmes ? 'Le bouton « Faire un programme » est proposé sur la fiche.' : 'Éteint : pas de bouton « Faire un programme ».'} checked={form.programmes} onChange={(v) => set('programmes', v)} />
            </Block>

            {/* 11. Disponibilité */}
            <Block id="disponibilite" title="Disponibilité" aside={<Chip tone={form.months.length === 0 ? 'star' : 'neutral'}>{seasonText(form.months)}</Chip>}>
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-[13px] font-semibold text-fg-dim">Mois de disponibilité</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => set('months', [...ALL_MONTHS])} className="press min-h-11 rounded-full border border-line px-3.5 text-[12.5px] font-bold text-fg-dim">Toute l’année</button>
                  <button type="button" onClick={() => set('months', [])} className="press min-h-11 rounded-full border border-line px-3.5 text-[12.5px] font-bold text-fg-dim">Effacer</button>
                </div>
              </div>
              <div className="mt-3">
                <SeasonStrip months={form.months} tint={form.tint} onToggle={(m) => set('months', form.months.includes(m) ? form.months.filter((x) => x !== m) : [...form.months, m].sort((a, b) => a - b))} />
              </div>
              {err('months') && <p className="mt-2 px-1 text-[13.5px] font-semibold text-danger" data-invalid="true">{err('months')}</p>}
            </Block>

            {/* 12. Aperçu pro */}
            <Block id="apercu" title="Aperçu pro">
              <ProPreview name={form.name} variety={form.variety} origin={form.origin} tint={form.tint} src={shownSrc} pro={proCheck.value} available={form.available} />
            </Block>
          </div>
        </div>
      </div>

      <Dock flow>
        <p className="mb-2 flex items-center justify-center gap-2 text-[12.5px] font-semibold" role="status">
          {attempted && errorCount > 0 ? (
            <span className="text-danger">{plural(errorCount, 'point à corriger', 'points à corriger')}</span>
          ) : dirty ? (
            <span className="text-star">Modifications non enregistrées</span>
          ) : isNew ? (
            <span className="text-fg-faint">Nouveau produit pro — rien n’est enregistré pour l’instant</span>
          ) : (
            <>
              <Icon src={checkmarkCircle} size={15} className="text-leaf" />
              <span className="text-fg-dim">Tout est enregistré</span>
            </>
          )}
        </p>
        <PrimaryButton label={isNew ? 'Créer le produit pro' : 'Enregistrer'} loading={saving} loadingLabel={pending ? 'Envoi de la photo…' : 'Enregistrement…'} disabled={!canSave} onClick={save} icon={leafOutline} />
      </Dock>

      <Sheet open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title="Modifications non enregistrées">
        <p className="text-[15px] leading-[23px] text-fg-dim">Vous avez modifié cette fiche sans l’enregistrer. En quittant maintenant, ces changements seront perdus.</p>
        <div className="mt-5 flex flex-col gap-2.5">
          <PrimaryButton label="Enregistrer et quitter" loading={saving} onClick={async () => ((await save()) ? blocker.proceed?.() : blocker.reset?.())} />
          <GhostButton label="Quitter sans enregistrer" tone="danger" onClick={() => blocker.proceed?.()} disabled={saving} />
          <GhostButton label="Rester sur la fiche" onClick={() => blocker.reset?.()} disabled={saving} />
        </div>
      </Sheet>

      <Sheet open={menu && !confirm} onClose={() => setMenu(false)} title={product?.name ?? ''}>
        <div className="flex flex-col gap-2.5">
          <GhostButton label={product?.archived ? 'Remettre au catalogue pro' : 'Archiver le produit'} icon={archiveOutline} disabled={dirty} onClick={() => (product?.archived ? archive() : setConfirm('archive'))} loading={working && !!product?.archived} />
          <GhostButton label="Supprimer définitivement" icon={trashOutline} tone="danger" disabled={dirty || !isOwner} onClick={() => setConfirm('delete')} />
          <p className={cx('px-2 text-[12.5px] leading-[18px] text-fg-faint')}>Cela ne concerne que l’espace Pros : l’espace Particuliers n’est jamais touché.</p>
        </div>
      </Sheet>
      <ConfirmSheet open={confirm === 'archive'} onClose={() => setConfirm(null)} title="Archiver ce produit ?" confirmLabel="Archiver" onConfirm={archive} busy={working}>
        <p><strong className="text-fg">{product?.name}</strong> ne sera plus proposé aux acheteurs. Sa fiche pro est conservée.</p>
      </ConfirmSheet>
      <ConfirmSheet open={confirm === 'delete'} onClose={() => setConfirm(null)} title="Supprimer définitivement ?" confirmLabel="Supprimer définitivement" danger onConfirm={remove} busy={working}>
        <p>La fiche pro de <strong className="text-fg">{product?.name}</strong>, ses offres et ses médias seront effacés de l’espace Pros. Cette action ne peut pas être annulée.</p>
      </ConfirmSheet>
    </Page>
  );
}
