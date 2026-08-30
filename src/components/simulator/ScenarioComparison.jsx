import React from 'react';
import { formatCurrency, formatCurrencyDecimal, formatPercent } from '@/lib/formatters';
import { cn } from '@/lib/utils';

function fmt(v, kind) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  if (kind === 'pct') return formatPercent(v);
  if (kind === 'dec') return formatCurrencyDecimal(v);
  return formatCurrency(v);
}

const ROWS = [
  { key: 'totalCost', label: 'Coût total' },
  { key: 'cashInvested', label: 'Cash investi' },
  { key: 'annualRentGross', label: 'Loyer brut /an' },
  { key: 'annualCharges', label: 'Charges /an' },
  { key: 'noi', label: 'NOI /an' },
  { key: 'monthlyPayment', label: 'Mensualité (crédit)', kind: 'dec' },
  { key: 'monthlyTotal', label: 'Mensualité + assur.', kind: 'dec' },
  { key: 'grossYield', label: 'Rendement brut', kind: 'pct' },
  { key: 'netYield', label: 'Rendement net', kind: 'pct' },
  { key: 'cashFlowMonthly', label: 'Cash-flow /mois', kind: 'dec' },
  { key: 'cashFlowAnnual', label: 'Cash-flow /an', kind: 'dec' },
  { key: 'cashOnCash', label: 'Cash-on-cash', kind: 'pct' },
  { key: 'dscr', label: 'DSCR', kind: 'raw' },
  { key: 'ltv', label: 'LTV', kind: 'pct' },
];

export default function ScenarioComparison({ scenarios }) {
  const cols = scenarios.slice(0, 4);
  if (!cols.length) return null;

  const best = (key, lowerBetter) => {
    const vals = cols.map((s) => s.metrics?.[key]).filter((v) => v !== undefined && v !== null && !isNaN(v));
    if (!vals.length) return null;
    return lowerBetter ? Math.min(...vals) : Math.max(...vals);
  };
  const bestMap = {
    grossYield: best('grossYield', false),
    netYield: best('netYield', false),
    cashOnCash: best('cashOnCash', false),
    cashFlowAnnual: best('cashFlowAnnual', false),
    dscr: best('dscr', false),
    ltv: best('ltv', true),
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left font-medium text-muted-foreground p-3 sticky left-0 bg-card">Indicateur</th>
            {cols.map((s) => (
              <th key={s.id} className="text-right font-semibold p-3 min-w-[140px]">{s.name || 'Scénario'}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, idx) => (
            <tr key={row.key} className={cn(idx % 2 ? 'bg-muted/30' : '', 'border-b border-border/60')}>
              <td className="p-3 sticky left-0 bg-inherit">{row.label}</td>
              {cols.map((s) => {
                const v = s.metrics?.[row.key];
                const isBest = bestMap[row.key] !== null && v === bestMap[row.key];
                return (
                  <td key={s.id} className={cn('p-3 text-right tabular-nums', isBest && 'font-bold text-chart-1')}>
                    {row.key === 'dscr' ? (v ? v.toFixed(2) : '—') : fmt(v, row.kind)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}