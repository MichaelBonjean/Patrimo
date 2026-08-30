import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { BellRing, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AlertCard from '@/components/alerts/AlertCard';
import { PRIORITY_ORDER } from '@/lib/alerts';

export default function AlertsWidget({ max = 6 }) {
  const q = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const res = await base44.functions.invoke('manageAlerts', { op: 'list' });
      const data = res.data || res;
      return { alerts: data.alerts || [], counts: data.counts || {} };
    },
    staleTime: 60_000,
  });

  if (q.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground py-2"><Loader2 className="w-4 h-4 animate-spin" /> Analyse des alertes…</div>;
  }
  const alerts = (q.data?.alerts || []).filter((a) => a.status === 'active');
  const counts = q.data?.counts || {};
  const top = alerts
    .sort((a, b) => PRIORITY_ORDER.indexOf(b.priority) - PRIORITY_ORDER.indexOf(a.priority) || String(a.date).localeCompare(String(b.date)))
    .slice(0, max);

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <BellRing className="w-4 h-4 text-emerald-600" /> Aucune alerte active — votre patrimoine est à jour.
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2.5 px-1">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <BellRing className="w-3.5 h-3.5" /> Alertes prioritaires
          {counts.urgent > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">{counts.urgent} urgent</span>}
        </h2>
        <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
          <Link to="/alertes">Voir tout ({alerts.length}) <ArrowRight className="w-3 h-3 ml-1" /></Link>
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        {top.map((a) => <AlertCard key={a.id} alert={a} compact />)}
      </div>
    </section>
  );
}