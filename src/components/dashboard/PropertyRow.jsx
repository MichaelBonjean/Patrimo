import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatPercent, calcTotalAcquisition, calcTotalMonthlyPayment } from '@/lib/formatters';
import { calcCurrentCRD } from '@/lib/propertyFinance';
import { ExternalLink, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { getDaysOutstanding } from '@/lib/impayeUtils';
import { getMonthlyRentForLot, getCurrentTenants } from '@/lib/lease';

const REGIME_COLORS = {
  'Résidence principale': 'bg-slate-100 text-slate-700',
  'LMNP au réel': 'bg-blue-100 text-blue-700',
  'LMNP au micro-BIC': 'bg-sky-100 text-sky-700',
  'SCI à l\'IS': 'bg-violet-100 text-violet-700',
  'SCI à l\'IR': 'bg-purple-100 text-purple-700',
  'Location nue (revenus fonciers)': 'bg-amber-100 text-amber-700',
  'Location nue (micro-foncier)': 'bg-yellow-100 text-yellow-700',
  'LMP': 'bg-emerald-100 text-emerald-700',
  'Pinel': 'bg-teal-100 text-teal-700',
  'Denormandie': 'bg-cyan-100 text-cyan-700',
};

export default function PropertyRow({ property, lots, leases = [], monthlyIncome, monthlyCashflow, transactions = [], impayes = [] }) {
  const [expanded, setExpanded] = useState(false);
  const totalAcq = calcTotalAcquisition(property);
  const totalPayment = calcTotalMonthlyPayment(property);
  const annualRent = (monthlyIncome || 0) * 12;
  const grossYield = totalAcq > 0 ? (annualRent / totalAcq * 100) : 0;
  const crd = calcCurrentCRD(property);

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  // Sum of rent transactions received this month for this property
  const rentPaidThisMonth = transactions
    .filter(t => t.property_id === property.id && t.year === currentYear && t.month === currentMonth && t.category === 'Loyer' && t.type === 'income')
    .reduce((s, t) => s + (t.amount || 0), 0);

  // Loyer attendu ce mois = somme des loyers HC des baux couvrant le mois courant
  // (repli legacy lot.rent_excluding_charges pour les lots non migrés vers un bail).
  const monthMidISO = `${currentYear}-${String(currentMonth).padStart(2, '0')}-15`;
  const expectedRent = lots.filter(l => !l.is_vacant).reduce((s, l) =>
    s + (getMonthlyRentForLot(l.id, leases, currentYear, currentMonth) ?? (l.rent_excluding_charges || 0)), 0);

  // Lots actifs = lot couvert par un bail actif (locataire Lease) ou repli legacy.
  const activeLots = lots.filter(l => getCurrentTenants(l.id, leases, monthMidISO).length > 0 || (!l.is_vacant && (l.tenant_name || getMonthlyRentForLot(l.id, leases, currentYear, currentMonth) !== null)));

  // Signal rouge si un impayé > 30 jours sur ce bien
  const criticalImpayes = impayes.filter(i => i.status !== 'régularisé' && i.status !== 'abandonné' && getDaysOutstanding(i.period) > 30);
  const maxDays = criticalImpayes.length > 0 ? Math.max(...criticalImpayes.map(i => getDaysOutstanding(i.period))) : 0;

  return (
    <>
      <tr
        className="border-b border-border hover:bg-muted/40 transition-colors group cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground shrink-0">
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
            <div>
              <Link
                to={`/biens/${property.id}`}
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1.5 group-hover:text-primary transition-colors"
              >
                <span className="font-semibold text-sm">{property.name}</span>
                {maxDays > 30 && (
                  <span
                    className="inline-flex items-center gap-0.5 text-xs font-medium text-red-700 bg-red-100 px-1.5 py-0.5 rounded-md"
                    title={`${criticalImpayes.length} impayé(s) en cours de plus de 30 jours`}
                  >
                    <AlertCircle className="w-3 h-3" />
                    Impayé J+{maxDays}
                  </span>
                )}
                <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
              <p className="text-xs text-muted-foreground mt-0.5">{property.city}</p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs font-medium">{property.category}</span>
        </td>
        <td className="px-4 py-3">
          <Badge variant="secondary" className={`text-xs font-medium ${REGIME_COLORS[property.tax_regime] || 'bg-muted text-muted-foreground'}`}>
            {property.tax_regime}
          </Badge>
        </td>
        <td className="px-4 py-3 text-right number-fr text-sm">{formatCurrency(totalAcq)}</td>
        <td className="px-4 py-3 text-right number-fr text-sm">{formatCurrency(crd)}</td>
        {/* Loyer versé ce mois / attendu */}
        <td className="px-4 py-3 text-right number-fr text-sm">
          {expectedRent > 0 ? (
            <div className="flex flex-col items-end gap-0.5">
              <span className={`font-semibold ${rentPaidThisMonth < expectedRent ? 'text-red-500' : 'text-emerald-600'}`}>
                {formatCurrency(rentPaidThisMonth)}
              </span>
              <span className="text-xs text-muted-foreground">{formatCurrency(expectedRent)} attendu</span>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-right number-fr text-sm text-red-500">{formatCurrency(totalPayment)}</td>
        <td className="px-4 py-3 text-right number-fr text-sm">
          <span className={`font-semibold ${monthlyCashflow >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {formatCurrency(monthlyCashflow, true)}
          </span>
        </td>
        <td className="px-4 py-3 text-right number-fr text-sm">{formatPercent(grossYield)}</td>
      </tr>

      {/* Expanded lot detail */}
      {expanded && activeLots.length > 0 && (
        <tr className="border-b border-border/50">
          <td colSpan={9} className="p-0">
            <div className="bg-muted/20 px-8 py-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/50">
                    <th className="text-left py-1.5 pr-4 font-medium">Lot / Locataire</th>
                    <th className="text-right py-1.5 pr-4 font-medium">Loyer attendu</th>
                    <th className="text-right py-1.5 pr-4 font-medium">Loyer versé ce mois</th>
                    <th className="text-right py-1.5 font-medium">Écart</th>
                  </tr>
                </thead>
                <tbody>
                  {activeLots.map(lot => {
                    const lotPaid = transactions
                      .filter(t => t.lot_id === lot.id && t.year === currentYear && t.month === currentMonth && t.category === 'Loyer' && t.type === 'income')
                      .reduce((s, t) => s + (t.amount || 0), 0);
                    // Loyer attendu du lot = bail couvrant le mois courant (repli legacy).
                    const lotExpected = lot.is_vacant ? 0 : (getMonthlyRentForLot(lot.id, leases, currentYear, currentMonth) ?? (lot.rent_excluding_charges || 0));
                    const lotTenants = getCurrentTenants(lot.id, leases, monthMidISO);
                    const lotTenantLabel = lotTenants.map(t => t.name).join(', ') || lot.tenant_name || '';
                    const diff = lotPaid - lotExpected;
                    const isShort = lotExpected > 0 && lotPaid < lotExpected;
                    return (
                      <tr key={lot.id} className="border-b border-border/30 last:border-0">
                        <td className="py-1.5 pr-4">
                          <span className="font-medium">{lot.designation}</span>
                          {lotTenantLabel && <span className="text-muted-foreground ml-2">— {lotTenantLabel}</span>}
                          {lot.is_vacant && <span className="ml-2 text-amber-600 font-medium">vacant</span>}
                        </td>
                        <td className="py-1.5 pr-4 text-right number-fr">
                          {lotExpected > 0 ? formatCurrency(lotExpected) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className={`py-1.5 pr-4 text-right number-fr font-semibold ${isShort ? 'text-red-500' : lotPaid > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                          {lotPaid > 0 ? formatCurrency(lotPaid) : '—'}
                        </td>
                        <td className={`py-1.5 text-right number-fr ${diff < 0 ? 'text-red-500' : diff > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                          {lotExpected > 0 ? formatCurrency(diff, true) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}