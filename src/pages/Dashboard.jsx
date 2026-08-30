// Dashboard — cockpit investisseur immobilier (3 zones : PatrimonyHero, TodayZone, DetailsZone)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { seedDemoData } from '@/lib/demoSeed';
import PullToRefresh from '@/components/ui/PullToRefresh';
import { Building2, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import OnboardingEmptyState from '@/components/OnboardingEmptyState';
import ExportReportButton from '@/components/dashboard/ExportReportButton';
import DemoBanner from '@/components/dashboard/DemoBanner';
import CockpitFilters from '@/components/dashboard/CockpitFilters';
import CalendarMonthDialog from '@/components/dashboard/calendar/CalendarMonthDialog';
import PatrimonyHero from '@/components/dashboard/PatrimonyHero';
import TodayZone from '@/components/dashboard/TodayZone';
import DetailsZone from '@/components/dashboard/DetailsZone';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { computeCockpit } from '@/lib/cockpitEngine';
import { triggerMilestone } from '@/lib/celebrations';

const THIS_YEAR = new Date().getFullYear();

export default function Dashboard() {
  const { user } = useAuth();
  const [selectedHolderId, setSelectedHolderId] = useState('all');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [selectedYear, setSelectedYear] = useState(THIS_YEAR);
  const [detail, setDetail] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [autoSeeding, setAutoSeeding] = useState(false);
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const seedTried = useRef(false);

  const handleRefresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['properties'] }),
      queryClient.invalidateQueries({ queryKey: ['lots'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['impayes'] }),
      queryClient.invalidateQueries({ queryKey: ['leases'] }),
      queryClient.invalidateQueries({ queryKey: ['bank-tx-pending'] }),
      queryClient.invalidateQueries({ queryKey: ['quittances'] }),
      queryClient.invalidateQueries({ queryKey: ['alerts'] }),
      queryClient.invalidateQueries({ queryKey: ['rent-dues'] }),
      queryClient.invalidateQueries({ queryKey: ['payments'] }),
      queryClient.invalidateQueries({ queryKey: ['attention-queue'] }),
      queryClient.invalidateQueries({ queryKey: ['personal-reminders'] }),
      queryClient.invalidateQueries({ queryKey: ['automation-rate', 'current'] }),
      queryClient.invalidateQueries({ queryKey: ['jobruns-recent'] }),
    ]);
  };

  const { data: properties = [], isLoading: loadingProps } = useQuery({
    queryKey: ['properties'],
    queryFn: () => base44.entities.Property.filter(withOwner()),
  });

  // Auto-seed démo (dev only)
  useEffect(() => {
    if (loadingProps || seedTried.current) return;
    if (properties.length > 0 || !user?.email) return;
    seedTried.current = true;
    setAutoSeeding(true);
    seedDemoData(user.email)
      .then(() => queryClient.invalidateQueries({ queryKey: ['properties'] }))
      .then(() => queryClient.invalidateQueries({ queryKey: ['lots'] }))
      .then(() => queryClient.invalidateQueries({ queryKey: ['transactions'] }))
      .then(() => queryClient.invalidateQueries({ queryKey: ['holders'] }))
      .then(() => queryClient.invalidateQueries({ queryKey: ['all-property-holders'] }))
      .catch(() => {})
      .finally(() => setAutoSeeding(false));
  }, [loadingProps, properties.length, user?.email, queryClient]);

  // Célébration anniversaire d'utilisation (1 an)
  useEffect(() => {
    if (!user?.created_date) return;
    const ms = Date.now() - new Date(user.created_date).getTime();
    if (ms >= 365 * 24 * 3600 * 1000) triggerMilestone('12_months_active');
  }, [user?.created_date]);

  const { data: lots = [] } = useQuery({ queryKey: ['lots'], queryFn: () => base44.entities.Lot.filter(withOwner()) });
  const { data: leases = [] } = useQuery({ queryKey: ['leases'], queryFn: () => base44.entities.Lease.filter(withOwner()) });
  const { data: transactions = [] } = useQuery({ queryKey: ['transactions', 'cockpit', selectedYear], queryFn: () => base44.entities.Transaction.filter(withOwner({ year: selectedYear })) });
  const { data: allLinks = [] } = useQuery({ queryKey: ['all-property-holders'], queryFn: () => base44.entities.PropertyHolder.filter(withOwner()) });
  const { data: allHolders = [] } = useQuery({ queryKey: ['holders'], queryFn: () => base44.entities.Holder.filter(withOwner()) });
  const { data: allMembers = [] } = useQuery({ queryKey: ['holder-members'], queryFn: () => base44.entities.HolderMember.filter(withOwner()) });
  const { data: impayes = [] } = useQuery({ queryKey: ['impayes'], queryFn: () => base44.entities.Impaye.filter(withOwner()) });
  const { data: bankTxPending = [] } = useQuery({ queryKey: ['bank-tx-pending'], queryFn: () => base44.entities.BankTransaction.filter(withOwner({ status: 'pending' })) });
  const { data: quittances = [] } = useQuery({ queryKey: ['quittances'], queryFn: () => base44.entities.Quittance.filter(withOwner()) });

  const hasDemoData = [properties, lots, transactions, allLinks, allHolders].some((arr) => Array.isArray(arr) && arr.some((r) => r?.is_demo === true));

  const cockpit = useMemo(() => computeCockpit({
    properties, lots, leases, transactions, impayes, bankTxPending, quittances,
    allLinks, allHolders, allMembers,
    selectedHolderId, propertyFilter,
    year: selectedYear,
  }), [properties, lots, leases, transactions, impayes, bankTxPending, quittances, allLinks, allHolders, allMembers, selectedHolderId, propertyFilter, selectedYear]);

  const { kpis: k, kpiDetails, filteredProperties } = cockpit;
  const open = (key) => { setDetail(kpiDetails[key]); setDetailsOpen(true); };

  if (loadingProps) {
    return (<div className="flex items-center justify-center h-screen"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>);
  }

  if (properties.length === 0) {
    return (
      <PullToRefresh onRefresh={handleRefresh}>
        <div className="p-6 lg:p-8 max-w-[1600px]">
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
            <p className="text-sm text-muted-foreground mt-1">Cockpit de pilotage de votre patrimoine immobilier</p>
          </div>
          {autoSeeding ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Initialisation des données de démonstration…</p>
            </div>
          ) : (
            <OnboardingEmptyState icon={Building2} />
          )}
        </div>
      </PullToRefresh>
    );
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
        {/* Header + filtres */}
        <div className="flex flex-col gap-3 mb-8">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
              <p className="text-sm text-muted-foreground mt-1">{filteredProperties.length} bien(s) · exercice {selectedYear}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {hasDemoData && <DemoBanner />}
              <Button variant="outline" size="icon" onClick={() => setCalendarOpen(true)} title="Ouvrir l'agenda" aria-label="Ouvrir l'agenda">
                <CalendarDays className="w-4 h-4" />
              </Button>
              <ExportReportButton properties={properties} lots={lots} allLinks={allLinks} allHolders={allHolders} />
            </div>
          </div>
          <CockpitFilters
            properties={properties}
            year={selectedYear}
            onYear={setSelectedYear}
            propertyFilter={propertyFilter}
            onProperty={setPropertyFilter}
            allHolders={allHolders}
            allMembers={allMembers}
            allLinks={allLinks}
            selectedHolderId={selectedHolderId}
            onHolder={setSelectedHolderId}
          />
        </div>

        {/* 3 zones verticales — espace généreux entre elles */}
        <div className="space-y-10">
          {/* Zone 1 — PatrimonyHero : patrimoine net, 3 KPI, puce jobs */}
          <PatrimonyHero
            k={k}
            filteredProperties={filteredProperties}
            lots={lots}
            leases={leases}
          />

          {/* Zone 2 — Aujourd'hui : attention queue + rappels + calendrier fusionnés */}
          <TodayZone />

          {/* Zone 3 — Patrimoine en détail (replié) */}
          <DetailsZone
            k={k}
            kpiDetails={kpiDetails}
            open={open}
            filteredProperties={filteredProperties}
            lots={lots}
            leases={leases}
            transactions={transactions}
            impayes={impayes}
            detail={detail}
            detailsOpen={detailsOpen}
            setDetailsOpen={setDetailsOpen}
          />
        </div>
      </div>

      <CalendarMonthDialog open={calendarOpen} onOpenChange={setCalendarOpen} />
    </PullToRefresh>
  );
}