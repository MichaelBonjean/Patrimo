import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Sparkles, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PLAN_LABELS } from '@/lib/planGate';

const PLANS = [
  {
    key: 'starter',
    price: '9 €',
    period: '/mois',
    features: ['1 bien', 'Loyers & banque', 'Coffre documentaire'],
  },
  {
    key: 'pro',
    price: '29 €',
    period: '/mois',
    features: ['5 biens', 'Quittances & révisions IRL', 'Simulateur & fiscalité'],
    highlight: true,
    badge: 'Le plus choisi',
  },
  {
    key: 'business',
    price: '79 €',
    period: '/mois',
    features: ['Biens illimités', 'Partage comptable', 'Connexion bancaire auto', 'Support prioritaire'],
  },
];

export default function UpgradeDialog({ open, onClose, currentCount = 0, feature, requiredPlan = 'pro' }) {
  const navigate = useNavigate();

  const message = feature
    ? `La fonctionnalité « ${feature} » nécessite un plan supérieur.`
    : `Vous avez atteint la limite de biens de votre plan (${currentCount}). Passez à un plan supérieur pour continuer.`;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            Passez à un plan supérieur
          </DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          {PLANS.map((p) => (
            <div
              key={p.key}
              className={`relative rounded-xl border p-4 flex flex-col ${p.highlight ? 'border-primary bg-primary/5' : 'border-border'}`}
            >
              {p.badge && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent text-accent-foreground whitespace-nowrap">
                  {p.badge}
                </span>
              )}
              <p className="font-semibold text-sm">{PLAN_LABELS[p.key]}</p>
              <p className="mt-1 font-display text-xl font-semibold">{p.price}<span className="text-xs font-inter font-normal text-muted-foreground">{p.period}</span></p>
              <ul className="mt-3 space-y-1.5 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" />
          14 jours d'essai gratuit, sans carte bancaire requise.
        </p>

        <DialogFooter className="mt-2">
          <Button variant="ghost" onClick={onClose}>Plus tard</Button>
          <Button onClick={() => { onClose(); navigate('/pricing'); }} className="gap-2">
            <Sparkles className="w-4 h-4" />
            Voir les offres
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}