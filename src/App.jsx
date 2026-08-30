// force re-transform (collapse stale ?v= React chunks)
import React, { useEffect, lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { setMilestoneNavigator } from '@/lib/celebrations';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AppLayout from '@/components/layout/AppLayout';

// Code splitting: lazy load all pages
// Dashboard — lazy-loaded
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const AFaire = lazy(() => import('@/pages/AFaire'));
const Onboarding = lazy(() => import('@/pages/Onboarding'));
const PropertyList = lazy(() => import('@/pages/PropertyList'));
const PropertyForm = lazy(() => import('@/pages/PropertyForm'));
const PropertyDetail = lazy(() => import('@/pages/PropertyDetail'));
const CashFlow = lazy(() => import('@/pages/CashFlow'));
const Tenants = lazy(() => import('@/pages/Tenants'));
const BankImportPage = lazy(() => import('@/pages/BankImportPage'));
const Taxes = lazy(() => import('@/pages/Taxes'));

const Analyse = lazy(() => import('@/pages/Analyse'));
const InvestmentSimulator = lazy(() => import('@/pages/InvestmentSimulator'));
const Quittances = lazy(() => import('@/pages/Quittances'));
const TenantPortal = lazy(() => import('@/pages/TenantPortal'));
const RentLedger = lazy(() => import('@/pages/RentLedger'));
const Impayes = lazy(() => import('@/pages/Impayes'));
const MonthClose = lazy(() => import('@/pages/MonthClose'));
const RentIndexation = lazy(() => import('@/pages/RentIndexation'));
const ChargeRegularization = lazy(() => import('@/pages/ChargeRegularization'));
const Documents = lazy(() => import('@/pages/Documents'));
const Alerts = lazy(() => import('@/pages/Alerts'));
const Team = lazy(() => import('@/pages/Team'));
const AuditLog = lazy(() => import('@/pages/AuditLog'));
const Loyers = lazy(() => import('@/pages/Loyers'));
const Banque = lazy(() => import('@/pages/Banque'));
const ImporterDocuments = lazy(() => import('@/pages/ImporterDocuments'));
const Reglages = lazy(() => import('@/pages/Reglages'));
const BillingSettings = lazy(() => import('@/pages/BillingSettings'));
const Aide = lazy(() => import('@/pages/Aide'));
const Statut = lazy(() => import('@/pages/Statut'));
const Bienvenue = lazy(() => import('@/pages/Bienvenue'));
const Apropos = lazy(() => import('@/pages/Apropos'));
const Landing = lazy(() => import('@/pages/public/Landing'));
const Pricing = lazy(() => import('@/pages/public/Pricing'));
const Cgu = lazy(() => import('@/pages/legal/Cgu'));
const MentionsLegales = lazy(() => import('@/pages/legal/MentionsLegales'));
const Confidentialite = lazy(() => import('@/pages/legal/Confidentialite'));
const Dpa = lazy(() => import('@/pages/legal/Dpa'));
const CancelDeletion = lazy(() => import('@/pages/legal/CancelDeletion'));
const LEGAL_PATHS = {
  '/cgu': Cgu,
  '/mentions-legales': MentionsLegales,
  '/confidentialite': Confidentialite,
  '/dpa': Dpa,
  '/cancel-deletion': CancelDeletion,
};
const PublicFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>
);

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { setMilestoneNavigator(navigate); }, [navigate]);

  // Première connexion : redirige vers le wizard /bienvenue tant que l'onboarding
  // guidé novice n'est pas terminé (et tant que l'utilisateur n'a pas choisi le mode expert).
  useEffect(() => {
    if (!user) return;
    const onb = user?.onboarding || user?.data?.onboarding;
    const done = onb?.completed || onb?.mode_expert;
    // On ne force le wizard que pour les comptes récents (≤ 14 j) sans onboarding
    // terminé — afin de ne pas rappatrier les utilisateurs déjà installés.
    const created = user?.created_date ? new Date(user.created_date).getTime() : 0;
    const isRecent = created > 0 && Date.now() - created < 14 * 86400000;
    if (!done && isRecent && location.pathname === '/') {
      navigate('/bienvenue', { replace: true });
    }
  }, [user, location.pathname, navigate]);

  // Route publique hors authentification : portail locataire par jeton magique
  if (location.pathname.startsWith('/portail')) {
    return (
      <Routes>
        <Route path="/portail/:token" element={
          <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>}>
            <TenantPortal />
          </Suspense>
        } />
      </Routes>
    );
  }

  // Route publique : landing page marketing
  if (location.pathname === '/landing') {
    return (
      <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>}>
        <Landing />
      </Suspense>
    );
  }

  // Route publique : tarifs
  if (location.pathname === '/pricing') {
    return (
      <Suspense fallback={<PublicFallback />}>
        <Pricing />
      </Suspense>
    );
  }

  // Routes publiques : pages légales (CGU, mentions, confidentialité, DPA) + annulation suppression
  if (LEGAL_PATHS[location.pathname]) {
    const Comp = LEGAL_PATHS[location.pathname];
    return (
      <Suspense fallback={<PublicFallback />}>
        <Comp />
      </Suspense>
    );
  }

  // Racine "/" : Landing publique pour les visiteurs (non authentifiés ou en cours
  // de résolution), Dashboard pour les utilisateurs connectés.
  if (location.pathname === '/' && !user && authError?.type !== 'user_not_registered') {
    return (
      <Suspense fallback={<PublicFallback />}>
        <Landing />
      </Suspense>
    );
  }

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError?.type === 'user_not_registered') {
    return <UserNotRegisteredError />;
  }

  // Non authentifié sur une route protégée → redirection vers le login en
  // conservant l'URL de retour (navigateToLogin utilise window.location.href).
  if (!user) {
    navigateToLogin();
    return null;
  }

  return (
    <Routes>
      <Route path="/bienvenue" element={
        <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>}>
          <Bienvenue />
        </Suspense>
      } />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/a-faire" element={<AFaire />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/biens" element={<PropertyList />} />
        <Route path="/biens/nouveau" element={<PropertyForm />} />
        <Route path="/biens/:id" element={<PropertyDetail />} />
        <Route path="/biens/:id/edit" element={<PropertyForm />} />
        <Route path="/biens/:id/cashflow" element={<CashFlow />} />
        <Route path="/locataires" element={<Tenants />} />
        <Route path="/loyers" element={<Loyers />} />
        <Route path="/import" element={<ImporterDocuments />} />
        <Route path="/banque" element={<Banque />} />
        <Route path="/reglages" element={<Reglages />} />
        <Route path="/facturation" element={<BillingSettings />} />
        <Route path="/aide" element={<Aide />} />
        <Route path="/statut" element={<Statut />} />
        <Route path="/a-propos" element={<Apropos />} />
        {/* Redirections des anciennes URLs vers les nouveaux agrégateurs */}
        {/* /import est désormais la page dédiée « Importer des documents » (route de premier niveau) */}
        <Route path="/impots" element={<Navigate to="/reglages?section=outils" replace />} />
        <Route path="/simulateur" element={<Navigate to="/reglages?section=outils" replace />} />
        <Route path="/analyse" element={<Navigate to="/reglages?section=outils" replace />} />
        <Route path="/quittances" element={<Navigate to="/loyers?tab=quittances" replace />} />
        <Route path="/compte-locataire" element={<Navigate to="/loyers?tab=compte-locataire" replace />} />
        <Route path="/loyers-revision" element={<Navigate to="/loyers?tab=loyers-revision" replace />} />
        <Route path="/charges-regularisation" element={<Navigate to="/loyers?tab=charges-regularisation" replace />} />
        <Route path="/documents" element={<Navigate to="/reglages?section=documents" replace />} />
        <Route path="/alertes" element={<Navigate to="/" replace />} />
        <Route path="/equipe" element={<Navigate to="/reglages?section=equipe" replace />} />
        <Route path="/audit" element={<Navigate to="/reglages?section=securite" replace />} />
        <Route path="/impayes" element={<Navigate to="/loyers?tab=impayes" replace />} />
        <Route path="/cloture-mois" element={<Navigate to="/banque?tab=cloture" replace />} />
        <Route path="/parametres" element={<Navigate to="/reglages" replace />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (e) => {
      document.documentElement.classList.toggle('dark', e.matches);
    };
    apply(mq);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Capture globale des erreurs pour pré-remplir le signalement de bug
  // + auto-guérison des imports dynamiques périmes (lazy chunks Vite).
  useEffect(() => {
    const handler = (e) => {
      const msg = e.message || (e.error && e.error.message) || 'Erreur';
      // Vite : après une ré-optimisation du serveur de preview, l'app shell
      // déjà chargé référence d'anciens URLs de chunks qui n'existent plus →
      // un simple reload recharge le shell avec les bons URLs. Garde-fou anti-boucle
      // via sessionStorage (une seule relance par session navigateur réelle).
      if (/Failed to fetch dynamically imported module/.test(msg)) {
        if (!sessionStorage.getItem('__patrimoChunkReload')) {
          sessionStorage.setItem('__patrimoChunkReload', '1');
          window.location.reload();
          return;
        }
        sessionStorage.removeItem('__patrimoChunkReload');
      }
      window.__patrimoLastError = {
        message: msg,
        stack: (e.error && e.error.stack) || '',
        url: window.location.href,
        ts: Date.now(),
      };
    };
    window.addEventListener('error', handler);
    window.addEventListener('unhandledrejection', (e) => handler({ message: (e.reason && e.reason.message) || 'Promise rejetée', error: e.reason }));
    return () => {
      window.removeEventListener('error', handler);
      window.removeEventListener('unhandledrejection', handler);
    };
  }, []);

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <SonnerToaster richColors position="top-center" />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;