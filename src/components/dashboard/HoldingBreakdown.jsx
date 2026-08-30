import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatPercent, calcTotalAcquisition } from '@/lib/formatters';
import { Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { memberChildrenOf } from '@/lib/ownership';

const COLORS = ['hsl(200,70%,50%)', 'hsl(260,70%,55%)', 'hsl(140,65%,45%)', 'hsl(30,80%,50%)', 'hsl(340,70%,50%)', 'hsl(170,60%,40%)'];

export default function HoldingBreakdown({ properties }) {
  const [expanded, setExpanded] = useState({});
  const { withOwner } = useOwnerFilter();

  const { data: allLinks = [] } = useQuery({
    queryKey: ['all-property-holders'],
    queryFn: () => base44.entities.PropertyHolder.filter(withOwner()),
  });
  const { data: allHolders = [] } = useQuery({
    queryKey: ['holders'],
    queryFn: () => base44.entities.Holder.filter(withOwner()),
  });
  const { data: allMembers = [] } = useQuery({
    queryKey: ['holder-members'],
    queryFn: () => base44.entities.HolderMember.filter(withOwner()),
  });

  const totalPortfolioValue = properties.reduce((s, p) => s + (p.estimated_value || calcTotalAcquisition(p)), 0);

  // Agrégation par détenteur direct (lien PropertyHolder).
  const holderMap = {};
  for (const link of allLinks) {
    const prop = properties.find(p => p.id === link.property_id);
    if (!prop) continue;
    const propValue = (prop.estimated_value || calcTotalAcquisition(prop)) * (link.share_percent / 100);
    if (!holderMap[link.holder_id]) holderMap[link.holder_id] = { value: 0, count: 0, links: [] };
    holderMap[link.holder_id].value += propValue;
    holderMap[link.holder_id].count += 1;
    holderMap[link.holder_id].links.push({ ...link, propValue });
  }

  // Biens sans détenteurs explicites -> regroupés par structure de détention déclarée.
  const structureMap = {};
  for (const prop of properties) {
    const hasLinks = allLinks.some(l => l.property_id === prop.id);
    if (!hasLinks) {
      const key = prop.holding_structure || 'Non déclaré';
      if (!structureMap[key]) structureMap[key] = { value: 0, count: 0 };
      structureMap[key].value += (prop.estimated_value || calcTotalAcquisition(prop));
      structureMap[key].count += 1;
    }
  }

  const holderEntries = Object.entries(holderMap).map(([id, d]) => {
    const holder = allHolders.find(h => h.id === id);
    const subHolders = memberChildrenOf(allMembers, id).map(m => {
      const sh = allHolders.find(h => h.id === m.member_holder_id);
      return { id: m.id, name: sh?.name || 'Inconnu', type: sh?.type || '—', sub_share_percent: m.share_percent };
    });
    return { id, name: holder?.name || 'Inconnu', type: holder?.type || '—', ...d, holder, subHolders };
  });

  const structureEntries = Object.entries(structureMap).map(([name, d]) => ({
    id: name, name, type: 'Structure', ...d, holder: null, subHolders: []
  }));

  const all = [...holderEntries, ...structureEntries].sort((a, b) => b.value - a.value);

  if (all.length === 0) return null;

  const toggle = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center gap-2">
        <Users className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">Détention — Répartition par détenteur / structure</h2>
      </div>
      <div className="p-5 space-y-4">
        <div className="h-3 rounded-full overflow-hidden flex bg-muted">
          {all.map((entry, i) => (
            <div key={entry.id}
              className="h-full"
              style={{ width: `${totalPortfolioValue > 0 ? (entry.value / totalPortfolioValue * 100) : 0}%`, backgroundColor: COLORS[i % COLORS.length] }}
              title={`${entry.name}: ${formatCurrency(entry.value)}`} />
          ))}
        </div>

        <div className="space-y-2">
          {all.map((entry, i) => {
            const hasSubHolders = entry.subHolders?.length > 0;
            const isExpanded = expanded[entry.id];
            return (
              <div key={entry.id} className="rounded-xl border border-border overflow-hidden">
                <div
                  className={`flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors ${hasSubHolders ? 'cursor-pointer' : ''}`}
                  onClick={hasSubHolders ? () => toggle(entry.id) : undefined}>
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{entry.name}</p>
                      <Badge variant="outline" className="text-xs py-0 shrink-0">{entry.type}</Badge>
                      {hasSubHolders && (
                        <span className="text-xs text-muted-foreground shrink-0">{entry.subHolders.length} associé{entry.subHolders.length > 1 ? 's' : ''}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{entry.count} bien{entry.count > 1 ? 's' : ''}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold number-fr">{formatCurrency(entry.value)}</p>
                    <p className="text-xs text-muted-foreground">
                      {totalPortfolioValue > 0 ? formatPercent(entry.value / totalPortfolioValue * 100) : '—'} du portfolio
                    </p>
                  </div>
                </div>

                {isExpanded && hasSubHolders && (
                  <div className="border-t border-border/50 bg-muted/20 px-4 py-3 space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">Associés dans {entry.name}</p>
                    {entry.subHolders.map(sh => {
                      const shValue = entry.value * (sh.sub_share_percent || 0) / 100;
                      const shPortfolioPct = totalPortfolioValue > 0 ? shValue / totalPortfolioValue * 100 : 0;
                      return (
                        <div key={sh.id} className="flex items-center justify-between p-2 bg-card rounded-lg border border-border/50">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-xs font-semibold">
                              {sh.name?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <div>
                              <p className="text-xs font-medium">{sh.name}</p>
                              <Badge variant="secondary" className="text-xs py-0 mt-0.5">{sh.type}</Badge>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold number-fr text-primary">{formatCurrency(shValue)}</p>
                            <p className="text-xs text-muted-foreground">
                              {sh.sub_share_percent ?? '—'}% dans struct. · {formatPercent(shPortfolioPct)} portfolio
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}