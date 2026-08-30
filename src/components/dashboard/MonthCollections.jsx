// Zone 2 — "Encaissements du mois" : mini-vue du compte locataire sur le mois courant.
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Wallet, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatCurrencyDecimal, formatDateFR } from '@/lib/formatters';
import { useOwnerFilter } from '@/lib/tenantFilter';

export default function MonthCollections() {
  const { withOwner } = useOwnerFilter();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const monthLabel = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const { data: rentDues = [] } = useQuery({
    queryKey: ['rent-dues', period],
    queryFn: () => base44.entities.RentDue.filter(withOwner({ period })),
  });
  const { data: payments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: () => base44.entities.Payment.filter(withOwner()),
    staleTime: 60_000,
  });

  const { expected, received, recent } = useMemo(() => {
    const expected = (rentDues || []).reduce((s, r) => s + (Number(r.total_due) || 0), 0);
    const received = (rentDues || []).reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);
    const inMonth = (payments || [])
      .filter((p) => {
        if (!p.date) return false;
        const d = new Date(p.date);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 3);
    return { expected, received, recent: inMonth };
  }, [rentDues, payments, year, month]);

  const pct = expected > 0 ? Math.min(100, Math.round((received / expected) * 100)) : 0;
  const barColor = pct >= 95 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500';
  const pctColor = pct >= 95 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-rose-600';

  return (
    <section>
      <div className="mb-3 px-1 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Encaissements du mois</h2>
          <p className="text-sm text-muted-foreground capitalize">{monthLabel}</p>
        </div>
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link to="/loyers?tab=compte-locataire">Voir tous les loyers <ArrowRight className="w-4 h-4" /></Link>
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-sm text-muted-foreground">Reçus / attendus</p>
            <p className="text-2xl font-bold tabular-nums">
              {formatCurrencyDecimal(received)} <span className="text-base font-normal text-muted-foreground">/ {formatCurrency(expected)}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Taux d'encaissement</p>
            <p className={`text-lg font-semibold ${pctColor}`}>{pct}%</p>
          </div>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>

        <div className="mt-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Derniers paiements reçus</p>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3">Aucun paiement reçu ce mois-ci pour l'instant.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 shrink-0"><Wallet className="w-4 h-4" /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{p.payer_name || 'Paiement'}</p>
                      <p className="text-xs text-muted-foreground">{formatDateFR(p.date)}{p.method ? ` · ${p.method}` : ''}</p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-emerald-600">+{formatCurrencyDecimal(p.amount)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}