import React from 'react';
import { useAuth } from '@/lib/AuthContext';
import { Link } from 'react-router-dom';
import { Sparkles, AlertTriangle } from 'lucide-react';
import { trialDaysLeft, getEffectivePlan, PLAN_LABELS } from '@/lib/planGate';

// Bandeau discret : essai d'inscription (compte à rebours + prompt J-3) et
// relance past_due. N'affiche rien pour les abonnés actifs/annulés silencieux.

export default function BillingBanner() {
  const { user } = useAuth();
  if (!user) return null;

  const status = user.subscription_status || 'none';

  if (status === 'past_due') {
    return (
      <div className="bg-red-50 border-b border-red-200 text-red-800">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2 text-xs sm:text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">Paiement échoué — votre abonnement est en souffrance. Sans régularisation sous 7 jours, votre compte repassera en Starter.</span>
          <Link to="/facturation" className="font-semibold underline whitespace-nowrap">Régulariser</Link>
        </div>
      </div>
    );
  }

  const days = trialDaysLeft(user);
  if (days <= 0) return null;

  const urgent = days <= 3;
  const plan = getEffectivePlan(user);

  return (
    <div className={`${urgent ? 'bg-accent/15 border-accent/30' : 'bg-primary/5 border-primary/10'} border-b`}>
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2 text-xs sm:text-sm">
        <Sparkles className={`w-4 h-4 shrink-0 ${urgent ? 'text-accent' : 'text-primary'}`} />
        <span className="flex-1 text-foreground/80">
          Essai {PLAN_LABELS[plan] || 'Business'} — il vous reste <strong>{days} jour{days > 1 ? 's' : ''}</strong>.
          {urgent && ' Pensez à souscrire pour conserver vos accès.'}
        </span>
        <Link to="/pricing" className="font-semibold text-primary whitespace-nowrap hover:underline">Choisir un plan</Link>
      </div>
    </div>
  );
}