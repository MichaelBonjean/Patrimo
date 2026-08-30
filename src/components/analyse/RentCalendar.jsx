import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatCurrency } from '@/lib/formatters';
import { Check, Minus, Clock } from 'lucide-react';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { getMonthlyRentForLot, getMonthlyChargesForLot, getCurrentTenants } from '@/lib/lease';

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

// Mois occupés pour un lot sur une année (Set d'indices 0-11)
function getOccupiedMonths(lot, year) {
  const allTenants = [
    ...(lot.tenants || []),
    ...(lot.previous_tenants || []),
  ];
  if (lot.tenant_entry_date) {
    allTenants.push({ entry_date: lot.tenant_entry_date, exit_date: lot.tenant_exit_date });
  }

  const occupied = new Set();
  for (const tenant of allTenants) {
    if (!tenant.entry_date) continue;
    const entry = new Date(tenant.entry_date);
    const exit = tenant.exit_date ? new Date(tenant.exit_date) : new Date(year, 11, 31);
    for (let m = 0; m < 12; m++) {
      const monthStart = new Date(year, m, 1);
      const monthEnd = new Date(year, m + 1, 0);
      if (entry <= monthEnd && exit >= monthStart) occupied.add(m);
    }
  }
  return occupied;
}

// Locataire actif pour un lot sur un mois donné
function getActiveTenant(lot, year, monthIdx) {
  const allTenants = [...(lot.tenants || []), ...(lot.previous_tenants || [])];
  const monthStart = new Date(year, monthIdx, 1);
  const monthEnd = new Date(year, monthIdx + 1, 0);
  for (const t of allTenants) {
    if (!t.entry_date) continue;
    const entry = new Date(t.entry_date);
    const exit = t.exit_date ? new Date(t.exit_date) : new Date(year, 11, 31);
    if (entry <= monthEnd && exit >= monthStart) return t;
  }
  return null;
}

export default function RentCalendar({ properties, lots, transactions, year }) {
  const { withOwner } = useOwnerFilter();
  const { data: leases = [] } = useQuery({
    queryKey: ['leases'],
    queryFn: () => base44.entities.Lease.filter(withOwner()),
  });

  const rows = useMemo(() => {
    // Index des transactions Loyer reçues par (lotId|propertyId, month)
    const loyerTx = transactions.filter(t => t.category === 'Loyer' && t.type === 'income' && t.year === year);
    const txByLot = new Map();
    const txByProp = new Map();
    for (const t of loyerTx) {
      const key = `${t.lot_id || ''}|${t.month}`;
      if (t.lot_id) txByLot.set(key, (txByLot.get(key) || 0) + Math.abs(t.amount));
      const pkey = `${t.property_id}|${t.month}`;
      txByProp.set(pkey, (txByProp.get(pkey) || 0) + Math.abs(t.amount));
    }

    return lots
      .map(lot => {
        const prop = properties.find(p => p.id === lot.property_id);
        // Occupation legacy (repli pour l'historique non couvert par un bail).
        const legacyOccupied = getOccupiedMonths(lot, year);
        const months = [];
        for (let m = 0; m < 12; m++) {
          // Loyer & charges attendus pour le mois = bail couvrant la période (repli legacy).
          const leaseRent = getMonthlyRentForLot(lot.id, leases, year, m + 1);
          const leaseCharges = getMonthlyChargesForLot(lot.id, leases, year, m + 1);
          const rentHC = leaseRent ?? (lot.rent_excluding_charges || 0);
          const charges = leaseCharges ?? (lot.charges || 0);
          const rentDue = rentHC + charges;
          // Période couverte par un bail → occupée ; sinon repli legacy.
          const monthMidISO = `${year}-${String(m + 1).padStart(2, '0')}-15`;
          const leaseTenant = leaseRent !== null ? getCurrentTenants(lot.id, leases, monthMidISO).map(t => t.name) : null;
          const occupied = leaseRent !== null
            ? true
            : legacyOccupied.has(m);
          if (!occupied || rentDue <= 0) {
            months.push({ state: 'vacant' });
          } else {
            const tenantNames = (leaseTenant && leaseTenant.length > 0)
              ? leaseTenant.join(', ')
              : (getActiveTenant(lot, year, m)?.name || lot.tenant_name || '—');
            const lotKey = `${lot.id}|${m + 1}`;
            const propKey = `${lot.property_id}|${m + 1}`;
            const received = txByLot.has(lotKey) || txByProp.has(propKey);
            const receivedAmount = txByLot.get(lotKey) || txByProp.get(propKey) || 0;
            months.push({
              state: received ? 'received' : 'pending',
              amount: rentDue,
              receivedAmount,
              tenantName: tenantNames,
            });
          }
        }
        return {
          lot,
          propName: prop?.name || '—',
          designation: lot.designation || lot.code || '—',
          months,
        };
      })
      .sort((a, b) => a.propName.localeCompare(b.propName) || a.designation.localeCompare(b.designation));
  }, [lots, properties, transactions, year, leases]);

  const totals = useMemo(() => {
    const expected = new Array(12).fill(0);
    const received = new Array(12).fill(0);
    for (const r of rows) {
      r.months.forEach((m, idx) => {
        if (m.state === 'vacant') return;
        const amount = m.amount || 0;
        if (amount) expected[idx] += amount;
        if (m.state === 'received') received[idx] += (m.receivedAmount || amount);
      });
    }
    return { expected, received };
  }, [rows]);

  const totalExpected = totals.expected.reduce((s, v) => s + v, 0);
  const totalReceived = totals.received.reduce((s, v) => s + v, 0);
  const collectionRate = totalExpected > 0 ? (totalReceived / totalExpected) * 100 : 0;

  if (rows.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold mb-1">Calendrier des loyers — {year}</h2>
        <p className="text-xs text-muted-foreground text-center py-12">Aucun lot enregistré</p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-semibold">Calendrier des loyers — {year}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Suivi des encaissements par locataire et par mois</p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500/50 inline-flex items-center justify-center">
              <Check className="w-2 h-2 text-emerald-600" />
            </span>
            <span className="text-muted-foreground">Encaissé</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-400/20 border border-amber-400/60 inline-flex items-center justify-center">
              <Clock className="w-2 h-2 text-amber-600" />
            </span>
            <span className="text-muted-foreground">En attente</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-muted border border-border inline-flex items-center justify-center">
              <Minus className="w-2 h-2 text-muted-foreground" />
            </span>
            <span className="text-muted-foreground">Vacant</span>
          </div>
        </div>
      </div>

      <div className="flex gap-4 mb-4 flex-wrap">
        <div className="bg-muted/40 rounded-lg px-3 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Attendu</p>
          <p className="text-sm font-semibold number-fr">{formatCurrency(totalExpected)}</p>
        </div>
        <div className="bg-emerald-500/10 rounded-lg px-3 py-2">
          <p className="text-[10px] text-emerald-700 uppercase tracking-wide">Encaissé</p>
          <p className="text-sm font-semibold number-fr text-emerald-700">{formatCurrency(totalReceived)}</p>
        </div>
        <div className="bg-muted/40 rounded-lg px-3 py-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Taux d'encaissement</p>
          <p className={`text-sm font-semibold ${collectionRate >= 95 ? 'text-emerald-600' : collectionRate >= 80 ? 'text-amber-600' : 'text-red-500'}`}>
            {collectionRate.toFixed(0)} %
          </p>
        </div>
      </div>

      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="text-left px-2 py-2 font-medium text-muted-foreground sticky left-0 bg-card z-10 min-w-[140px]">Locataire</th>
              {MONTHS.map(m => (
                <th key={m} className="text-center px-1 py-2 font-medium text-muted-foreground min-w-[54px]">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ lot, propName, designation, months }) => (
              <React.Fragment key={lot.id}>
                <tr>
                  <td colSpan={13} className="px-2 pt-2 pb-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide sticky left-0 bg-card z-10">
                    {propName} · {designation}
                  </td>
                </tr>
                <tr>
                  <td className="px-2 py-1.5 sticky left-0 bg-card z-10">
                    <span className="text-xs text-muted-foreground truncate block max-w-[130px]">
                      {months.find(m => m.tenantName)?.tenantName || '—'}
                    </span>
                  </td>
                  {months.map((m, idx) => (
                    <td key={idx} className="px-1 py-1.5 text-center">
                      {m.state === 'vacant' ? (
                        <div className="h-8 rounded bg-muted/40 border border-border/60 flex items-center justify-center">
                          <Minus className="w-3 h-3 text-muted-foreground/60" />
                        </div>
                      ) : (
                        <div
                          className={`h-8 rounded border flex items-center justify-center text-[10px] font-semibold number-fr ${
                            m.state === 'received'
                              ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-700'
                              : 'bg-amber-400/15 border-amber-400/60 text-amber-700'
                          }`}
                          title={`${propName} · ${designation} — ${MONTHS[idx]} ${year}\nLocataire: ${m.tenantName}\nLoyer: ${formatCurrency(m.amount)}\n${m.state === 'received' ? 'Encaissé' : 'En attente'}`}
                        >
                          {(m.amount / 1000).toFixed(m.amount >= 1000 ? 0 : 1)}k
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              </React.Fragment>
            ))}
            {/* Totaux mensuels */}
            <tr>
              <td className="px-2 pt-3 pb-1.5 sticky left-0 bg-card z-10 text-[10px] font-semibold text-muted-foreground uppercase">Attendu</td>
              {totals.expected.map((v, idx) => (
                <td key={idx} className="px-1 pt-3 pb-0.5 text-center text-[10px] font-semibold number-fr text-muted-foreground">
                  {v > 0 ? `${(v / 1000).toFixed(0)}k` : ''}
                </td>
              ))}
            </tr>
            <tr>
              <td className="px-2 pb-2 sticky left-0 bg-card z-10 text-[10px] font-semibold text-emerald-700 uppercase">Encaissé</td>
              {totals.received.map((v, idx) => (
                <td key={idx} className="px-1 pb-2 text-center text-[10px] font-semibold number-fr text-emerald-700">
                  {v > 0 ? `${(v / 1000).toFixed(0)}k` : ''}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}