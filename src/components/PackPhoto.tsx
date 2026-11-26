import { useRef, useState } from 'react';
import { GhostButton } from './ui';
import { messageOf } from '../lib/api';
import { prepareImage } from '../lib/image';

/**
 * Photo d'un emballage : celle de tous les pays, ou celle propre à quelques pays. L'image est
 * préparée dans le navigateur (900 px au plus), envoyée aussitôt, puis rattachée à la fiche — qui
 * ne change, elle, qu'à l'enregistrement.
 */
export function PackPhoto({ value, onChange, upload, label, hint, error }: {
  /** Adresse de la photo, ou chaîne vide. */
  value: string;
  onChange: (url: string) => void;
  upload: (blob: Blob) => Promise<string>;
  label: string;
  hint?: string;
  error?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const prepared = await prepareImage(file);
      URL.revokeObjectURL(prepared.previewUrl);
      onChange(await upload(prepared.blob));
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const shown = problem ?? error;

  return (
    <div className="mt-4" data-photo-emballage={value ? 'oui' : 'non'}>
      <p className="mb-[7px] text-[13px] font-semibold text-fg-dim">{label}</p>
      <div className="flex items-center gap-3">
        <span className="grid h-[76px] w-[76px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-black/30">
          {busy ? (
            <span className="spinner text-leaf" />
          ) : value ? (
            <img src={value} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="px-1 text-center text-[10.5px] font-bold uppercase leading-[14px] tracking-[0.06em] text-fg-faint">Sans photo</span>
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap gap-2">
          <GhostButton compact tone="leaf" label={busy ? 'Envoi…' : value ? 'Remplacer' : 'Choisir une photo'} disabled={busy} onClick={() => input.current?.click()} />
          {value && !busy && <GhostButton compact label="Retirer" aria-label={`Retirer : ${label}`} onClick={() => onChange('')} />}
        </div>
      </div>
      <input ref={input} type="file" accept="image/png,image/webp,image/jpeg" className="sr-only" tabIndex={-1} aria-label={label} onChange={(e) => pick(e.target.files?.[0])} />
      {shown && (
        <p role="alert" data-invalid="true" className="mt-2 px-1 text-[13.5px] font-semibold leading-[19px] text-danger">
          {shown}
        </p>
      )}
      {hint && !shown && <p className="mt-2 px-1 text-[12.5px] leading-[18px] text-fg-faint">{hint}</p>}
    </div>
  );
}
