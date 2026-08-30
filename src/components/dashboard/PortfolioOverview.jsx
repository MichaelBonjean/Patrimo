// Zone 3 — "Patrimoine en un coup d'œil" : l'ensemble des KPI complets (replié par défaut).
import React from 'react';
import {
  Building2, TrendingUp, Wallet, CreditCard, Banknote, Percent,
  AlertTriangle, ShieldCheck,
} from 'lucide-react';
import KpiCard from '@/components/dashboard/KpiCard';
import BreakdownDetails from '@/components/dashboard/BreakdownDetails';
import PropertyRow from '@/components/dashboard/PropertyRow';
import AlertsWidget from '@/components/alerts/AlertsWidget';
import { formatCurrency, formatPercent, calcTotalAcquisition, calcTotalMonthlyPayment } from '@/lib/formatters';
import { getMonthlyRentForLot } from '@/lib/lease';

function KpiGroup({ title, children }) {
  return (
    <section>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 px-1">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">{children}</div>
    </section>
  );
}

export default function PortfolioOverview({
  k, kpiDetails, open,
  filteredProperties, lots, leases = [], transactions, impayes,
  detail, detailsOpen, setDetailsOpen,
}) {
  // Le bail (Lease) est la source de vérité du loyer attendu du mois courant ;
  // repli legacy lot.rent_excluding_charges pour l'historique non migré.
  const now = new Date();
  const yN = now.getFullYear();
  const mN = now.getMonth() + 1;
  const getPropertyMonthlyIncome = (propertyId) =>
    lots
      .filter((l) => l.property_id === propertyId)
      .reduce((s, l) => s + (getMonthlyRentForLot(l.id, leases, yN, mN) ?? (l.rent_excluding_charges || 0)), 0);

  return (
    <div className="space-y-8 rounded-xl border border-border bg-card/50 p-5">
      <KpiGroup title="Patrimoine & Capital">
        <KpiCard label="Valeur estimée" value={formatCurrency(k.estimatedValue)} sub={`${filteredProperties.length} bien(s)`} icon={Building2} tone="primary" onClick={() => open('estimatedValue')} />
        <KpiCard label="Prix de revient" value={formatCurrency(k.acquisitionCost)} sub="Achat + frais + travaux" icon={Building2} onClick={() => open('acquisitionCost')} />
        <KpiCard label="Capital restant dû" value={formatCurrency(k.crd)} icon={CreditCard} onClick={() => open('crd')} />
        <KpiCard label="Patrimoine net" value={formatCurrency(k.equity)} sub="Equity" icon={TrendingUp} tone="positive" onClick={() => open('equity')} />
        <KpiCard label="LTV" value={formatPercent(k.ltv)} sub={k.ltv > 70 ? '⚠ Dirigeant vers 70 %' : 'Sous 70 %'} icon={Percent} tone={k.ltv > 70 ? 'warning' : 'default'} onClick={() => open('ltv')} />
      </KpiGroup>

      <KpiGroup title="Revenus & Cash-flow (12 mois)">
        <KpiCard label="Revenus locatifs" value={formatCurrency(k.rentalIncome12m)} sub="Exploitation" icon={Wallet} tone="positive" domain="loyers" onClick={() => open('rentalIncome')} />
        <KpiCard label="Charges" value={formatCurrency(k.charges)} icon={Building2} tone="negative" onClick={() => open('charges')} />
        <KpiCard label="Service de la dette" value={formatCurrency(k.debtService)} icon={CreditCard} domain="banque" onClick={() => open('debtService')} />
        <KpiCard label="Cash-flow" value={formatCurrency(k.cashflow, true)} sub="Net (12 mois)" icon={Banknote} tone={k.cashflow >= 0 ? 'positive' : 'negative'} domain="loyers" onClick={() => open('cashflow')} />
      </KpiGroup>

      <KpiGroup title="Rendements">
        <KpiCard label="Rendement brut" value={formatPercent(k.grossYield)} icon={Percent} onClick={() => open('grossYield')} />
        <KpiCard label="Rendement net" value={formatPercent(k.netYield)} icon={Percent} tone={k.netYield > 0 ? 'positive' : 'negative'} onClick={() => open('netYield')} />
        <KpiCard label="Cash-on-cash" value={k.cashOnCash ? formatPercent(k.cashOnCash) : '—'} sub="Sur apport" icon={Percent} tone={k.cashOnCash > 0 ? 'positive' : 'default'} onClick={() => open('cashOnCash')} />
      </KpiGroup>

      <KpiGroup title="Pilotage">
        <KpiCard label="Taux d'encaissement" value={formatPercent(k.encaissementRate)} sub="Loyers attendus" icon={ShieldCheck} tone={k.encaissementRate < 95 ? 'warning' : 'positive'} domain="loyers" onClick={() => open('encaissement')} />
        <KpiCard label="Total impayé" value={formatCurrency(k.totalImpaye)} sub="Impayés actifs" icon={AlertTriangle} tone={k.totalImpaye > 0 ? 'negative' : 'positive'} domain="alertes" onClick={() => open('impaye')} />
        <KpiCard label="Taux d'occupation" value={formatPercent(k.occupationRate)} icon={Building2} tone="primary" onClick={() => open('occupation')} />
      </KpiGroup>

      <BreakdownDetails isOpen={detailsOpen} onClose={() => setDetailsOpen(false)} title={detail?.title} data={detail} />

      <AlertsWidget />

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-base font-semibold">Récapitulatif par bien</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">Bien</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">Catégorie</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">Régime</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">Coût total</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">CRD</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">Loyer versé / attendu</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">Mensualité</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">Cashflow</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3 uppercase tracking-wider">Rdt brut</th>
              </tr>
            </thead>
            <tbody>
              {filteredProperties.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-muted-foreground">
                  <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Aucun bien pour ce filtre</p>
                </td></tr>
              ) : filteredProperties.map((property) => {
                const income = getPropertyMonthlyIncome(property.id);
                const payment = calcTotalMonthlyPayment(property);
                return (
                  <PropertyRow
                    key={property.id}
                    property={property}
                    lots={lots.filter((l) => l.property_id === property.id)}
                    leases={leases}
                    monthlyIncome={income}
                    monthlyCashflow={income - payment}
                    transactions={transactions.filter((t) => t.property_id === property.id)}
                    impayes={impayes.filter((i) => i.property_id === property.id)}
                  />
                );
              })}
            </tbody>
            {filteredProperties.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3 text-sm" colSpan={3}>Total</td>
                  <td className="px-4 py-3 text-right text-sm number-fr">{formatCurrency(filteredProperties.reduce((s, p) => s + calcTotalAcquisition(p), 0))}</td>
                  <td className="px-4 py-3 text-right text-sm number-fr">{formatCurrency(k.crd)}</td>
                  <td className="px-4 py-3 text-right text-sm number-fr text-emerald-600">{formatCurrency(filteredProperties.reduce((s, p) => s + getPropertyMonthlyIncome(p.id), 0))}</td>
                  <td className="px-4 py-3 text-right text-sm number-fr text-red-500">{formatCurrency(filteredProperties.reduce((s, p) => s + calcTotalMonthlyPayment(p), 0))}</td>
                  <td className="px-4 py-3 text-right text-sm number-fr">
                    <span className={k.cashflow >= 0 ? 'text-emerald-600' : 'text-red-500'}>{formatCurrency(k.cashflow, true)}</span>
                    <span className="block text-xs text-muted-foreground font-normal">12 mois</span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm number-fr">{formatPercent(k.grossYield)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}