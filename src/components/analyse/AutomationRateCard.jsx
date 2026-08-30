import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, ChevronDown, Info } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const rateColor = (r) => (r == null ? 'text-muted-foreground' : r >= 90 ? 'text-emerald-600' : r >= 70 ? 'text-amber-600' : 'text-red-500');

function MiniBar({ auto, manual, total }) {
  if (!total) return <span className="text-xs text-muted-foreground">—</span>;
  const ap = Math.round((auto / total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden flex">
        <div className="bg-emerald-500 h-full" style={{ width: `${ap}%` }} />
        <div className="bg-amber-400 h-full" style={{ width: `${100 - ap}%` }} />
      </div>
      <span className="text-xs number-fr w-9 text-right text-muted-foreground">{ap}%</span>
    </div>
  );
}

export default function AutomationRateCard() {
  const [showMethod, setShowMethod] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['automation-rate'],
    queryFn: async () => {
      const res = await base44.functions.invoke('computeAutomationRate', {});
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card className="p-5">
        <div className="h-32 flex items-center justify-center">
          <div className="w-7 h-7 border-4 border-muted border-t-primary rounded-full animate-spin" />
        </div>
      </Card>
    );
  }
  if (!data || data.ok === false) return null;

  const { rate, totals, categories, history, methodology } = data;
  const monthLabel = data.period;

  return (
    <Card className="overflow-hidden">
      <div className="p-5">
        <div className="flex flex-col lg:flex-row gap-6 lg:items-center">
          {/* Headline */}
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
              <Sparkles className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Taux d'automatisation — {monthLabel}</p>
              <p className={`text-3xl font-bold number-fr ${rateColor(rate)}`}>
                {rate == null ? 'N/A' : `${rate}%`}
              </p>
              <p className="text-xs text-muted-foreground">
                de votre gestion automatisée ce mois-ci
              </p>
            </div>
          </div>

          {/* Totas rápido */}
          <div className="grid grid-cols-3 gap-3 flex-1 lg:max-w-md">
            <div className="text-center">
              <p className="text-lg font-semibold text-emerald-600 number-fr">{totals.auto}</p>
              <p className="text-[11px] text-muted-foreground">Automatiques</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-amber-600 number-fr">{totals.manual}</p>
              <p className="text-[11px] text-muted-foreground">Manuelles / validations</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-muted-foreground number-fr">{totals.pending}</p>
              <p className="text-[11px] text-muted-foreground">En attente</p>
            </div>
          </div>
        </div>

        {/* Historique 12 mois */}
        <div className="mt-5">
          <p className="text-xs font-medium text-muted-foreground mb-2">Historique 12 mois</p>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={history} margin={{ left: -16, right: 8, top: 4, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
                formatter={(v, n) => (n === 'rate' ? [v == null ? 'N/A' : `${v}%`, 'Taux'] : v)}
              />
              <Bar dataKey="rate" radius={[3, 3, 0, 0]}>
                {history.map((h, i) => (
                  <Cell key={i} fill={h.rate == null ? 'hsl(var(--muted-foreground))' : h.rate >= 90 ? 'hsl(142,71%,45%)' : h.rate >= 70 ? 'hsl(38,92%,50%)' : 'hsl(0,84%,60%)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Détail par catégorie */}
        <div className="mt-5">
          <p className="text-xs font-medium text-muted-foreground mb-2">Détail par type d'action</p>
          <div className="space-y-2">
            {categories.map((c) => (
              <div key={c.key} className="flex items-center gap-3 text-xs">
                <span className="w-40 shrink-0 text-muted-foreground truncate">{c.label}</span>
                <span className="w-10 text-right number-fr text-emerald-600 font-medium">{c.auto}</span>
                <span className="w-10 text-right number-fr text-amber-600">{c.manual}</span>
                <span className="w-10 text-right number-fr text-muted-foreground">{c.total}</span>
                <div className="flex-1"><MiniBar auto={c.auto} manual={c.manual} total={c.total} /></div>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
            <span><span className="inline-block w-2 h-2 bg-emerald-500 rounded-full mr-1" />Auto</span>
            <span><span className="inline-block w-2 h-2 bg-amber-400 rounded-full mr-1" />Manuel/validation</span>
            <span>colonnes : auto · manuel · total</span>
          </div>
        </div>

        <Button variant="ghost" size="sm" className="mt-3 gap-1 text-xs text-muted-foreground" onClick={() => setShowMethod((v) => !v)}>
          <Info className="h-3.5 w-3.5" />
          Méthode de calcul
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMethod ? 'rotate-180' : ''}`} />
        </Button>
        {showMethod && (
          <p className="mt-2 text-xs text-muted-foreground bg-muted/40 rounded-lg p-3 leading-relaxed">
            {methodology}
          </p>
        )}
      </div>
    </Card>
  );
}