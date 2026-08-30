import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatPercent, calcTotalAcquisition } from '@/lib/formatters';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { useOwnerFilter } from '@/lib/tenantFilter';
import RentCalendar from '@/components/analyse/RentCalendar';
import AutomationRateCard from '@/components/analyse/AutomationRateCard';
// Moteur financier unique — source de vérité de tout cash-flow (anti-double-comptage du crédit).
import { computePortfolioCashflow, computePropertyCashflow } from '@/lib/financeEngine';
// Moteur de rentabilité canonique — source unique (le crédit ne pollue jamais le rendement net).
import { computePropertyPerformance } from '@/lib/performanceEngine';

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const COLORS = [
  'hsl(221,83%,53%)', 'hsl(142,71%,45%)', 'hsl(38,92%,50%)',
  'hsl(0,84%,60%)', 'hsl(262,83%,58%)', 'hsl(170,60%,40%)',
  'hsl(300,60%,50%)', 'hsl(30,80%,50%)',
];

const currentYear = new Date().getFullYear();

// Calcule le nombre de mois occupés dans une année pour un lot
function calcOccupiedMonths(lot, year) {
  const allTenants = [
    ...(lot.tenants || []),
    ...(lot.previous_tenants || []),
  ];
  // Also include legacy single-tenant fields
  if (lot.tenant_entry_date) {
    allTenants.push({ entry_date: lot.tenant_entry_date, exit_date: lot.tenant_exit_date });
  }

  let occupiedMonths = new Set();

  for (const tenant of allTenants) {
    if (!tenant.entry_date) continue;
    const entry = new Date(tenant.entry_date);
    const exit = tenant.exit_date ? new Date(tenant.exit_date) : new Date(year, 11, 31);

    for (let m = 0; m < 12; m++) {
      const monthStart = new Date(year, m, 1);
      const monthEnd = new Date(year, m + 1, 0);
      if (entry <= monthEnd && exit >= monthStart) {
        occupiedMonths.add(m);
      }
    }
  }

  return occupiedMonths.size;
}

const CustomYieldTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-md text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>{p.name} : {formatPercent(p.value)}</p>
      ))}
    </div>
  );
};

const CustomCashflowTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-md text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>{p.name} : {formatCurrency(p.value, true)}</p>
      ))}
    </div>
  );
};

const CustomPieTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-md text-xs">
      <p className="font-semibold">{d.name}</p>
      <p>{formatCurrency(d.value)} ({formatPercent(d.payload.pct)})</p>
    </div>
  );
};

export default function Analyse() {
  const [year, setYear] = useState(currentYear);
  const { withOwner } = useOwnerFilter();

  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => base44.entities.Property.filter(withOwner()),
  });
  const { data: lots = [] } = useQuery({
    queryKey: ['lots'],
    queryFn: () => base44.entities.Lot.filter(withOwner()),
  });
  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['transactions-all'],
    queryFn: () => base44.entities.Transaction.filter(withOwner()),
  });
  const { data: leases = [] } = useQuery({
    queryKey: ['leases'],
    queryFn: () => base44.entities.Lease.filter(withOwner()),
  });

  const txYear = useMemo(() => transactions.filter(t => t.year === year), [transactions, year]);
  const txYearPrev = useMemo(() => transactions.filter(t => t.year === year - 1), [transactions, year]);

  // ── 1. Rendement par bien (moteur canonique) ───────────────────────────────
  const yieldData = useMemo(() => {
    return properties
      .filter(p => p.tax_regime !== 'Résidence principale')
      .map(p => {
        // Rentabilité canonique (performanceEngine) — NOI / coût, crédit exclu du rendement net.
        const perf = computePropertyPerformance({ property: p, transactions: txYear, year, leases, lots });
        return { name: p.name.length > 22 ? p.name.slice(0, 20) + '…' : p.name, fullName: p.name, grossYield: perf.grossYield, netYield: perf.netYield };
      })
      .sort((a, b) => b.grossYield - a.grossYield);
  }, [properties, txYear, year, leases, lots]);

  // ── 2. Cashflow mensuel N et N-1 (moteur canonique — anti-double-comptage) ─
  const cfYear = useMemo(() => computePortfolioCashflow(properties, transactions, year), [properties, transactions, year]);
  const cfPrev = useMemo(() => computePortfolioCashflow(properties, transactions, year - 1), [properties, transactions, year]);

  const monthlyData = useMemo(() => {
    return MONTHS.map((label, idx) => ({
      label,
      [year]: cfYear.monthly[idx]?.net_cashflow ?? 0,
      [year - 1]: cfPrev.monthly[idx]?.net_cashflow ?? 0,
    }));
  }, [cfYear, cfPrev, year]);

  const avgN = useMemo(() => monthlyData.reduce((s, d) => s + (d[year] || 0), 0) / 12, [monthlyData, year]);
  const avgNm1 = useMemo(() => monthlyData.reduce((s, d) => s + (d[year - 1] || 0), 0) / 12, [monthlyData, year]);

  // ── 3. Répartition du patrimoine ──────────────────────────────────────────
  const totalBrut = useMemo(() => properties.reduce((s, p) => s + calcTotalAcquisition(p), 0), [properties]);

  const patrimoineData = useMemo(() => {
    return properties
      .map(p => {
        const val = calcTotalAcquisition(p);
        const pct = totalBrut > 0 ? (val / totalBrut) * 100 : 0;
        return { name: p.name, value: val, pct };
      })
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [properties, totalBrut]);

  // ── 4. Taux d'occupation ──────────────────────────────────────────────────
  const occupancyData = useMemo(() => {
    return lots.map(lot => {
      const prop = properties.find(p => p.id === lot.property_id);
      const occupied = calcOccupiedMonths(lot, year);
      const vacant = 12 - occupied;
      const rate = (occupied / 12) * 100;
      return {
        lot,
        propName: prop?.name || '—',
        designation: lot.designation,
        occupied,
        vacant,
        rate,
      };
    }).sort((a, b) => b.rate - a.rate);
  }, [lots, properties, year]);

  const yieldBarHeight = Math.max(180, yieldData.length * 48);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analyse</h1>
          <p className="text-sm text-muted-foreground mt-1">Vision graphique macro du portfolio</p>
        </div>
        <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map(y => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-32">
          <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Taux d'automatisation — bénéfice invisible rendu visible */}
          <AutomationRateCard />

          {/* 1. Rendement par bien */}
          <div className="bg-card border border-border rounded-xl p-5">
            <h2 className="text-sm font-semibold mb-1">Rendement par bien — {year}</h2>
            <p className="text-xs text-muted-foreground mb-4">Calculé depuis les transactions de l'année / coût total d'acquisition</p>
            {yieldData.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-12">Aucun bien avec données d'acquisition</p>
            ) : (
              <ResponsiveContainer width="100%" height={yieldBarHeight}>
                <BarChart data={yieldData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => `${v.toFixed(1)} %`} domain={[0, 'auto']} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                  <Tooltip content={<CustomYieldTooltip />} />
                  <Legend formatter={v => v === 'grossYield' ? 'Rendement brut' : 'Rendement net'} />
                  <Bar dataKey="grossYield" name="Rendement brut" fill="hsl(221,83%,53%)" radius={[0, 4, 4, 0]} barSize={14} />
                  <Bar dataKey="netYield" name="Rendement net" fill="hsl(142,71%,45%)" radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* 2. Cashflow mensuel N vs N-1 */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold">Cashflow mensuel — {year} vs {year - 1}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Revenus − Charges − Mensualités crédit</p>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>Moy. {year} : <span className={avgN >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'}>{formatCurrency(avgN, true)}/m</span></p>
                <p>Moy. {year - 1} : <span className="text-muted-foreground font-medium">{formatCurrency(avgNm1, true)}/m</span></p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={monthlyData} margin={{ left: 10, right: 10, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k€`} />
                <Tooltip content={<CustomCashflowTooltip />} />
                <Legend />
                <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1.5} />
                <ReferenceLine y={avgN} stroke="hsl(221,83%,53%)" strokeDasharray="6 3" strokeOpacity={0.5} />
                <Line type="monotone" dataKey={year} name={String(year)} stroke="hsl(221,83%,53%)" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey={year - 1} name={String(year - 1)} stroke="hsl(215,16%,60%)" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Calendrier des loyers par locataire */}
          <RentCalendar properties={properties} lots={lots} transactions={transactions} year={year} />

          {/* 3. Répartition du patrimoine + 4. Taux d'occupation */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* 3. PieChart patrimoine */}
            <div className="bg-card border border-border rounded-xl p-5">
              <h2 className="text-sm font-semibold mb-4">Répartition du patrimoine brut</h2>
              {patrimoineData.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-12">Aucun bien avec coût d'acquisition</p>
              ) : (
                <div className="flex gap-4 items-center">
                  <ResponsiveContainer width="45%" height={200}>
                    <PieChart>
                      <Pie
                        data={patrimoineData}
                        dataKey="value"
                        cx="50%" cy="50%"
                        outerRadius={85}
                        paddingAngle={2}
                      >
                        {patrimoineData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomPieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2 overflow-y-auto max-h-52">
                    {patrimoineData.map((d, i) => (
                      <div key={d.name} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="text-xs truncate">{d.name}</span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-semibold number-fr">{formatCurrency(d.value)}</span>
                          <span className="text-[10px] text-muted-foreground ml-1">({formatPercent(d.pct, 1)})</span>
                        </div>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-border flex justify-between text-xs font-semibold">
                      <span>Total</span>
                      <span className="number-fr">{formatCurrency(totalBrut)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 4. Taux d'occupation */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold">Taux d'occupation — {year}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Calculé depuis les dates d'entrée/sortie des locataires</p>
              </div>
              {occupancyData.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-12">Aucun lot enregistré</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Bien</th>
                        <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">Lot</th>
                        <th className="text-center px-3 py-2.5 font-medium text-emerald-700">Occupés</th>
                        <th className="text-center px-3 py-2.5 font-medium text-red-500">Vacants</th>
                        <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Taux</th>
                        <th className="px-4 py-2.5 w-32"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {occupancyData.map(({ lot, propName, designation, occupied, vacant, rate }) => (
                        <tr key={lot.id} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[100px]">{propName}</td>
                          <td className="px-3 py-2.5 font-medium truncate max-w-[110px]">{designation}</td>
                          <td className="px-3 py-2.5 text-center text-emerald-700 font-semibold">{occupied} m</td>
                          <td className="px-3 py-2.5 text-center text-red-500">{vacant} m</td>
                          <td className={`px-4 py-2.5 text-right font-bold ${rate >= 90 ? 'text-emerald-600' : rate >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
                            {formatPercent(rate, 0)}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full ${rate >= 90 ? 'bg-emerald-500' : rate >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                                style={{ width: `${rate}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}