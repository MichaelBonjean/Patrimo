import React, { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeftRight, FileUp, PencilRuler, CalendarCheck, Settings as SettingsIcon, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { colorForDomain } from '@/lib/iconColors';
import Timeline from '@/components/banque/Timeline';
import ReconcileQueue from '@/components/banque/ReconcileQueue';
import CashflowCompare from '@/components/banque/CashflowCompare';
import BankRulesTab from '@/components/banque/BankRulesTab';
import ManualEntryForm from '@/components/import/ManualEntryForm';
import UnifiedImporter from '@/components/import/UnifiedImporter';
import { useOwnerFilter } from '@/lib/tenantFilter';

const MonthClose = lazy(() => import('@/pages/MonthClose'));

const TABS = [
  { key: 'rapprocher', label: 'À rapprocher', icon: ArrowLeftRight },
  { key: 'performance', label: 'Performance', icon: TrendingUp },
  { key: 'import', label: 'Import fichier', icon: FileUp },
  { key: 'saisie', label: 'Saisie manuelle', icon: PencilRuler },
  { key: 'cloture', label: 'Clôturer le mois', icon: CalendarCheck },
  { key: 'regles', label: 'Règles', icon: SettingsIcon },
];
const TAB_KEYS = TABS.map((t) => t.key);

const Fallback = () => (
  <div className="flex items-center justify-center h-64">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
  </div>
);

// Onglet Import fichier — point d'entrée unique (UnifiedImporter), toujours visible.
function ImportFichier() {
  const qc = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const { data: properties = [] } = useQuery({ queryKey: ['properties'], queryFn: () => base44.entities.Property.filter(withOwner()) });
  const { data: lots = [] } = useQuery({ queryKey: ['lots'], queryFn: () => base44.entities.Lot.filter(withOwner()) });
  const { data: rules = [] } = useQuery({ queryKey: ['bank-rules'], queryFn: () => base44.entities.BankRule.filter(withOwner()) });
  const { data: transactions = [] } = useQuery({ queryKey: ['transactions-all'], queryFn: () => base44.entities.Transaction.filter(withOwner()) });
  const { data: bankTransactions = [] } = useQuery({ queryKey: ['bank-transactions'], queryFn: () => base44.entities.BankTransaction.filter(withOwner(), '-created_date', 1000) });

  return (
    <UnifiedImporter
      properties={properties} lots={lots} rules={rules} transactions={transactions}
      bankTransactions={bankTransactions} withOwner={withOwner} queryClient={qc}
      onClose={() => {}}
    />
  );
}

// Onglet Saisie manuelle — encapsule le chargement des biens/lots pour le formulaire.
function SaisieManuelle() {
  const { withOwner } = useOwnerFilter();
  const { data: properties = [] } = useQuery({ queryKey: ['properties'], queryFn: () => base44.entities.Property.filter(withOwner()) });
  const { data: lots = [] } = useQuery({ queryKey: ['lots'], queryFn: () => base44.entities.Lot.filter(withOwner()) });
  return <ManualEntryForm properties={properties} lots={lots} onClose={() => {}} />;
}

export default function Banque() {
  const [params, setParams] = useSearchParams();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const active = TAB_KEYS.includes(params.get('tab')) ? params.get('tab') : 'rapprocher';
  const setTab = (k) => setParams(k === 'rapprocher' ? {} : { tab: k }, { replace: true });

  // Données du fil chronologique (analyse du mois en cours).
  const { data: closeData, isLoading: closeLoading } = useQuery({
    queryKey: ['month-close', year, month],
    queryFn: () => base44.functions.invoke('manageMonthClose', { op: 'analyze', year, month }).then((r) => r.data),
  });

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Banque</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Importer, rapprocher, vérifier et clôturer votre mois — en un seul endroit.
        </p>
      </div>

      {/* Fil chronologique focal */}
      {closeLoading ? (
        <div className="h-24 rounded-2xl border border-border bg-card animate-pulse" />
      ) : (
        <Timeline summary={closeData?.summary} status={closeData?.status} onStep={setTab} />
      )}

      <div>
        <Tabs value={active} onValueChange={setTab}>
          <TabsList className="flex flex-wrap h-auto p-1 w-full justify-start">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                <t.icon className={cn('w-4 h-4', colorForDomain('banque'))} /> {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="rapprocher" className="mt-8"><ReconcileQueue /></TabsContent>
          <TabsContent value="performance" className="mt-8"><CashflowCompare /></TabsContent>
          <TabsContent value="import" className="mt-8"><ImportFichier /></TabsContent>
          <TabsContent value="saisie" className="mt-8"><SaisieManuelle /></TabsContent>
          <TabsContent value="cloture" className="mt-8">
            <Suspense fallback={<Fallback />}><MonthClose /></Suspense>
          </TabsContent>
          <TabsContent value="regles" className="mt-8"><BankRulesTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}