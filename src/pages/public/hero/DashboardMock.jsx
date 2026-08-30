import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Wallet, CalendarClock } from 'lucide-react';

function useCountUp(target, duration = 1500) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

const BARS = [42, 58, 50, 66, 74, 60, 82, 78, 70, 88, 84, 96];

export default function DashboardMock() {
  const patrimoine = useCountUp(1840000);
  const rendement = useCountUp(7.4, 1600);
  const cashflow = useCountUp(2480);

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
      className="relative w-full max-w-[560px] mx-auto"
    >
      <div className="absolute -inset-4 bg-primary/5 rounded-3xl blur-2xl -z-10" aria-hidden="true" />
      <div className="rounded-2xl border border-sidebar-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-sidebar-border bg-secondary/40">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-accent" />
            <span className="w-2.5 h-2.5 rounded-full bg-success/60" />
          </div>
          <span className="text-xs text-muted-foreground">app.patrimo.fr</span>
        </div>

        {/* Body */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-display text-lg font-semibold">Cockpit investisseur</h3>
            <span className="text-[11px] px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">7 biens · 2026</span>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Vue d'ensemble du patrimoine locatif</p>

          {/* KPI */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Kpi label="Patrimoine total" value={`1,84 M€`} hint={`${(patrimoine).toLocaleString('fr-FR')} €`} />
            <Kpi label="Rendement net" value={`${(rendement / 10).toFixed(1)}%`} accent icon={<TrendingUp className="w-3.5 h-3.5" />} />
            <Kpi label="Cash-flow / mois" value={`${cashflow} €`} hint="+12% vs N-1" />
          </div>

          {/* Chart */}
          <div className="rounded-xl border border-sidebar-border bg-secondary/30 p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium">Cash-flow mensuel</span>
              <span className="text-[11px] text-muted-foreground">12 mois</span>
            </div>
            <div className="flex items-end justify-between gap-1.5 h-24">
              {BARS.map((h, i) => (
                <motion.span
                  key={i}
                  initial={{ height: 0 }}
                  animate={{ height: `${h}%` }}
                  transition={{ duration: 0.5, delay: 0.4 + i * 0.06, ease: 'easeOut' }}
                  className="flex-1 rounded-t bg-gradient-to-t from-primary/40 to-primary"
                />
              ))}
            </div>
          </div>

          {/* Today */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarClock className="w-4 h-4 text-accent" />
            <span>À faire aujourd'hui · 3 priorités</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {[
              { t: 'Quittance à émettre — Mme Barlaud', c: 'bg-primary' },
              { t: 'Loyer en retard — App. Caluire', c: 'bg-destructive' },
            ].map((r, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1 + i * 0.15 }}
                className="flex items-center gap-2 text-xs"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${r.c}`} />
                <span className="truncate">{r.t}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Floating badge */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.2 }}
        className="absolute -right-3 top-1/3 flex items-center gap-1.5 rounded-full bg-card border border-sidebar-border shadow-lg px-3 py-1.5"
      >
        <Wallet className="w-3.5 h-3.5 text-success" />
        <span className="text-[11px] font-semibold text-success">Encaissé · 10 888 €</span>
      </motion.div>
    </motion.div>
  );
}

function Kpi({ label, value, hint, accent, icon }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-primary/30 bg-primary/5' : 'border-sidebar-border bg-background'}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className={`font-display font-semibold text-base ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}