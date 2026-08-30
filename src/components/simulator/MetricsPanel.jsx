import React from 'react';
import { formatCurrency, formatCurrencyDecimal, formatPercent } from '@/lib/formatters';
import { cn } from '@/lib/utils';

function Metric({ label, value, tone, hint }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-bold tabular-nums", tone === 'pos' && 'text-chart-1', tone === 'neg' && 'text-destructive')}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function MetricsPanel({ m }) {
  if (!m) return null;
  const cfTone = m.cashFlowAnnual >= 0 ? 'pos' : 'neg';
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <Metric label="Coût total" value={formatCurrency(m.totalCost)} hint="prix + notaire + agence + travaux + meubles" />
      <Metric label="Mensualité" value={formatCurrencyDecimal(m.monthlyTotal)} hint={`dont ${formatCurrencyDecimal(m.monthlyInsurance)} assurance`} />
      <Metric label="Rdt brut" value={formatPercent(m.grossYield)} hint={`${formatCurrency(m.annualRentGross)}/an`} />
      <Metric label="Rdt net" value={formatPercent(m.netYield)} hint="after charges & vacance" />
      <Metric label="Cash-flow" value={formatCurrencyDecimal(m.cashFlowMonthly)} hint={`${formatCurrency(m.cashFlowAnnual)}/an`} tone={cfTone} />
      <Metric label="Cash-on-cash" value={formatPercent(m.cashOnCash)} hint={`cash : ${formatCurrency(m.cashInvested)}`} tone={cfTone} />
      <Metric label="DSCR" value={m.dscr ? m.dscr.toFixed(2) : '—'} hint="NOI / service dette" tone={m.dscr >= 1.2 ? 'pos' : 'neg'} />
      <Metric label="LTV" value={formatPercent(m.ltv)} hint="loan / coût total" />
    </div>
  );
}