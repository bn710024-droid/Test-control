import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import supabase from './lib/supabase';
import { handleGoogleRedirect } from './lib/googleAuth';

// Retour d'une connexion (Google ou lien reçu par e-mail) : la session arrive dans le fragment
// d'adresse. On laisse supabase-js la lire AVANT de démarrer la navigation, qui utilise elle
// aussi le fragment.
const fragment = window.location.hash;
const authReturn = /(^#|&)(access_token|error_description)=/.test(fragment);
const popupReturn = fragment.includes('google_auth_popup');
handleGoogleRedirect();

async function boot() {
  if (authReturn) {
    try {
      await supabase.auth.getSession();
    } catch {
      // La page de connexion expliquera l'échec.
    }
    if (!popupReturn) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
    }
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {popupReturn ? (
        <p style={{ padding: 32, fontFamily: 'Manrope, sans-serif', color: '#F5F2E9' }}>
          Connexion effectuée. Vous pouvez fermer cette fenêtre.
        </p>
      ) : (
        <App />
      )}
    </StrictMode>,
  );
}

boot();
