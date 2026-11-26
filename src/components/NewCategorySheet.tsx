import { useEffect, useRef, useState } from 'react';
import { useData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { CategoryRound } from './catalog';
import { Field, GhostButton, PrimaryButton, Sheet, Switch } from './ui';
import { ApiError, messageOf } from '../lib/api';
import { prepareImage, type Prepared } from '../lib/image';
import { slugify, validateCategory, type Errors } from '../../shared/catalog.js';

/**
 * Création d'un rayon sans quitter la fiche produit : un nom, une photo, et c'est tout.
 * Le rayon créé est aussitôt choisi pour le produit en cours. L'ordre des rayons et le reste se
 * règlent ensuite dans l'écran Rayons.
 */
export function NewCategorySheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { categories, products, createCategory, uploadImage } = useData();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [proVisible, setProVisible] = useState(true);
  const [pending, setPending] = useState<Prepared | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLabel('');
    setProVisible(true);
    setPending(null);
    setErrors({});
  }, [open]);
  useEffect(
    () => () => {
      if (pending) URL.revokeObjectURL(pending.previewUrl);
    },
    [pending],
  );

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    setErrors((e) => ({ ...e, image_url: '' }));
    try {
      setPending(await prepareImage(file));
    } catch (err) {
      setErrors((e) => ({ ...e, image_url: messageOf(err) }));
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const save = async () => {
    const { errors: found, value } = validateCategory(
      { id: slugify(label), label, image_url: null, image_ratio: 1, illustration_product: null },
      { isNew: true, existingIds: categories.map((c) => c.id), productIds: products.map((p) => p.id) },
    );
    // L'identifiant vient du nom : une erreur sur l'un se lit sous le champ du nom.
    if (found.id && !found.label) found.label = found.id.includes('existe') ? `Un rayon porte déjà ce nom : « ${label.trim()} ».` : 'Ce nom ne peut pas servir d’identifiant : utilisez des lettres ou des chiffres.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      const payload = { ...value, pro_visible: proVisible };
      if (pending) {
        setSaving('Envoi de la photo…');
        payload.image_url = await uploadImage('categories', payload.id, pending.blob);
        payload.image_ratio = pending.ratio;
      }
      setSaving('Création du rayon…');
      const row = await createCategory(payload);
      toast(`Rayon « ${row.label} » créé`);
      onCreated(row.id);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast(`Rayon non créé. ${messageOf(err)}`, { tone: 'error' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Sheet open={open} onClose={() => (saving ? undefined : onClose())} title="Nouveau rayon" footer={<PrimaryButton label="Créer le rayon" loading={!!saving} loadingLabel={saving ?? ''} onClick={save} />}>
      <div className="flex justify-center pt-1" aria-hidden>
        <CategoryRound src={pending?.previewUrl ?? null} ratio={pending?.ratio ?? 1} label={label.trim() || 'Nom du rayon'} scale={1.35} />
      </div>
      <Field label="Nom du rayon" value={label} maxLength={30} placeholder="Fruits séchés"
        onValue={(v) => {
          setLabel(v);
          // L'erreur portait sur l'ancien nom : elle s'efface dès qu'on le corrige.
          setErrors((e) => (e.label || e.id ? { ...e, label: '', id: '' } : e));
        }}
        error={errors.label || undefined}
      />

      <p className="mb-2 mt-5 text-[13px] font-semibold text-fg-dim">Photo du rayon</p>
      <div className="flex flex-wrap gap-2.5">
        <GhostButton compact tone={pending ? 'default' : 'leaf'} label={reading ? 'Préparation…' : pending ? 'Changer la photo' : 'Ajouter une photo'} disabled={reading || !!saving} onClick={() => fileInput.current?.click()} />
        {pending && <GhostButton compact label="Retirer" disabled={!!saving} onClick={() => setPending(null)} />}
      </div>
      <input ref={fileInput} type="file" accept="image/png,image/webp,image/jpeg" className="sr-only" tabIndex={-1} aria-label="Choisir la photo du rayon" onChange={(e) => pick(e.target.files?.[0])} />
      <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">
        {pending
          ? pending.cutout
            ? 'Photo détourée : elle tient bien dans le rond.'
            : 'Cette photo a un fond plein : elle débordera du rond. Préférez une image détourée, sur fond transparent.'
          : 'Facultative : sans photo, le rond affiche « Sans photo ». PNG ou WebP sur fond transparent de préférence.'}
      </p>
      {errors.image_url && (
        <p role="alert" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
          {errors.image_url}
        </p>
      )}

      <div className="mt-5 flex items-center gap-3 rounded-2xl bg-black/25 p-3.5">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-5">Visible par les grossistes et importateurs</p>
          <p className="mt-0.5 text-[13px] leading-[18px] text-fg-dim">{proVisible ? 'Ils voient les produits de ce rayon qui leur sont proposés.' : 'Éteint : ils ne voient aucun produit de ce rayon.'}</p>
        </div>
        <Switch checked={proVisible} onChange={setProVisible} label="Rayon visible par les grossistes et importateurs" />
      </div>
      <p className="mt-3 px-1 text-[12.5px] leading-[18px] text-fg-faint">
        L’application d’achat ne connaît pas encore les nouveaux rayons : tant qu’elle n’est pas mise à jour, leurs produits y apparaissent sous « Fruits ».
      </p>
    </Sheet>
  );
}
