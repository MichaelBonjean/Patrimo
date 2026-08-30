import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, X, ArrowRight } from 'lucide-react';

const LABELS = {
  rents: { icon: '🔑', prefix: 'reconnu', subject: 'loyer(s)' },
  credits: { icon: '🏦', prefix: 'mis à jour', subject: 'vos crédits' },
  quittances: { icon: '🧾', prefix: 'préparé', subject: 'des quittances' },
  alerts: { icon: '🔔', prefix: 'levé', subject: 'des alertes' },
  impayes: { icon: '⚠️', prefix: 'détecté', subject: 'des impayés' },
  docs: { icon: '📄', prefix: 'classé', subject: 'des documents' },
};

/**
 * Popup "Depuis votre dernière visite, Patrimo a :".
 * S'affiche une fois par visite (le backend marque last_visit_seen_at).
 * Ne s'affiche que s'il y a au moins une ligne ou un élément à vérifier.
 */
export default function BackgroundJobsPopup() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['visit-summary'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getVisitSummary', {});
      return res.data;
    },
    staleTime: Infinity,
    retry: false,
  });

  // Ne pas afficher tant le chargement ou si vide.
  if (isLoading || dismissed || !data || data.ok === false) return null;
  const lines = data.lines || [];
  const toVerify = data.to_verify || 0;
  if (!lines.length && !toVerify) return null;

  return (
    <Card className="relative mb-4 overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Fermer"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <p className="font-heading text-sm font-semibold text-foreground">
            Depuis votre dernière visite, Patrimo a :
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {lines.map((l) => {
            const meta = LABELS[l.key] || { icon: '•', prefix: '', subject: l.label };
            return (
              <div key={l.key} className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="text-base leading-none">{meta.icon}</span>
                <span className="number-fr font-semibold text-foreground">{l.count}</span>
                <span>{meta.prefix} {meta.subject}.</span>
              </div>
            );
          })}
          {toVerify > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-base leading-none">🔎</span>
              <span className="number-fr font-semibold text-foreground">{toVerify}</span>
              <span>élément(s) à vérifier.</span>
            </div>
          )}
        </div>
        {toVerify > 0 && (
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={() => navigate('/a-faire')}>
              Voir les éléments à vérifier
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}