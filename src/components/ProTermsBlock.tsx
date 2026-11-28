import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useData, type ProTerms } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { messageOf } from '../lib/api';
import { Field, GhostButton, PrimaryButton, TextArea } from './ui';
import { PRO_LIMITS } from '../../shared/pro.js';

const EMPTY: ProTerms = { terms: '', port: '', airport: '', station: '' };

/**
 * Espace Pros › Réglages : conditions de paiement, port, aéroport et station de conditionnement par
 * défaut. Pré-remplis dans chaque nouvelle fiche pro ; une fiche peut ensuite avoir les siens.
 */
export function ProTermsBlock() {
  const { settings, saveTerms } = useData();
  const { canEdit } = useAuth();
  const toast = useToast();
  const stored = settings?.terms ?? EMPTY;
  const key = JSON.stringify(stored);
  const [form, setForm] = useState<ProTerms>(stored);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(JSON.parse(key)), [key]);
  const dirty = JSON.stringify(form) !== key;
  const set = (k: keyof ProTerms) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try {
      await saveTerms(form);
      toast('Conditions et logistique par défaut enregistrées');
    } catch (err) {
      toast(messageOf(err), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <p className="mt-2 text-[13.5px] leading-5 text-fg-dim">
        Valeurs reprises dans chaque nouvelle fiche pro. Une fiche peut ensuite avoir les siennes. Rien n’est rempli d’avance.
      </p>
      <TextArea
        label="Conditions de paiement"
        rows={3}
        disabled={!canEdit}
        maxLength={PRO_LIMITS.terms}
        placeholder="Par exemple : 30 % à la commande, solde avant embarquement"
        value={form.terms}
        onValue={set('terms')}
      />
      <div className="grid grid-cols-1 gap-x-2.5 sm:grid-cols-3">
        <Field label="Port de départ" compact disabled={!canEdit} maxLength={PRO_LIMITS.place} value={form.port} onValue={set('port')} />
        <Field label="Aéroport de départ" compact disabled={!canEdit} maxLength={PRO_LIMITS.place} value={form.airport} onValue={set('airport')} />
        <Field label="Station de conditionnement" compact disabled={!canEdit} maxLength={PRO_LIMITS.place} value={form.station} onValue={set('station')} />
      </div>
      {canEdit && (
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          <PrimaryButton className="!w-auto min-w-[200px] flex-1" label="Enregistrer" disabled={!dirty} loading={saving} onClick={submit} />
          {dirty && <GhostButton label="Annuler" onClick={() => setForm(JSON.parse(key))} />}
        </div>
      )}
    </>
  );
}
