import React, { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Wallet, AlertTriangle, Receipt, TrendingUp, FolderClock, Euro } from 'lucide-react';
import { cn } from '@/lib/utils';
import { colorForDomain } from '@/lib/iconColors';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { formatCurrency } from '@/lib/formatters';
import MonthCollections from '@/components/loyers/MonthCollections';

const Impayes = lazy(() => import('@/pages/Impayes'));
const Quittances = lazy(() => import('@/pages/Quittances'));
const RentIndexation = lazy(() => import('@/pages/RentIndexation'));
const ChargeRegularization = lazy(() => import('@/pages/ChargeRegularization'));

const TABS = [
  { key: 'compte-locataire', label: 'Compte locataire', icon: Wallet },
  { key: 'impayes', label: 'Impayés', icon: AlertTriangle },
  { key: 'quittances', label: 'Quittances', icon: Receipt },
  { key: 'loyers-revision', label: 'Révisions IRL', icon: TrendingUp },
  { key: 'charges-regularisation', label: 'Régul. charges', icon: FolderClock },
];
const TAB_KEYS = TABS.map((t) => t.key);
const TAB_DOMAIN = {
  'compte-locataire': 'loyers',
  'impayes': 'alertes',
  'quittances': 'documents',
  'loyers-revision': 'loyers',
  'charges-regularisation': 'loyers',
};

const Fallback = () => (
  <div className="flex items-center justify-center h-64">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

function KpiCard({ icon: Icon, label, value, tone, domain = 'loyers' }) {
  const toneCls =
    tone === 'emerald' ? 'text-emerald-600'
    : tone === 'amber' ? 'text-amber-600'
    : 'text-foreground';
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={cn('w-4 h-4', colorForDomain(domain))} />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${toneCls}`}>{value}</p>
    </Card>
  );
}

export default function Loyers() {
  const [params, setParams] = useSearchParams();
  const { withOwner } = useOwnerFilter();

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [period, setPeriod] = useState(currentPeriod);

  // Onglet par défaut contextuel : si impayés > 15 jours → Impayés, sinon Compte locataire.
  const paramTab = params.get('tab');
  const [tab, setTab] = useState(() =>
    paramTab && TAB_KEYS.includes(paramTab) ? paramTab : null
  );

  const { data: impayes = [], isLoading: impLoading } = useQuery({
    queryKey: ['impayes'],
    queryFn: () => base44.entities.Impaye.filter(withOwner(), '-detected_date', 200),
  });
  const hasOldImpayes = impayes.some(
    (i) => i.status !== 'régularisé' && i.status !== 'abandonné' && (Number(i.late_days) || 0) > 15
  );

  useEffect(() => {
    if (tab !== null) return;
    if (impLoading) return;
    setTab(hasOldImpayes ? 'impayes' : 'compte-locataire');
  }, [tab, impLoading, hasOldImpayes]);

  function changeTab(key) {
    setTab(key);
    setParams(key === 'compte-locataire' ? {} : { tab: key }, { replace: true });
  }

  // KPI du mois (partagé avec MonthCollections via la même queryKey).
  const { data: dues = [], isLoading: duesLoading } = useQuery({
    queryKey: ['loyers-dues', period],
    queryFn: () => base44.entities.RentDue.filter(withOwner({ period }), undefined, 500),
  });
  const kpi = useMemo(() => {
    const attendu = dues.reduce((s, d) => s + (Number(d.total_due) || 0), 0);
    const encaisse = dues.reduce((s, d) => s + (Number(d.paid_amount) || 0), 0);
    const reste = dues.reduce((s, d) => s + Math.max(0, Number(d.balance) || 0), 0);
    return { attendu, encaisse, reste };
  }, [dues]);

  const active = tab || 'compte-locataire';

  const monthLabel = useMemo(() => {
    const [y, m] = period.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }, [period]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* En-tête + sélecteur de mois */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Loyers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ce que vous devez encaisser — vue mensuelle par locataire.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium">Mois</label>
        <Input
          type="month"
          value={period}
          onChange={(e) => setPeriod(e.target.value || currentPeriod)}
          className="w-44"
        />
        <span className="text-sm text-muted-foreground capitalize">{monthLabel}</span>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {duesLoading ? (
          <><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></>
        ) : (
          <>
            <KpiCard icon={Euro} label="Attendu ce mois" value={formatCurrency(kpi.attendu)} />
            <KpiCard icon={Wallet} label="Encaissé" value={formatCurrency(kpi.encaisse)} tone="emerald" />
            <KpiCard icon={AlertTriangle} label="Reste à encaisser" value={formatCurrency(kpi.reste)} tone="amber" domain="alertes" />
          </>
        )}
      </div>

      {/* Onglets */}
      <div>
        <Tabs value={active} onValueChange={changeTab}>
          <TabsList className="flex flex-wrap h-auto p-1 w-full justify-start">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                <t.icon className={cn('w-4 h-4', colorForDomain(TAB_DOMAIN[t.key] || 'loyers'))} /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="compte-locataire" className="mt-6">
            <MonthCollections period={period} />
          </TabsContent>
          <TabsContent value="impayes" className="mt-6">
            <Suspense fallback={<Fallback />}><Impayes /></Suspense>
          </TabsContent>
          <TabsContent value="quittances" className="mt-6">
            <Suspense fallback={<Fallback />}>
              <Quittances period={period} onPeriodChange={setPeriod} />
            </Suspense>
          </TabsContent>
          <TabsContent value="loyers-revision" className="mt-6">
            <Suspense fallback={<Fallback />}><RentIndexation /></Suspense>
          </TabsContent>
          <TabsContent value="charges-regularisation" className="mt-6">
            <Suspense fallback={<Fallback />}><ChargeRegularization /></Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}