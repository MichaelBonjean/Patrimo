import React from 'react';
import { CalendarDays, Building2 } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import HolderChips from '@/components/dashboard/HolderChips';

const THIS_YEAR = new Date().getFullYear();

export default function CockpitFilters({ properties, year, onYear, propertyFilter, onProperty, allHolders = [], allMembers = [], allLinks = [], selectedHolderId, onHolder, children }) {
  const years = [THIS_YEAR, THIS_YEAR - 1, THIS_YEAR - 2];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={String(year)} onValueChange={(v) => onYear(Number(v))}>
        <SelectTrigger className="w-[120px]"><CalendarDays className="w-4 h-4 mr-1.5 text-muted-foreground" /><SelectValue /></SelectTrigger>
        <SelectContent>
          {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
        </SelectContent>
      </Select>

      {children}

      <Select value={propertyFilter} onValueChange={onProperty}>
        <SelectTrigger className="w-[230px]"><Building2 className="w-4 h-4 mr-1.5 text-muted-foreground" /><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous les biens</SelectItem>
          {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
        </SelectContent>
      </Select>

      {/* Filtre détenteurs — à côté du filtre biens, màj auto du patrimoine */}
      <div className="min-w-0 flex-1">
        <HolderChips
          allHolders={allHolders}
          allMembers={allMembers}
          allLinks={allLinks}
          selectedHolderId={selectedHolderId}
          onSelectHolder={onHolder}
        />
      </div>
    </div>
  );
}