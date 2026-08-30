import React, { lazy, Suspense, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import HoldingBreakdown from '@/components/dashboard/HoldingBreakdown';
import PortfolioOverview from '@/components/dashboard/PortfolioOverview';

// Sous-sections lourdes (recharts, react-leaflet) chargées à l'ouverture du
// détail — découple le chunk Dashboard de ces dépendances (code-splitting).
const PortfolioEvolutionChart = lazy(() => import('@/components/dashboard/PortfolioEvolutionChart'));
const PortfolioMap = lazy(() => import('@/components/dashboard/PortfolioMap'));

const HeavyFallback = () => (
  <div className="h-40 rounded-xl border border-border bg-card flex items-center justify-center">
    <div className="w-7 h-7 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
  </div>
);

export default function DetailsZone({
  k, kpiDetails, open, filteredProperties, lots, leases, transactions, impayes,
  detail, detailsOpen, setDetailsOpen,
}) {
  const [openC, setOpenC] = useState(false);
  return (
    <Collapsible open={openC} onOpenChange={setOpenC}>
      <div className="flex items-center justify-between mb-4 px-1">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Patrimoine en détail</h2>
          <p className="text-sm text-muted-foreground">Détenteurs, biens, évolution 24 mois et carte.</p>
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            {openC ? 'Voir moins' : 'Voir plus'}
            <ChevronDown className={`w-4 h-4 transition-transform ${openC ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="space-y-5">
          <HoldingBreakdown properties={filteredProperties} />
          <PortfolioOverview
            k={k} kpiDetails={kpiDetails} open={open}
            filteredProperties={filteredProperties} lots={lots} leases={leases}
            transactions={transactions} impayes={impayes}
            detail={detail} detailsOpen={detailsOpen} setDetailsOpen={setDetailsOpen}
          />
          <Suspense fallback={<HeavyFallback />}><PortfolioEvolutionChart /></Suspense>
          <Suspense fallback={<HeavyFallback />}><PortfolioMap properties={filteredProperties} /></Suspense>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}