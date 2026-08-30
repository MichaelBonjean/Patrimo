import React, { useState, useMemo } from 'react';
import { formatCurrencyDecimal, formatCurrency } from '@/lib/formatters';
import { ChevronDown, ChevronUp, TrendingDown, Calendar, PiggyBank, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildSchedule, currentCRD, scheduleTotals, getMonthlyPayment } from '@/lib/loanEngine';

function StatBox({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-base font-bold number-fr">{value}</p>
      </div>
    </div>
  );
}

export default function AmortizationTable({ property }) {
  const [showAll, setShowAll] = useState(false);

  const schedule = useMemo(
    () => buildSchedule(property),
    [property?.loan_amount, property?.loan_rate, property?.loan_duration_years, property?.loan_start_date, property?.loan_deferred_months, property?.monthly_payment, property?.monthly_insurance]
  );

  if (!schedule.length) {
    return (
      <div className="text-center py-10 text-muted-foreground border border-dashed border-border rounded-xl">
        <TrendingDown className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">Renseigner le montant, taux, durée et date de début du prêt pour calculer l'amortissement</p>
      </div>
    );
  }

  const totals = scheduleTotals(schedule);
  const monthlyPayment = getMonthlyPayment(property);
  const monthlyInsurance = Number(property?.monthly_insurance || 0);

  // Position courante (CRD vivant via le moteur canonique)
  const crdNow = currentCRD(property);
  const today = new Date();
  const currentMonthIdx = schedule.findIndex(r => r.date > today);
  const paidMonths = currentMonthIdx === -1 ? schedule.length : currentMonthIdx;
  const remainingMonths = schedule.length - paidMonths;
  const totalPaid = schedule.slice(0, paidMonths).reduce((s, r) => s + r.payment, 0);
  const totalInterestPaid = schedule.slice(0, paidMonths).reduce((s, r) => s + r.interest, 0);

  // Show around current month: 3 past + current + 20 future, or all if showAll
  const displayRows = showAll
    ? schedule
    : schedule.slice(Math.max(0, paidMonths - 3), Math.min(schedule.length, paidMonths + 21));

  return (
    <div className="space-y-5">
      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="CRD aujourd'hui" value={formatCurrencyDecimal(crdNow)} icon={TrendingDown} color="bg-red-100 text-red-600" />
        <StatBox label="Mois restants" value={`${remainingMonths} mois`} icon={Calendar} color="bg-amber-100 text-amber-600" />
        <StatBox label="Mensualité (hors ass.)" value={formatCurrencyDecimal(monthlyPayment + monthlyInsurance)} icon={PiggyBank} color="bg-primary/10 text-primary" />
        <StatBox label="Intérêts totaux prêt" value={formatCurrencyDecimal(totals.totalInterest)} icon={Shield} color="bg-muted text-muted-foreground" />
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{paidMonths} mois payés</span>
          <span>{remainingMonths} mois restants</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${schedule.length ? (paidMonths / schedule.length) * 100 : 0}%` }} />
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-primary font-medium">{schedule.length ? ((paidMonths / schedule.length) * 100).toFixed(1) : 0}% remboursé</span>
          <span className="text-muted-foreground">Capital initial : {formatCurrency(property.loan_amount)}</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">N°</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Date</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Échéance</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Capital</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Intérêts</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Assurance</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">CRD</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => {
                const isCurrent = row.number === paidMonths + 1;
                const isPast = row.number <= paidMonths;
                return (
                  <tr key={row.number}
                    className={`border-b transition-colors ${
                      isCurrent
                        ? 'bg-primary/10 border-primary/30 font-semibold ring-1 ring-inset ring-primary/20'
                        : isPast
                          ? 'opacity-40 border-border/30'
                          : row.isDeferred
                            ? 'bg-amber-50/40 border-border/50 hover:bg-amber-50/60'
                            : 'border-border/50 hover:bg-muted/30'
                    }`}>
                    <td className={`px-3 py-1.5 ${isCurrent ? 'text-primary font-bold' : 'text-muted-foreground'}`}>{row.number}</td>
                    <td className="px-3 py-1.5">
                      <span className={isCurrent ? 'text-primary font-semibold' : ''}>
                        {row.date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}
                      </span>
                      {isCurrent && <span className="ml-1.5 text-[10px] bg-primary text-primary-foreground rounded px-1 py-0.5 font-bold">maintenant</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right number-fr">{formatCurrencyDecimal(row.payment)}</td>
                    <td className="px-3 py-1.5 text-right number-fr text-emerald-600">
                      {formatCurrencyDecimal(row.principal)}
                      {row.earlyRepayment > 0 && <span className="block text-[10px] text-primary font-medium">+{formatCurrencyDecimal(row.earlyRepayment)} ant.</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right number-fr text-red-500">{formatCurrencyDecimal(row.interest)}</td>
                    <td className="px-3 py-1.5 text-right number-fr text-muted-foreground">{formatCurrencyDecimal(row.insurance)}</td>
                    <td className="px-3 py-1.5 text-right number-fr font-medium">{formatCurrencyDecimal(row.remaining)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {schedule.length > 24 && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="ghost" size="sm" onClick={() => setShowAll(v => !v)} className="gap-1.5 text-xs">
              {showAll ? <><ChevronUp className="w-3.5 h-3.5" />Réduire</> : <><ChevronDown className="w-3.5 h-3.5" />Voir les {schedule.length} échéances</>}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}