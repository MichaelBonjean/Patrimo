import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, AlertTriangle, ArrowDownRight, ArrowUpRight, Calendar } from 'lucide-react';
import { computeCashflowCompare, periodLabel } from '@/lib/cashflowCompare';
import { formatCurrency, formatPercent } from '@/lib/formatters';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { cn } from '@/lib/utils';

const MONTH_LABELS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

const PERIODS = [
  { kind: 'month', label: 'Mois' },
  { kind: 'ytd', label: 'YTD' },
  { kind: 't12m', label: '12 mois' },
  { kind: 'year', label: 'Année' },
];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CashflowCompare() {
  const { withOwner } = useOwnerFilter();
  const now = new Date();
  const [kind, setKind] = useState('month');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data: properties = [] } = useQuery({ queryKey: ['properties'], queryFn: () => base44.entities.Property.filter(withOwner()) });
  const { data: leases = [] } = useQuery({ queryKey: ['leases'], queryFn: () => base44.entities.Lease.filter(withOwner()) });
  const { data: transactions = [] } = useQuery({ queryKey: ['transactions-all'], queryFn: () => base44.entities.Transaction.filter(withOwner()) });

  const period = useMemo(() => {
    const p = { kind, year, asOf: todayISO() };
    if (kind === 'month') p.month = month;
    return p;
  }, [kind, year, month]);

  const result = useMemo(
    () => computeCashflowCompare({ properties, leases, transactions, period }),
    [properties, leases, transactions, period]
  );

  const years = [now.getFullYear(), now.getFullYear() - 1];

  return (
    <div className="space-y-4">
      {/* Sélecteur de période */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border p-0.5 bg-muted/30">
          {PERIODS.map((p) => (
            <Button
              key={p.kind}
              size="sm"
              variant={kind === p.kind ? 'default' : 'ghost'}
              className={cn('h-8', kind === p.kind ? '' : 'text-muted-foreground')}
              onClick={() => setKind(p.kind)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-[110px] h-8"><Calendar className="w-3.5 h-3.5 mr-1" /><SelectValue /></SelectTrigger>
          <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
        {kind === 'month' && (
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-[110px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTH_LABELS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <span className="text-sm text-muted-foreground ml-auto">{periodLabel(period)}</span>
      </div>

      {/* Complétude */}
      {result.period.partial && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-amber-800 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-xs">
            Période bancaire partielle : <strong>{result.period.coverageMonths} mois</strong> de banque sur {result.period.monthsCount}.
            Les indicateurs annualisés sont basés sur cette période partielle (annualisation × 12 / {result.period.coverageMonths || 1}).
          </p>
        </div>
      )}

      {/* 3 grands chiffres */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <BigStat label="Cash-flow réel" value={result.real.net} accent="real" />
        <BigStat label="Prévision" value={result.theoretical.net} accent="theo" />
        <BigStat label="Écart" value={result.variance.total} accent="variance" />
      </div>

      {/* Détail de l'écart */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium"><TrendingUp className="w-4 h-4 text-primary" /> Explication de l’écart</div>
          {result.variance.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun écart — le réel correspond à la prévision.</p>
          ) : (
            <ul className="divide-y divide-border">
              {result.variance.items.map((it, i) => (
                <li key={i} className="flex items-center justify-between py-2">
                  <span className="text-sm">{it.label}</span>
                  <span className={cn('text-sm font-semibold number-fr', it.amount < 0 ? 'text-red-500' : 'text-emerald-600')}>
                    {it.amount < 0 ? <ArrowDownRight className="w-3.5 h-3.5 inline mr-1" /> : <ArrowUpRight className="w-3.5 h-3.5 inline mr-1" />}
                    {formatCurrency(it.amount, true)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Performance (mêmes formules que le cockpit) */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium"><TrendingUp className="w-4 h-4 text-primary" /> Rentabilité</div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <YieldCell label="Brute" real={result.performance.real.grossYield} theo={result.performance.theoretical.grossYield} />
            <YieldCell label="Nette" real={result.performance.real.netYield} theo={result.performance.theoretical.netYield} />
            <YieldCell label="Nette-nette" real={result.performance.real.netNetYield} theo={result.performance.theoretical.netNetYield} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Brute = revenus / prix de revient · Nette = cash-flow / prix de revient · Nette-nette = cash-flow / capital investi.
            {result.performance.real.annualized && ' Réel annualisé sur la période bancaire disponible.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function BigStat({ label, value, accent }) {
  const color = accent === 'real' ? 'text-primary' : accent === 'theo' ? 'text-muted-foreground' : (value < 0 ? 'text-red-500' : 'text-emerald-600');
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn('text-2xl font-bold number-fr mt-1', color)}>{formatCurrency(value, true)}</div>
      </CardContent>
    </Card>
  );
}

function YieldCell({ label, real, theo }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold number-fr mt-0.5">{formatPercent(real)}</div>
      <div className="text-[11px] text-muted-foreground">prév. {formatPercent(theo)}</div>
    </div>
  );
}