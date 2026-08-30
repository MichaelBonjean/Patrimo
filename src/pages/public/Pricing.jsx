import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Sparkles, ArrowLeft, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { PLAN_LABELS } from '@/lib/planGate';

const PLANS = [
  {
    key: 'starter',
    price: '9 €',
    period: '/mois',
    desc: 'Pour démarrer avec un premier bien.',
    features: ['1 bien', 'Loyers & suivi banque', 'Coffre documentaire', 'Portail locataire'],
  },
  {
    key: 'pro',
    price: '29 €',
    period: '/mois',
    desc: 'Le pilotage complet d’un patrimoine jusqu’à 5 biens.',
    features: ['5 biens', 'Quittances & révisions IRL', 'Simulateur & fiscalité', 'Alertes unifiées', 'Rapport financier prêt-ready'],
    highlight: true,
    badge: 'Le plus choisi',
  },
  {
    key: 'business',
    price: '79 €',
    period: '/mois',
    desc: 'Tout Patrimo, sans limite, pour les portefeuilles conséquents.',
    features: ['Biens illimités', 'Partage avec le comptable', 'Connexion bancaire automatique', 'Support prioritaire', 'Multi-détenteurs (SCI)'],
  },
];

export default function Pricing() {
  const [promo, setPromo] = useState('');
  const [submitting, setSubmitting] = useState(null);

  const subscribe = async (plan) => {
    setSubmitting(plan);
    try {
      const authed = await base44.auth.isAuthenticated();
      if (!authed) {
        base44.auth.redirectToLogin('/pricing');
        return;
      }
      const res = await base44.functions.invoke('createCheckoutSession', { plan, promo_code: promo.trim() || undefined });
      const url = res?.data?.url;
      if (url) {
        window.location.href = url;
      } else {
        toast.error(res?.data?.error || 'Impossible de démarrer le paiement.');
      }
    } catch (e) {
      toast.error(e.message || 'Erreur lors de la création de la session.');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/landing" className="flex items-center gap-2">
            <svg className="w-7 h-7" viewBox="0 0 48 48" fill="none" aria-hidden="true">
              <rect width="48" height="48" rx="11" fill="#16305C" />
              <rect x="33" y="7" width="8" height="8" fill="#E8B23A" />
              <text x="23" y="33" textAnchor="middle" fontFamily="Inter" fontWeight="700" fontSize="22" fill="#E8B23A">Pa</text>
            </svg>
            <span className="font-display font-semibold text-lg">Patrimo</span>
          </Link>
          <Link to="/landing" className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Retour
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-4 pt-14 pb-8 text-center">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-accent/15 text-accent-foreground">
          <Sparkles className="w-3.5 h-3.5" /> 14 jours d'essai, sans carte bancaire
        </span>
        <h1 className="mt-4 font-display text-4xl sm:text-5xl font-semibold tracking-tight">
          Choisissez votre plan
        </h1>
        <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
          Démarrez gratuitement pendant 14 jours — aucune CB requise. Changez ou annulez à tout moment.
        </p>

        {/* Code promo */}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Input
            value={promo}
            onChange={(e) => setPromo(e.target.value)}
            placeholder="Code promo (optionnel)"
            className="max-w-xs"
          />
        </div>
      </section>

      {/* Plans */}
      <section className="max-w-5xl mx-auto px-4 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PLANS.map((p) => (
            <div
              key={p.key}
              className={`relative rounded-2xl border bg-card p-6 flex flex-col ${p.highlight ? 'border-primary shadow-lg md:scale-[1.03]' : 'border-border'}`}
            >
              {p.badge && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-semibold px-3 py-1 rounded-full bg-accent text-accent-foreground whitespace-nowrap">
                  {p.badge}
                </span>
              )}
              <h3 className="font-display text-xl font-semibold">{PLAN_LABELS[p.key]}</h3>
              <p className="mt-1 text-xs text-muted-foreground min-h-[2.5em]">{p.desc}</p>
              <p className="mt-4 font-display text-3xl font-semibold">
                {p.price}<span className="text-sm font-inter font-normal text-muted-foreground">{p.period}</span>
              </p>
              <ul className="mt-5 space-y-2.5 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="mt-6 w-full gap-2"
                variant={p.highlight ? 'default' : 'outline'}
                onClick={() => subscribe(p.key)}
                disabled={submitting !== null}
              >
                {submitting === p.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Démarrer l'essai
              </Button>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Sans engagement. Réglez par carte une fois l'essai terminé, ou continuez gratuitement en Starter.
        </p>
      </section>
    </div>
  );
}