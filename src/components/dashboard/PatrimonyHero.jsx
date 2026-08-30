import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Building2, TrendingUp, CreditCard, Wallet, Banknote } from 'lucide-react';
import { formatCurrency, calcTotalAcquisition } from '@/lib/formatters';
import { getMonthlyRentForLot } from '@/lib/lease';
import AutomationRateCard from '@/components/dashboard/AutomationRateCard';
import BackgroundJobsChip from '@/components/dashboard/BackgroundJobsChip';

function useCountUp(target, duration = 800) {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const start = fromRef.current;
    const t0 = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(start + (target - start) * e));
      if (p < 1) raf = requestAnimationFrame(tick); else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function SmallKpi({ label, value, sub, icon: Icon, tone }) {
  const toneClass = tone === 'positive' ? 'text-emerald-600' : tone === 'negative' ? 'text-rose-600' : 'text-foreground';
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className={`text-xl font-semibold number-fr ${toneClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function PatrimonyHero({
  k, filteredProperties = [], lots = [], leases = [],
}) {
  const now = new Date();
  const yN = now.getFullYear();
  const mN = now.getMonth() + 1;
  const monthlyRentHC = filteredProperties.reduce((s, p) => {
    const propLots = lots.filter((l) => l.property_id === p.id);
    return s + propLots.reduce((ss, l) => ss + (getMonthlyRentForLot(l.id, leases, yN, mN) ?? (l.rent_excluding_charges || 0)), 0);
  }, 0);
  const monthlyCashflow = k.cashflow ? k.cashflow / 12 : 0;

  const animatedEquity = useCountUp(Math.round(k.equity || 0), 800);

  const { data: autoRes } = useQuery({
    queryKey: ['automation-rate', 'current'],
    queryFn: () => base44.functions.invoke('computeAutomationRate', {}),
    staleTime: 60_000,
  });
  const auto = autoRes?.data || autoRes || {};
  const rate = auto.rate;
  const totals = auto.totals || {};
  const history = auto.history || [];
  const lastRate = history.length >= 2 ? history[history.length - 2].rate : null;

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Puce jobs desktop (top-right) — chips détenteurs désormais dans CockpitFilters */}
      <div className="hidden sm:flex items-center justify-end px-4 sm:px-6 pt-4 sm:pt-5">
        <div className="relative shrink-0">
          <BackgroundJobsChip />
        </div>
      </div>

      {/* Montant patrimoine net XXL */}
      <div className="px-4 sm:px-6 pt-4 pb-2">
        <p className="text-xs text-muted-foreground">Patrimoine net</p>
        <div className="flex items-end gap-2 flex-wrap mt-1">
          <h1 className="text-4xl sm:text-5xl font-display font-semibold tracking-tight number-fr">
            {formatCurrency(animatedEquity)}
          </h1>
          <span className="text-xs text-muted-foreground mb-1.5">équity consolidée</span>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span>Valorisation <strong className="text-foreground number-fr">{formatCurrency(k.estimatedValue)}</strong></span>
          <span className="text-muted-foreground/60">−</span>
          <span>CRD <strong className="text-foreground number-fr">{formatCurrency(k.crd)}</strong></span>
          {k.treasury != null && Number.isFinite(k.treasury) && (
            <>
              <span className="text-muted-foreground/60">+</span>
              <span>Trésorerie <strong className="text-foreground number-fr">{formatCurrency(k.treasury)}</strong></span>
            </>
          )}
        </div>
      </div>

      {/* Bannière jobs mobile pleine largeur */}
      <div className="sm:hidden px-4 pb-2">
        <div className="relative"><BackgroundJobsChip /></div>
      </div>

      {/* 3 KPI secondaires */}
      <div className="px-4 sm:px-6 pb-5 pt-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SmallKpi label="Loyers HC / mois" value={formatCurrency(monthlyRentHC)} sub={`${filteredProperties.length} bien(s)`} icon={Wallet} tone="positive" />
          <SmallKpi label="Cashflow mensuel" value={formatCurrency(monthlyCashflow, true)} sub="Net (12 mois ÷ 12)" icon={Banknote} tone={monthlyCashflow >= 0 ? 'positive' : 'negative'} />
          <div className="col-span-2 sm:col-span-1">
            <AutomationRateCard rate={rate} totals={totals} lastRate={lastRate} autoCount={totals.auto} />
          </div>
        </div>
      </div>
    </section>
  );
}