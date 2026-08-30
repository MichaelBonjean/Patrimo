import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Monogram } from './Monogram';
import DashboardMock from './DashboardMock';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

export default function LandingHero() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const start = () => base44.auth.redirectToLogin('/onboarding');

  return (
    <section className="relative overflow-hidden border-b border-sidebar-border">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.06),transparent_55%)]" aria-hidden="true" />

      {/* Nav */}
      <header className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <Monogram />
        <div className="flex items-center gap-2">
          {user ? (
            <button onClick={() => navigate('/')} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors inline-flex items-center gap-1.5">
              Aller à mon espace <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <>
              <button onClick={() => base44.auth.redirectToLogin()} className="hidden sm:inline-flex h-9 px-4 items-center text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors">
                Se connecter
              </button>
              <button onClick={start} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
                Créer mon compte
              </button>
            </>
          )}
        </div>
      </header>

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-5 pt-10 pb-16 grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/80 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" /> Le cockpit du bailleur 5+ biens
          </span>

          {/* Desktop H1, mobile phrase simplifiée */}
          <h1 className="font-display font-semibold text-[2.1rem] sm:text-4xl lg:text-[2.9rem] leading-[1.08] tracking-tight text-foreground">
            Reprenez le contrôle de votre
            <span className="text-primary"> patrimoine locatif</span>.
            <br className="hidden sm:block" />
            <span className="text-muted-foreground"> En 5 minutes par mois.</span>
          </h1>

          {/* Sous-titre masqué sur mobile (hero simplifié : 1 phrase + 1 CTA + capture) */}
          <p className="hidden sm:block mt-5 text-muted-foreground text-[15px] leading-relaxed max-w-xl">
            Patrimo gère vos loyers, vos quittances, votre fiscalité et vos SCI
            depuis une seule interface. Pensé pour les bailleurs 5+ biens et les
            investisseurs multi-SCI qui ont dépassé Excel.
          </p>

          <div className="mt-7 flex items-center gap-3">
            <button onClick={start} className="h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 hover:bg-primary/90 transition-colors shadow-sm">
              Créer mon compte gratuit <ArrowRight className="w-4 h-4" />
            </button>
            {/* Second CTA masqué sur mobile */}
            <button onClick={() => navigate('/landing#cockpit')} className="hidden sm:inline-flex h-11 px-4 items-center rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors">
              Voir le cockpit
            </button>
          </div>

          <p className="hidden sm:block mt-3 text-xs text-muted-foreground">
            Sans carte bancaire · 14 jours d'essai · Résiliation en 1 clic
          </p>
        </div>

        {/* Capture animée du dashboard */}
        <div id="cockpit" className="scroll-mt-24">
          <DashboardMock />
        </div>
      </div>
    </section>
  );
}