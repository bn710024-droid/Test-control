import { lazy, useEffect, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';

const KEY = 'tropicaura:maj';

/** Mémoire de session, avec repli quand le navigateur l'interdit (aperçu dans un cadre). */
const memory = new Map<string, string>();
const store = {
  get(key: string) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  },
};

/**
 * Recharge la page sur une adresse neuve (« ?v=version ») : ni le navigateur ni un cache
 * intermédiaire ne peuvent resservir l'ancienne page. L'écran en cours est conservé.
 */
function reloadTo(version: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.set('v', version ?? String(Date.now()));
  window.location.replace(url.toString());
}

/** Nom du fichier principal de la version chargée dans cet onglet (« index-AbC123 »). */
function currentBuild() {
  for (const script of Array.from(document.scripts)) {
    const found = script.src.match(/\/assets\/(index-[\w-]+)\.js/);
    if (found) return found[1];
  }
  return null;
}

/** Une saisie est peut-être en cours : on ne recharge pas la page sous les doigts de quelqu'un. */
function busy() {
  const tag = document.activeElement?.tagName ?? '';
  return /^#\/(produits\/.+|prix)/.test(window.location.hash) || !!document.querySelector('[role="dialog"]') || tag === 'INPUT' || tag === 'TEXTAREA';
}

/**
 * Mise à jour automatique. Après une nouvelle mise en ligne, un onglet resté ouvert garde
 * l'ancienne version : les nouveautés n'y apparaissent pas et ses anciennes pages ne se chargent
 * plus. Cet observateur compare, toutes les trente secondes et à chaque retour sur l'onglet, la
 * version en ligne à celle de l'onglet ; si elle a changé, la page se recharge seule — ou propose
 * de le faire quand une saisie est en cours.
 */
export function UpdateWatcher() {
  const [waiting, setWaiting] = useState<string | null>(null);

  useEffect(() => {
    const mine = currentBuild();
    if (!mine) return;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`/?maj=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const latest = (await res.text()).match(/assets\/(index-[\w-]+)\.js/)?.[1];
        if (stopped || !latest || latest === mine) return;
        // Un seul rechargement automatique par version : jamais de boucle. Le garde-fou est aussi
        // dans l'adresse, pour les aperçus où la mémoire de session est interdite.
        const already = store.get(KEY) === latest || new URLSearchParams(window.location.search).get('v') === latest;
        if (!busy() && !already) {
          store.set(KEY, latest);
          reloadTo(latest);
        } else {
          setWaiting(latest);
        }
      } catch {
        // Hors ligne : la prochaine vérification réessaiera.
      }
    };
    // Dès l'ouverture : si la page reçue était déjà une ancienne copie, on prend la bonne.
    const first = window.setTimeout(check, 1500);
    const timer = window.setInterval(check, 30000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);

  if (!waiting) return null;
  return createPortal(
    <div className="fixed inset-x-3 z-[90] flex justify-center" style={{ top: 'calc(env(safe-area-inset-top) + 10px)' }} role="status">
      <div className="flex max-w-full items-center gap-3 rounded-full border border-line-strong bg-toast py-1.5 pl-4 pr-1.5 shadow-[0_14px_34px_rgba(0,0,0,0.5)]">
        <span className="min-w-0 truncate text-[13.5px] font-bold">Nouvelle version disponible</span>
        <button type="button" onClick={() => reloadTo(null)} className="press flex min-h-11 shrink-0 items-center rounded-full bg-leaf px-4 text-[13.5px] font-extrabold text-on-leaf">
          Mettre à jour
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Chargement d'un écran à la demande. Si son fichier n'existe plus (l'onglet date d'avant la
 * dernière mise en ligne), la page se recharge une fois pour prendre la version courante, au lieu
 * de rester blanche.
 */
export function lazyScreen<T extends ComponentType<object>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((err: unknown) => {
      const mark = `${KEY}:ecran`;
      const retried = new URLSearchParams(window.location.search).get('ecran') === '1';
      if (!retried && store.get(mark) !== window.location.hash) {
        store.set(mark, window.location.hash);
        const url = new URL(window.location.href);
        url.searchParams.set('ecran', '1');
        url.searchParams.set('v', String(Date.now()));
        window.location.replace(url.toString());
        return new Promise<{ default: T }>(() => {});
      }
      throw err;
    }),
  );
}
