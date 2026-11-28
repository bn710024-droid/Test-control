import { Suspense, type ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { createHashRouter, Navigate, RouterProvider, useLocation } from 'react-router-dom';
import { OPEN_ACCESS } from '../shared/access.js';
import { UpdateWatcher, lazyScreen } from './components/Update';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider, useData } from './contexts/DataContext';
import { ToastProvider } from './contexts/ToastContext';
import { Backdrop, Layout } from './components/Shell';
import { Launch } from './components/Launch';
import { EmptyState, ErrorPanel, GhostButton } from './components/ui';
import { configured } from './lib/supabase';
import Login from './pages/Login';
import NoAccess from './pages/NoAccess';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';

// Écrans ouverts à la demande : le premier affichage ne charge que la connexion, le tableau de
// bord et la liste des produits.
const ProductEditor = lazyScreen(() => import('./pages/ProductEditor'));
const Prices = lazyScreen(() => import('./pages/Prices'));
const Categories = lazyScreen(() => import('./pages/Categories'));
const Settings = lazyScreen(() => import('./pages/Settings'));
const Publications = lazyScreen(() => import('./pages/Publications'));
const Requests = lazyScreen(() => import('./pages/Requests'));
// L'espace commandes : un univers à part, avec son cadre et ses trois pages.
const OrdersLayout = lazyScreen(() => import('./pages/Orders').then((m) => ({ default: m.OrdersLayout })));
const OrdersList = lazyScreen(() => import('./pages/Orders').then((m) => ({ default: m.OrdersList })));
const OrdersClients = lazyScreen(() => import('./pages/Orders').then((m) => ({ default: m.OrdersClients })));
const OrdersStats = lazyScreen(() => import('./pages/Orders').then((m) => ({ default: m.OrdersStats })));
const OrdersStatus = lazyScreen(() => import('./pages/Orders').then((m) => ({ default: m.OrdersStatus })));
const OrdersDelivery = lazyScreen(() => import('./pages/Orders').then((m) => ({ default: m.OrdersDelivery })));
const OrdersCarts = lazyScreen(() => import('./pages/Carts').then((m) => ({ default: m.OrdersCarts })));

const later = (node: ReactNode) => (
  <Suspense
    fallback={
      <div className="grid place-items-center pt-28" role="status" aria-label="Chargement">
        <span className="spinner text-leaf" style={{ width: 26, height: 26 }} />
      </div>
    }
  >
    {node}
  </Suspense>
);

function Splash({ label }: { label: string }) {
  return (
    <div className="relative grid min-h-dvh place-items-center">
      <Backdrop />
      <div className="relative z-10 flex flex-col items-center gap-4" role="status">
        <span className="spinner text-leaf" style={{ width: 28, height: 28 }} />
        <p className="text-[14px] font-semibold text-fg-dim">{label}</p>
      </div>
    </div>
  );
}

function Shell() {
  const { pendingRefs, products, issuesOf } = useData();
  // Compteur de l'onglet « Contrôle » : fiches à compléter et lignes à valider.
  const todo = products.filter((p) => !p.archived && issuesOf(p).length > 0).length + pendingRefs.length;
  const { pathname } = useLocation();
  if (pathname.startsWith('/commandes')) return later(<OrdersLayout />);
  return <Layout badge={todo} />;
}

/** Porte de l'administration : session, puis droits confirmés par le serveur, puis les écrans. */
function Gate() {
  const { user, loading, access, refreshAccess, signOut } = useAuth();

  if (!configured) {
    return (
      <div className="relative min-h-dvh">
        <Backdrop />
        <div className="relative z-10 mx-auto max-w-[520px] pt-16">
          <EmptyState
            title="Configuration manquante"
            body="Les variables VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY ne sont pas définies pour cette version. Consultez le fichier README, section « Configuration »."
          />
        </div>
      </div>
    );
  }
  // Phase de test : on entre directement, tout est modifiable (voir shared/access.js).
  if (OPEN_ACCESS) {
    return (
      <DataProvider key="ouvert">
        <Shell />
      </DataProvider>
    );
  }
  if (loading) return <Splash label="Ouverture de la session…" />;
  // Sans compte : on entre directement, en lecture seule. La connexion ne sert qu'à modifier.
  if (!user) {
    return (
      <DataProvider key="visite">
        <Shell />
      </DataProvider>
    );
  }
  if (access.status === 'idle' || access.status === 'loading') return <Splash label="Vérification des droits…" />;
  if (access.status === 'error') {
    return (
      <div className="relative min-h-dvh">
        <Backdrop />
        <div className="relative z-10 mx-auto max-w-[520px] pt-20">
          <ErrorPanel message={`Vos droits n’ont pas pu être vérifiés. ${access.error}`} onRetry={refreshAccess} />
          <div className="mt-4 px-5">
            <GhostButton label="Se déconnecter" onClick={signOut} className="w-full" />
          </div>
        </div>
      </div>
    );
  }
  if (access.role !== 'owner' && access.role !== 'editor') return <NoAccess />;
  return (
    <DataProvider key={user.id}>
      <Shell />
    </DataProvider>
  );
}

/** Un écran n'a pas pu s'afficher : on le dit, et on propose de repartir, au lieu d'une page blanche. */
function Crash() {
  return (
    <div className="relative min-h-dvh">
      <Backdrop />
      <div className="relative z-10 mx-auto max-w-[520px] pt-16">
        <EmptyState
          title="Cet écran n’a pas pu s’afficher"
          body="Une nouvelle version vient peut-être d’être mise en ligne. Rechargez la page pour repartir sur la version à jour."
          cta="Recharger la page"
          onPress={() => window.location.reload()}
        />
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="pt-16">
      <EmptyState title="Page introuvable" body="Cette adresse ne correspond à aucun écran de l’administration." />
    </div>
  );
}

// Navigation par fragment (#/produits) : aucune règle de réécriture n'est requise côté hébergeur,
// un lien profond ou un rechargement fonctionne partout.
const router = createHashRouter([
  { path: '/connexion', element: OPEN_ACCESS ? <Navigate to="/" replace /> : <Login /> },
  {
    path: '/',
    element: <Gate />,
    errorElement: <Crash />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'produits', element: <Products /> },
      { path: 'produits/nouveau', element: later(<ProductEditor />) },
      { path: 'produits/:id', element: later(<ProductEditor />) },
      { path: 'prix', element: later(<Prices />) },
      { path: 'rayons', element: later(<Categories />) },
      { path: 'introuvables', element: later(<Requests />) },
      { path: 'publications', element: later(<Publications />) },
      { path: 'reglages', element: later(<Settings />) },
      { path: 'commandes', element: later(<OrdersList />) },
      { path: 'commandes/paniers', element: later(<OrdersCarts />) },
      { path: 'commandes/clients', element: later(<OrdersClients />) },
      { path: 'commandes/statistiques', element: later(<OrdersStats />) },
      { path: 'commandes/statuts', element: later(<OrdersStatus />) },
      { path: 'commandes/livraison', element: later(<OrdersDelivery />) },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export default function App() {
  return (
    // `reducedMotion="user"` : si le système demande moins d'animations, les déplacements cessent.
    <MotionConfig reducedMotion="user">
      <Launch />
      <UpdateWatcher />
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </MotionConfig>
  );
}
