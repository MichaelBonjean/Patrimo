import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Lock, Unlock, History } from 'lucide-react';
import { formatCurrency, formatPercent } from '@/lib/formatters';

function Stat({ label, value, tone = 'default' }) {
  const cls = { positive: 'text-emerald-700', negative: 'text-rose-700', default: 'text-foreground' }[tone];
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold number-fr ${cls}`}>{value}</p>
    </div>
  );
}

export default function MonthSummary({ summary, status, onClose, onReopen, busy }) {
  const closed = status === 'closed';
  return (
    <div className="bg-card rounded-xl border border-border">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Résumé du mois</h2>
          <p className="text-xs text-muted-foreground">{summary.period}</p>
        </div>
        <Badge variant={closed ? 'default' : 'secondary'} className={closed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>
          {closed ? 'Clôturé' : 'À clôturer'}
        </Badge>
      </div>
      <div className="p-4 grid grid-cols-2 gap-2.5">
        <Stat label="Loyers attendus" value={formatCurrency(summary.expectedRent)} />
        <Stat label="Encaissé" value={formatCurrency(summary.collectedRent)} tone="positive" />
        <Stat label="Encaissement" value={formatPercent(summary.encaissementRate)} tone={summary.encaissementRate >= 99.5 ? 'positive' : summary.encaissementRate < 95 ? 'negative' : 'default'} />
        <Stat label="Impayés" value={formatCurrency(summary.impayeAmount)} tone={summary.impayeAmount > 0 ? 'negative' : 'positive'} />
        <Stat label="CAF / APL" value={formatCurrency(summary.cafAmount)} />
        <Stat label="Cash-flow" value={formatCurrency(summary.cashflow, true)} tone={summary.cashflow >= 0 ? 'positive' : 'negative'} />
        <Stat label="Quittances envoyées" value={`${summary.quittanceSent} / ${summary.quittanceCount || summary.duesCount || 0}`} />
        <Stat label="Transactions à vérifier" value={String(summary.toVerifyCount)} tone={summary.toVerifyCount > 0 ? 'warning' : 'positive'} />
      </div>
      <div className="px-4 pb-4">
        {closed ? (
          <Button variant="outline" className="w-full" onClick={onReopen} disabled={busy}>
            <Unlock className="w-4 h-4 mr-2" />Rouvrir le mois
          </Button>
        ) : (
          <Button className="w-full" onClick={onClose} disabled={busy}>
            <Lock className="w-4 h-4 mr-2" />Clôturer le mois
          </Button>
        )}
        <p className="text-[11px] text-muted-foreground mt-2 text-center flex items-center justify-center gap-1">
          <History className="w-3 h-3" />Clôture réversible — toute réouverture est historisée.
        </p>
      </div>
    </div>
  );
}