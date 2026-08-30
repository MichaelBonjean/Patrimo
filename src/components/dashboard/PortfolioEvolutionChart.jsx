import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { getShortMonthName } from '@/lib/formatters';
import { useOwnerFilter } from '@/lib/tenantFilter';

const MONTHS_FR = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];

function monthKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Évolution 24 mois du cash-flow mensuel net (revenus − dépenses).
 * Source : toutes les Transaction du propriétaire (24 derniers mois).
 */
export default function PortfolioEvolutionChart() {
  const { withOwner } = useOwnerFilter();
  const { data: tx = [] } = useQuery({
    queryKey: ['transactions-all-24m'],
    queryFn: () => base44.entities.Transaction.filter(withOwner(), '-created_date', 2000),
    staleTime: 60_000,
  });

  const series = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${MONTHS_FR[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, net: 0 });
    }
    const idx = new Map(months.map((m) => [m.key, m]));
    for (const t of tx || []) {
      const k = t.year && t.month ? `${t.year}-${String(t.month).padStart(2, '0')}` : (t.created_date ? monthKey(t.created_date) : null);
      if (!k) continue;
      const m = idx.get(k);
      if (!m) continue;
      m.net += Number(t.amount || 0);
    }
    return months;
  }, [tx]);

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold">Évolution 24 mois — cash-flow net</h3>
        <span className="text-xs text-muted-foreground">somme mensuelle des opérations</span>
      </div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <AreaChart data={series} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="cfGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(220 60% 25%)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(220 60% 25%)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={42}
              tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`)} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 12 }}
              formatter={(v) => [`${Math.round(v).toLocaleString('fr-FR')} €`, 'Net']}
            />
            <Area type="monotone" dataKey="net" stroke="hsl(220 60% 25%)" strokeWidth={2} fill="url(#cfGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}