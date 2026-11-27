import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { lockClosedOutline, logoGoogle } from '../lib/glyphs';
import supabase, { configured } from '../lib/supabase';
import { googleAvailable, signInWithGoogle } from '../lib/googleAuth';
import { useAuth } from '../contexts/AuthContext';
import { Backdrop, Wordmark } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Field, GhostButton, Notice, Page, PrimaryButton } from '../components/ui';
import { glow } from '../lib/ui';

type Errors = { email?: string; password?: string; form?: string };

/** Les messages de Supabase arrivent en anglais : on les dit en clair. */
function explain(message: string) {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return 'Adresse ou mot de passe incorrect.';
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'Un compte existe déjà avec cette adresse. Connectez-vous.';
  }
  if (m.includes('not confirmed')) return 'Adresse non confirmée : ouvrez le lien reçu par e-mail, puis reconnectez-vous.';
  if (m.includes('password')) return 'Mot de passe refusé : huit caractères au moins.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Trop de tentatives. Patientez une minute avant de réessayer.';
  if (m.includes('fetch') || m.includes('network')) return 'Connexion impossible. Vérifiez le réseau, puis réessayez.';
  return 'La connexion a échoué. Réessayez dans un instant.';
}

export default function Login() {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    const mail = email.trim().toLowerCase();
    if (!mail) next.email = 'Indiquez votre adresse e-mail.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) next.email = 'Cette adresse e-mail semble incomplète.';
    if (!password) next.password = 'Indiquez votre mot de passe.';
    else if (mode === 'signup' && password.length < 8) next.password = 'Huit caractères au moins.';
    setErrors(next);
    setNotice(null);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: mail, password });
        if (error) setErrors({ form: explain(error.message) });
      } else {
        const { data, error } = await supabase.auth.signUp({ email: mail, password });
        if (error) setErrors({ form: explain(error.message) });
        else if (!data.session) {
          setNotice('Compte créé. Ouvrez le lien de confirmation reçu par e-mail, puis connectez-vous.');
          setMode('signin');
        }
      }
    } catch {
      setErrors({ form: 'Connexion impossible. Vérifiez le réseau, puis réessayez.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-dvh">
      <Backdrop />
      <Page className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-5 pb-8">
        <div className="flex items-center" style={{ paddingTop: 'calc(max(env(safe-area-inset-top), 14px) + 14px)' }}>
          <Wordmark compact />
        </div>

        {/* Scène : les fruits détourés de l'application, sur leur halo. */}
        <div className="relative mx-auto mt-5 h-[190px] w-full max-w-[380px]" aria-hidden>
          <span className="absolute left-[8%] top-0 h-[190px] w-[84%]" style={{ backgroundImage: glow('#D9A93A', 0.5) }} />
          <img src="/decor/leaf-blur.webp" alt="" className="drift absolute left-[2%] top-[14%] w-[62px] opacity-70" style={{ ['--r' as string]: '-28deg', ['--d' as string]: '9s' }} />
          <img src="/decor/leaf.webp" alt="" className="drift absolute right-[4%] top-[4%] w-[52px]" style={{ ['--r' as string]: '34deg', ['--d' as string]: '7s' }} />
          <img src="/produce/thumb/ananas.webp" alt="" width={66} height={170} className="absolute bottom-[6px] left-[16%] h-[150px] w-auto" />
          <img src="/produce/mangue.webp" alt="" width={820} height={506} className="absolute bottom-0 left-[32%] w-[58%]" />
          <img src="/decor/leaf-soft.webp" alt="" className="drift absolute bottom-[2%] right-[12%] w-[40px] opacity-80" style={{ ['--r' as string]: '120deg', ['--d' as string]: '8s' }} />
        </div>

        <h1 className="mt-4 text-center">
          <span className="poster-voice block text-[40px] leading-[42px] tracking-[0.03em]">Le catalogue</span>
          <span className="block font-display text-[34px] font-black italic leading-[40px] text-leaf">bien en main.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-[340px] text-center text-[14.5px] leading-[21px] text-fg-dim">
          Produits, prix, disponibilités et offres professionnelles : l’espace réservé à l’équipe.
        </p>

        <form onSubmit={submit} noValidate className="card mt-6 p-5 pt-2">
          {!configured && (
            <div className="pt-3">
              <Notice tone="danger" title="Configuration manquante">
                Les variables d’environnement Supabase ne sont pas définies pour cette version : la connexion est impossible.
              </Notice>
            </div>
          )}
          <Field
            label="Adresse e-mail"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            placeholder="vous@exemple.com"
            value={email}
            onValue={setEmail}
            error={errors.email}
          />
          <div className="relative">
            <Field
              label="Mot de passe"
              type={show ? 'text' : 'password'}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onValue={setPassword}
              error={errors.password}
              hint={mode === 'signup' ? 'Huit caractères au moins.' : undefined}
              className="pr-[88px]"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              aria-pressed={show}
              className="press absolute right-1 top-[39px] grid h-[46px] min-w-[46px] place-items-center rounded-full px-3 text-[12.5px] font-bold text-fg-dim"
            >
              {show ? 'Masquer' : 'Voir'}
            </button>
          </div>

          {errors.form && (
            <p role="alert" className="mt-3 rounded-2xl bg-danger-wash px-4 py-3 text-[14px] font-semibold leading-5 text-danger">
              {errors.form}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-3 rounded-2xl bg-leaf-wash px-4 py-3 text-[14px] font-semibold leading-5 text-leaf">
              {notice}
            </p>
          )}

          <PrimaryButton
            type="submit"
            label={mode === 'signin' ? 'Se connecter' : 'Créer mon compte'}
            loading={busy}
            loadingLabel="Un instant…"
            disabled={!configured}
            className="mt-5"
          />

          <div className="my-4 flex items-center gap-3 text-[12.5px] font-semibold text-fg-faint">
            <span className="h-px flex-1 bg-line" />
            ou
            <span className="h-px flex-1 bg-line" />
          </div>

          <GhostButton
            label="Continuer avec Google"
            icon={logoGoogle}
            className="w-full"
            disabled={!configured || !googleAvailable()}
            onClick={() => {
              setErrors({});
              if (!signInWithGoogle('Tropicaura — Tour de contrôle')) {
                setErrors({ form: 'La connexion Google n’est pas configurée pour cette version.' });
              }
            }}
          />

          <button
            type="button"
            onClick={() => {
              setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
              setErrors({});
              setNotice(null);
            }}
            className="press mx-auto mt-3 flex min-h-11 items-center px-3 text-[14px] font-bold text-fg-dim underline decoration-line-strong underline-offset-4"
          >
            {mode === 'signin' ? 'Première visite ? Créer un compte' : 'J’ai déjà un compte'}
          </button>
        </form>

        <Link to="/" className="press mx-auto mt-3 flex min-h-11 items-center px-3 text-[14px] font-bold text-leaf">
          Entrer sans compte (lecture seule)
        </Link>

        <p className="mx-auto mt-2 flex max-w-[380px] items-start gap-2.5 text-[12.5px] leading-[18px] text-fg-faint">
          <Icon src={lockClosedOutline} size={15} className="mt-px" />
          <span>
            Créer un compte ne donne aucun droit : l’accès au catalogue est accordé par un responsable, puis vérifié par le
            serveur à chaque action.
          </span>
        </p>
      </Page>
    </div>
  );
}
