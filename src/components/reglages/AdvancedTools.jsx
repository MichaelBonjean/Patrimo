import React, { lazy, Suspense } from 'react';
import { Calculator, PencilRuler, BarChart2, FileSpreadsheet } from 'lucide-react';
import { useFeatureFlags } from '@/lib/featureFlags';
import LockedPanel from '@/components/FeatureLock';

const InvestmentSimulator = lazy(() => import('@/pages/InvestmentSimulator'));
const Taxes = lazy(() => import('@/pages/Taxes'));
const Analyse = lazy(() => import('@/pages/Analyse'));
const Onboarding = lazy(() => import('@/pages/Onboarding'));

const Fallback = () => (
  <div className="flex items-center justify-center h-40">
    <div className="w-7 h-7 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

const TOOLS = [
  { Comp: InvestmentSimulator, title: "Simulateur d'investissement", desc: 'Évaluez la rentabilité d’un projet avant l’achat.', icon: PencilRuler },
  { Comp: Taxes, title: 'Simulation fiscale', desc: 'Estimez votre fiscalité immobilière (revenus fonciers, LMNP, Pinel…).', icon: Calculator },
  { Comp: Analyse, title: 'Analyse patrimoine', desc: 'Visualisez rendements, cash-flow et répartition de votre patrimoine.', icon: BarChart2, feature: 'analyse' },
  { Comp: Onboarding, title: 'Import initial depuis Excel', desc: 'Importez en masse vos biens, lots et bails depuis un tableau.', icon: FileSpreadsheet },
];

export default function AdvancedTools() {
  const { isUnlocked, flags } = useFeatureFlags();
  return (
    <div className="space-y-6">
      {TOOLS.map((t, i) => {
        const locked = t.feature ? !isUnlocked(t.feature) : false;
        return (
        <div key={i} className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${locked ? 'bg-muted' : 'bg-primary/10'}`}>
              <t.icon className={`w-4 h-4 ${locked ? 'text-muted-foreground' : 'text-primary'}`} />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm">{t.title}</h3>
              <p className="text-xs text-muted-foreground">{t.desc}</p>
            </div>
          </div>
          {locked
            ? <LockedPanel title={t.title} desc={t.desc} unlockText={flags[t.feature]?.unlockText} icon={t.icon} />
            : <Suspense fallback={<Fallback />}><t.Comp /></Suspense>}
        </div>
        );
      })}
    </div>
  );
}