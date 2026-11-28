import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { add, arrowDown, arrowUp, cameraOutline, informationCircleOutline, trashOutline, warningOutline } from '../lib/glyphs';
import { useAuth } from '../contexts/AuthContext';
import { useData, type Category, type HomeFilter, type HomeFilterId } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { Icon } from '../components/Icon';
import { CategoryRound } from '../components/catalog';
import { Chip, ConfirmSheet, EmptyState, ErrorPanel, Field, GhostButton, Notice, Page, PageHeader, PrimaryButton, RoundButton, SectionHead, Sheet, SkeletonRows, Switch } from '../components/ui';
import { ApiError, messageOf } from '../lib/api';
import { plural } from '../lib/format';
import { prepareImage, type Prepared } from '../lib/image';
import { cx } from '../lib/ui';
import { slugify, validateCategory, type Errors } from '../../shared/catalog.js';

type Draft = {
  id: string;
  idTouched: boolean;
  label: string;
  illustration_product: string | null;
  image_url: string | null;
  image_ratio: number;
  /** Faux : rayon masqué aux grossistes et importateurs. */
  pro_visible: boolean;
};

export default function Categories() {
  const { categories, products, settings, loading, error, reload, artOf, photoOf, createCategory, updateCategory, reorderCategories, deleteCategory, uploadImage, filterOf } = useData();
  const toast = useToast();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState<Prepared | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const known = settings?.compat?.categoryIds ?? null;
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of products) out[p.category] = (out[p.category] ?? 0) + 1;
    return out;
  }, [products]);

  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const [filterEdit, setFilterEdit] = useState<HomeFilterId | null>(null);

  const open = (c: Category | 'new') => {
    setEditing(c);
    setPending(null);
    setErrors({});
    setDraft(
      c === 'new'
        ? { id: '', idTouched: false, label: '', illustration_product: null, image_url: null, image_ratio: 1, pro_visible: true }
        : { id: c.id, idTouched: true, label: c.label, illustration_product: c.illustration_product, image_url: c.image_url, image_ratio: c.image_ratio || 1, pro_visible: c.pro_visible !== false },
    );
  };
  const close = () => {
    if (saving) return;
    setEditing(null);
    setDraft(null);
    setPending(null);
  };

  const move = async (index: number, delta: -1 | 1) => {
    const ids = categories.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setMoving(categories[index].id);
    try {
      await reorderCategories(ids);
      toast(`« ${categories[index].label} » passe en position ${target + 1}`);
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setMoving(null);
    }
  };

  const save = async () => {
    if (!draft || !editing) return;
    const isNew = editing === 'new';
    const { errors: found, value } = validateCategory(draft, {
      isNew,
      existingIds: categories.map((c) => c.id),
      productIds: products.map((p) => p.id),
    });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const payload = { ...value, pro_visible: draft.pro_visible };
      if (pending) {
        payload.image_url = await uploadImage('categories', payload.id, pending.blob);
        payload.image_ratio = pending.ratio;
        payload.illustration_product = null;
      }
      if (isNew) await createCategory(payload);
      else await updateCategory(payload.id, payload);
      toast(isNew ? `Rayon « ${payload.label} » créé` : `Rayon « ${payload.label} » enregistré`);
      setEditing(null);
      setDraft(null);
      setPending(null);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast(`Non enregistré. ${messageOf(err)}`, { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteCategory(toDelete.id);
      toast(`Rayon « ${toDelete.label} » supprimé`);
      setToDelete(null);
      setEditing(null);
      setDraft(null);
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    try {
      setPending(await prepareImage(file));
      setErrors((e) => ({ ...e, image_url: '' }));
    } catch (err) {
      setErrors((e) => ({ ...e, image_url: messageOf(err) }));
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  // Illustration du brouillon : image choisie, image publiée, ou photo d'un produit du rayon.
  const draftArt = (() => {
    if (!draft) return { src: null as string | null, ratio: 1 };
    if (pending) return { src: pending.previewUrl, ratio: pending.ratio };
    if (draft.image_url) return { src: draft.image_url, ratio: draft.image_ratio };
    const p = products.find((x) => x.id === draft.illustration_product);
    return { src: p ? photoOf(p) : null, ratio: p?.photo_ratio ?? 1 };
  })();
  const candidates = draft ? products.filter((p) => !p.archived && photoOf(p) && (editing === 'new' || p.category === draft.id)) : [];
  const editingCount = editing && editing !== 'new' ? (counts[editing.id] ?? 0) : 0;

  return (
    <Page>
      <PageHeader
        title="Rayons"
        subtitle={loading ? 'Lecture des rayons…' : `${plural(categories.length, 'rayon', 'rayons')}, dans l’ordre de l’étal`}
        right={<RoundButton icon={add} label="Ajouter un rayon" solid size={48} onClick={() => open('new')} />}
      />

      {error ? (
        <ErrorPanel message={error} onRetry={reload} />
      ) : loading ? (
        <SkeletonRows rows={5} />
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:gap-6">
          <div className="min-w-0">
            {categories.length === 0 ? (
              <EmptyState title="Aucun rayon" body="Les produits se rangent par rayon. Créez le premier." cta="Créer un rayon" onPress={() => open('new')} />
            ) : (
              <ol className="flex flex-col gap-2.5 px-5">
                {categories.map((c, i) => {
                  const art = artOf(c);
                  const n = counts[c.id] ?? 0;
                  const unknown = known !== null && !known.includes(c.id);
                  return (
                    <li key={c.id} className={cx('card flex items-center gap-1 p-2.5 transition-opacity', moving && moving !== c.id && 'opacity-60')}>
                      <button type="button" onClick={() => open(c)} className="press flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Modifier le rayon ${c.label}`}>
                        <span className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-full border border-line bg-surface">
                          {art.src ? (
                            <img src={art.src} alt="" loading="lazy" draggable={false} className="object-contain" style={{ maxWidth: 44, maxHeight: 44 }} />
                          ) : (
                            <span className="text-center text-[9.5px] font-bold uppercase leading-[11px] tracking-[0.06em] text-fg-faint">Sans<br />photo</span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15.5px] font-bold leading-5">{c.label}</span>
                          <span className="mt-px block truncate text-[12.5px] text-fg-faint">
                            {plural(n, 'produit', 'produits')} · {c.id}
                          </span>
                          {(unknown || !art.src || (c._seal && c._seal !== 'ok')) && (
                            <span className="mt-1.5 flex flex-wrap gap-1.5">
                              {c._seal && c._seal !== 'ok' && <Chip tone="danger">À valider</Chip>}
                              {unknown && <Chip tone="star">Inconnu de l’application</Chip>}
                              {!art.src && <Chip tone="star">Sans illustration</Chip>}
                            </span>
                          )}
                        </span>
                      </button>
                      <RoundButton icon={arrowUp} label={`Monter ${c.label}`} size={44} disabled={i === 0 || moving !== null} onClick={() => move(i, -1)} className={cx(i === 0 && 'opacity-30')} />
                      <RoundButton icon={arrowDown} label={`Descendre ${c.label}`} size={44} disabled={i === categories.length - 1 || moving !== null} onClick={() => move(i, 1)} className={cx(i === categories.length - 1 && 'opacity-30')} />
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="min-w-0">
            <SectionHead title="Sur l’accueil de l’application" />
            <p className="px-5 pt-1 text-[13px] leading-[18px] text-fg-faint">
              Les rayons tels qu’ils défilent sous la recherche. <strong className="font-bold text-fg-dim">Touchez un rond pour modifier son nom et sa photo.</strong> « Tout » et
              « De saison » sont des filtres de l’application, pas des rayons : ils se modifient aussi.
            </p>
            {/* Chaque rond s'ouvre : les deux filtres d'abord, puis les rayons dans l'ordre de l'étal. */}
            <div className="no-scrollbar mt-3 flex gap-x-1.5 overflow-x-auto px-3.5 pb-1 lg:flex-wrap lg:gap-y-4 lg:overflow-visible" role="group" aria-label="Filtres et rayons de l’accueil : toucher pour modifier">
              {(['tout', 'saison'] as const).map((id) => {
                const f = filterOf(id);
                return <CategoryRound key={id} src={f.src} ratio={f.ratio} label={f.label} active={id === 'tout'} roomy onClick={() => setFilterEdit(id)} />;
              })}
              {categories.map((c) => {
                const art = artOf(c);
                return <CategoryRound key={c.id} src={art.src} ratio={art.ratio} label={c.label} roomy onClick={() => open(c)} />;
              })}
            </div>

            <div className="mx-5 mt-5">
              <Notice tone="star" icon={informationCircleOutline} title="Ce que l’application lit vraiment">
                L’application reliée (catalogue <code>?v=2</code>) lit le nom et l’ordre des rayons publiés ici, et la photo d’un rayon
                quand vous en téléversez une ; sans photo, elle garde son illustration. Un rayon créé ici y apparaît dès qu’un produit
                y est rangé, dans l’ordre choisi.
                {known && (
                  <>
                    {' '}
                    Sans tour (hors connexion, première ouverture), l’application affiche ses rayons d’origine : {known.join(', ')}.
                  </>
                )}
              </Notice>
            </div>
          </div>
        </div>
      )}

      <Sheet
        open={!!editing && !toDelete}
        onClose={close}
        title={editing === 'new' ? 'Nouveau rayon' : `Rayon ${editing?.label ?? ''}`}
        footer={
          canEdit ? (
            <PrimaryButton label={editing === 'new' ? 'Créer le rayon' : 'Enregistrer'} loading={saving} loadingLabel={pending ? 'Envoi de l’image…' : 'Enregistrement…'} onClick={save} />
          ) : (
            <GhostButton className="w-full" tone="leaf" label="Se connecter pour modifier" onClick={() => navigate('/connexion')} />
          )
        }
      >
        {draft && (
          <>
            <div className="flex justify-center pt-1" aria-hidden>
              <CategoryRound src={draftArt.src} ratio={draftArt.ratio} label={draft.label || 'Nom du rayon'} scale={1.35} />
            </div>
            <Field
              label="Nom du rayon"
              value={draft.label}
              maxLength={30}
              placeholder="Fruits séchés"
              onValue={(v) => setDraft((d) => (d ? { ...d, label: v, id: editing === 'new' && !d.idTouched ? slugify(v) : d.id } : d))}
              error={errors.label}
            />
            {editing === 'new' && (
              <>
                <Field
                  label="Identifiant"
                  value={draft.id}
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={40}
                  placeholder="fruits-seches"
                  onValue={(v) => setDraft((d) => (d ? { ...d, id: v.toLowerCase(), idTouched: true } : d))}
                  error={errors.id}
                  hint="Référence du rayon dans le catalogue publié. Il ne pourra plus être modifié."
                />
                {known && draft.id && !known.includes(draft.id) && (
                  <p className="mt-2.5 flex items-start gap-2 px-1 text-[12.5px] leading-[18px] text-star">
                    <Icon src={warningOutline} size={15} className="mt-px" />
                    Ce rayon n’existe pas dans l’application actuelle : tant qu’elle n’est pas mise à jour, ses produits apparaîtront sous « Fruits ».
                  </p>
                )}
              </>
            )}

            <p className="mb-2 mt-5 text-[13px] font-semibold text-fg-dim">Illustration ronde</p>
            {candidates.length > 0 ? (
              <div className="no-scrollbar -mx-5 flex gap-1 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label="Choisir la photo d’un produit">
                {candidates.map((p) => (
                  <CategoryRound
                    key={p.id}
                    src={photoOf(p)}
                    ratio={p.photo_ratio}
                    label={p.name}
                    active={!pending && !draft.image_url && draft.illustration_product === p.id}
                    onClick={() => {
                      setPending(null);
                      setDraft((d) => (d ? { ...d, illustration_product: p.id, image_url: null, image_ratio: 1 } : d));
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="text-[13px] leading-[18px] text-fg-faint">Aucun produit de ce rayon n’a encore de photo. Importez une image, ou revenez après avoir ajouté une photo à un produit.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2.5">
              <GhostButton compact icon={cameraOutline} label={photoBusy ? 'Préparation…' : 'Importer une image'} disabled={photoBusy} onClick={() => fileInput.current?.click()} />
              {(pending || draft.image_url) && (
                <GhostButton
                  compact
                  label="Retirer l’image importée"
                  onClick={() => {
                    setPending(null);
                    setDraft((d) => (d ? { ...d, image_url: null, image_ratio: 1 } : d));
                  }}
                />
              )}
            </div>
            <input ref={fileInput} type="file" accept="image/png,image/webp,image/jpeg" className="sr-only" tabIndex={-1} aria-label="Importer une illustration" onChange={(e) => pick(e.target.files?.[0])} />
            {pending && !pending.cutout && (
              <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-star">Cette image a un fond plein : elle débordera du rond. Préférez une image détourée sur fond transparent.</p>
            )}
            {errors.image_url && <p role="alert" className="mt-2 px-1 text-[13.5px] font-semibold text-danger">{errors.image_url}</p>}
            {errors.illustration_product && <p role="alert" className="mt-2 px-1 text-[13.5px] font-semibold text-danger">{errors.illustration_product}</p>}

            {editing !== 'new' && editing && (
              <div className="mt-6 border-t border-line pt-4">
                <GhostButton compact tone="danger" icon={trashOutline} label="Supprimer ce rayon" disabled={editingCount > 0} onClick={() => setToDelete(editing)} />
                <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">
                  {editingCount > 0
                    ? `${plural(editingCount, 'produit est rangé', 'produits sont rangés')} dans ce rayon (archives comprises) : déplacez-les d’abord, depuis leur fiche.`
                    : 'Ce rayon est vide : il peut être supprimé.'}
                </p>
              </div>
            )}
          </>
        )}
      </Sheet>

      <ConfirmSheet open={!!toDelete} onClose={() => setToDelete(null)} title="Supprimer ce rayon ?" confirmLabel="Supprimer le rayon" danger onConfirm={remove} busy={deleting}>
        <p>
          Le rayon <strong className="text-fg">{toDelete?.label}</strong> sera retiré du catalogue publié. Aucun produit n’y est rangé : rien d’autre ne sera
          modifié.
        </p>
      </ConfirmSheet>

      <FilterSheet id={filterEdit} onClose={() => setFilterEdit(null)} />

      {/* Repère discret pendant un déplacement */}
      {moving && <span className="sr-only" role="status">Déplacement en cours…</span>}
    </Page>
  );
}

/** Nom et photo d'un filtre de l'accueil : « Tout » ou « De saison ». */
function FilterSheet({ id, onClose }: { id: HomeFilterId | null; onClose: () => void }) {
  const { settings, filterOf, saveFilters, uploadImage } = useData();
  const { canEdit } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [image, setImage] = useState<{ url: string; ratio: number } | null>(null);
  const [pending, setPending] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    const saved = settings?.filters?.[id];
    setLabel(filterOf(id).label);
    setImage(saved?.image_url ? { url: saved.image_url, ratio: saved.image_ratio || 1 } : null);
    setPending(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(
    () => () => {
      if (pending) URL.revokeObjectURL(pending.previewUrl);
    },
    [pending],
  );

  const original = id === 'saison' ? 'De saison' : 'Tout';
  const base = id ? filterOf(id).base : { src: null, ratio: 1 };
  const shown = pending ? { src: pending.previewUrl, ratio: pending.ratio } : image ? { src: image.url, ratio: image.ratio } : base;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      setPending(await prepareImage(file));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const save = async () => {
    if (!id) return;
    try {
      let next: HomeFilter = { label: label.trim() === original ? '' : label.trim(), image_url: image?.url ?? null, image_ratio: image?.ratio ?? 1 };
      if (pending) {
        setBusy('Envoi de la photo…');
        next = { ...next, image_url: await uploadImage('categories', id, pending.blob), image_ratio: pending.ratio };
      }
      setBusy('Enregistrement…');
      const empty: HomeFilter = { label: '', image_url: null, image_ratio: 1 };
      await saveFilters({ tout: settings?.filters?.tout ?? empty, saison: settings?.filters?.saison ?? empty, [id]: next } as Record<HomeFilterId, HomeFilter>);
      toast(`Filtre « ${label.trim() || original} » enregistré`);
      onClose();
    } catch (err) {
      setError(messageOf(err));
      toast(`Non enregistré. ${messageOf(err)}`, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      open={!!id}
      onClose={() => (busy ? undefined : onClose())}
      title={`Filtre ${original}`}
      footer={
        canEdit ? (
          <PrimaryButton label="Enregistrer" loading={!!busy} loadingLabel={busy ?? ''} onClick={save} />
        ) : (
          <GhostButton className="w-full" tone="leaf" label="Se connecter pour modifier" onClick={() => navigate('/connexion')} />
        )
      }
    >
      <div className="flex justify-center pt-1" aria-hidden>
        <CategoryRound src={shown.src} ratio={shown.ratio} label={label.trim() || original} scale={1.35} />
      </div>
      <Field
        label="Nom affiché"
        value={label}
        maxLength={30}
        placeholder={original}
        onValue={(v) => {
          setLabel(v);
          setError(null);
        }}
        hint={`Laissé vide, le filtre reprend son nom d’origine : « ${original} ».`}
      />

      <p className="mb-2 mt-5 text-[13px] font-semibold text-fg-dim">Photo du filtre</p>
      <div className="flex flex-wrap gap-2.5">
        <GhostButton compact tone="leaf" label={reading ? 'Préparation…' : pending || image ? 'Changer la photo' : 'Ajouter une photo'} disabled={reading || !!busy} onClick={() => fileInput.current?.click()} />
        {(pending || image) && (
          <GhostButton
            compact
            label="Revenir à la photo d’origine"
            disabled={!!busy}
            onClick={() => {
              setPending(null);
              setImage(null);
            }}
          />
        )}
      </div>
      <input ref={fileInput} type="file" accept="image/png,image/webp,image/jpeg" className="sr-only" tabIndex={-1} aria-label="Choisir la photo du filtre" onChange={(e) => pick(e.target.files?.[0])} />
      <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">
        {pending && !pending.cutout
          ? 'Cette photo a un fond plein : elle débordera du rond. Préférez une image détourée, sur fond transparent.'
          : pending || image
            ? 'Photo choisie par l’équipe.'
            : id === 'saison'
              ? 'Photo d’origine : un produit de saison ce mois-ci, choisi automatiquement.'
              : 'Photo d’origine : le panier de l’application.'}
      </p>
      {error && (
        <p role="alert" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
          {error}
        </p>
      )}
      <p className="mt-4 px-1 text-[12.5px] leading-[18px] text-fg-faint">
        Ce filtre est écrit dans le code de l’application d’achat : votre réglage est enregistré et publié, et s’y affichera après une mise à jour de l’application.
      </p>
    </Sheet>
  );
}
