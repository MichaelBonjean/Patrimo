// Zone 1 — "À faire aujourd'hui" : cartes actionnables issues du moteur d'alertes.
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  AlertTriangle, RefreshCw, CalendarClock, TrendingUp, Gauge, ShieldAlert,
  Receipt, Users, CreditCard, FileText, AlertCircle, Sparkles, ArrowRight,
} from 'lucide-react';
import { PRIORITY_ORDER } from '@/lib/alerts';

const SOURCE_META = {
  loyer_impaye: { icon: AlertTriangle, tone: 'rose' },
  paiement_non_rapproche: { icon: RefreshCw, tone: 'amber' },
  bail_expirant: { icon: CalendarClock, tone: 'amber' },
  indexation_disponible: { icon: TrendingUp, tone: 'blue' },
  dpe: { icon: Gauge, tone: 'blue' },
  assurance: { icon: ShieldAlert, tone: 'blue' },
  echeance_fiscale: { icon: Receipt, tone: 'amber' },
  ag_copropriete: { icon: Users, tone: 'blue' },
  echeance_credit: { icon: CreditCard, tone: 'amber' },
  document_manquant: { icon: FileText, tone: 'blue' },
  anomalie_financiere: { icon: AlertCircle, tone: 'amber' },
};

const TONE = {
  rose: { icon: 'bg-rose-50 text-rose-600', border: 'border-rose-100' },
  amber: { icon: 'bg-amber-50 text-amber-600', border: 'border-amber-100' },
  blue: { icon: 'bg-sky-50 text-sky-600', border: 'border-sky-100' },
};

export default function TodayActions() {
  const { data, isLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const res = await base44.functions.invoke('manageAlerts', { op: 'list' });
      const d = res.data || res;
      return { alerts: d.alerts || [], counts: d.counts || {} };
    },
    staleTime: 60_000,
  });

  const active = (data?.alerts || []).filter((a) => a.status === 'active');
  const top = [...active]
    .sort((a, b) => PRIORITY_ORDER.indexOf(b.priority) - PRIORITY_ORDER.indexOf(a.priority) || String(a.date).localeCompare(String(b.date)))
    .slice(0, 5);

  return (
    <section>
      <div className="mb-3 px-1">
        <h2 className="text-lg font-semibold tracking-tight">À faire aujourd'hui</h2>
        <p className="text-sm text-muted-foreground">Vos priorités d'action immédiates.</p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground animate-pulse">Analyse des priorités…</div>
      ) : top.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
            <Sparkles className="w-7 h-7 text-emerald-600" />
          </div>
          <p className="text-base font-semibold">Tout est à jour ✨</p>
          <p className="text-sm text-muted-foreground mt-1">Aucune action prioritaire détectée sur votre patrimoine.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {top.map((a) => {
            const meta = SOURCE_META[a.source] || SOURCE_META.paiement_non_rapproche;
            const Icon = meta.icon;
            const tone = TONE[meta.tone] || TONE.amber;
            return (
              <div key={a.id} className={`rounded-xl border ${tone.border} bg-card p-4 flex flex-col gap-3`}>
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${tone.icon}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-tight">{a.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.message}</p>
                  </div>
                </div>
                <Link to={a.action_url || '/'} className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                  {a.recommended_action || 'Traiter'} <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}