import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calculator, Building2, Info, ShieldAlert, FileText } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { useOwnerFilter } from '@/lib/tenantFilter';
import OnboardingEmptyState from '@/components/OnboardingEmptyState';
import { buildEstimate } from '@/lib/taxEngine';
import SlowLoadingMessage from '@/components/ui/SlowLoadingMessage';

function SignLine({ line }) {
  const sign = line.sign;
  const isResult = sign === '=';
  const isInfo = sign === 'info';
  return (
    <div className={cn('flex items-center justify-between py-1 text-sm', isResult && 'border-t border-border mt-1 pt-1 font-semibold')}>
      <span className={cn(isInfo ? 'text-muted-foreground' : 'text-foreground/90')}>{line.label}</span>
      <span className={cn(
        'number-fr tabular-nums',
        isInfo && 'text-muted-foreground',
        sign === '+' && 'text-emerald-600',
        sign === '-' && 'text-red-500',
        isResult && (line.amount >= 0 ? 'text-foreground' : 'text-red-500'),
      )}>
        {formatCurrency(line.amount, sign === '-')}
      </span>
    </div>
  );
}

function PropertyTaxCard({ property, transactions, year }) {
  const est = useMemo(
    () => buildEstimate({ property, transactions, year }),
    [property, transactions, year]
  );

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{property.name}</p>
            <p className="text-xs text-muted-foreground truncate">{property.city || property.address || '—'}</p>
          </div>
        </div>
        <Badge variant="secondary" className="text-xs flex-shrink-0">{property.tax_regime || 'Non défini'}</Badge>
      </div>

      <div className="p-5 space-y-4">
        {est.unsupported ? (
          <div className="flex items-start gap-2 rounded-lg p-3 bg-amber-50 border border-amber-200 text-amber-800">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p className="text-xs">{est.regimeLabel}{est.hypotheses[est.hypotheses.length - 1] ? ` — ${est.hypotheses[est.hypotheses.length - 1]}` : ''}</p>
          </div>
        ) : (
          <>
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Calculator className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold">{est.regimeLabel}</p>
              </div>
              <div className="space-y-0.5">
                {est.lines.map((l, i) => <SignLine key={i} line={l} />)}
              </div>
            </div>

            {(est.info.length > 0) && (
              <details className="group">
                <summary className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1 select-none">
                  <Info className="w-3 h-3" /> Hors calcul ({est.info.length}) — transparence
                </summary>
                <div className="mt-1 pl-4 border-l border-border space-y-0.5">
                  {est.info.map((l, i) => <SignLine key={i} line={l} />)}
                </div>
              </details>
            )}

            <div className="rounded-lg p-3 bg-muted/40 border border-border">
              <p className="text-[11px] font-medium text-foreground/80 mb-1 flex items-center gap-1"><FileText className="w-3 h-3" /> Origine & hypothèses</p>
              <p className="text-[11px] text-muted-foreground mb-1">{est.origin}</p>
              <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
                {est.hypotheses.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </div>
          </>
        )}
        <p className="text-[10px] text-muted-foreground italic flex items-start gap-1">
          <ShieldAlert className="w-3 h-3 flex-shrink-0 mt-0.5" />
          {est.disclaimer}
        </p>
      </div>
    </div>
  );
}

export default function Taxes() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const { withOwner } = useOwnerFilter();

  const { data: properties = [] } = useQuery({
    queryKey: ['properties'], queryFn: () => base44.entities.Property.filter(withOwner()),
  });
  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['transactions-taxes', year], queryFn: () => base44.entities.Transaction.filter(withOwner({ year })),
  });

  const propertyTxMap = useMemo(() => {
    const map = {};
    for (const t of transactions) { (map[t.property_id] ||= []).push(t); }
    return map;
  }, [transactions]);

  const totals = useMemo(() => {
    let revenue = 0, deductible = 0, base = 0, is = 0;
    for (const p of properties) {
      const e = buildEstimate({ property: p, transactions: propertyTxMap[p.id] || [], year });
      revenue += e.revenue;
      deductible += e.deductibleCharges + e.interest + e.amortissement;
      base += e.taxableBase;
      is += e.tax;
    }
    return { revenue, deductible, base, is };
  }, [properties, propertyTxMap, year]);

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-[1600px]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Simulation fiscale</h1>
          <p className="text-sm text-muted-foreground mt-1">Estimation indicative par bien — {year}</p>
        </div>
        <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Array.from({ length: 5 }, (_, i) => currentYear - i).map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-start gap-2 rounded-lg p-3 bg-amber-50 border border-amber-200 text-amber-900">
        <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p className="text-xs">
          <span className="font-semibold">Simulation indicative ne constituant pas une déclaration fiscale ni un conseil fiscal.</span>{' '}
          Estimations explicables à partir des transactions saisies et du prêt renseigné. Le capital remboursé du prêt n'est jamais déductible ; seuls les intérêts le sont. Aucune charge bancaire n'est considérée comme déductible par défaut.
        </p>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
          <SlowLoadingMessage isLoading message={`Calcul de votre revenu foncier ${year}…`} />
        </div>
      ) : properties.length === 0 ? (
        <OnboardingEmptyState icon={Calculator} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {properties.map(p => (
            <PropertyTaxCard key={p.id} property={p} transactions={propertyTxMap[p.id] || []} year={year} />
          ))}
        </div>
      )}

      {properties.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="font-semibold text-sm mb-4">Total consolidé — {year}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Revenus imposables</p>
              <p className="text-lg font-bold text-emerald-600 number-fr">{formatCurrency(totals.revenue)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Charges déductibles (réel)</p>
              <p className="text-lg font-bold text-red-500 number-fr">{formatCurrency(totals.deductible, true)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Base nette simulée</p>
              <p className={cn("text-lg font-bold number-fr", totals.base >= 0 ? 'text-foreground' : 'text-red-500')}>
                {formatCurrency(totals.base, true)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">IS simulé</p>
              <p className="text-lg font-bold text-red-500 number-fr">{formatCurrency(totals.is)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}