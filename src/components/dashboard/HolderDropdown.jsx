import React, { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatPercent, calcTotalAcquisition } from '@/lib/formatters';
import { ChevronDown, Users } from 'lucide-react';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { computeHolderValue } from '@/lib/ownership';

export default function HolderDropdown({ properties, onSelect }) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState('all');
  const { withOwner } = useOwnerFilter();

  const select = (id) => { setSelectedId(id); setOpen(false); onSelect?.(id); };
  const ref = useRef(null);

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

  useEffect(() => {
    const handle = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const propsWithValue = properties.map(p => ({
    ...p,
    _value: p.estimated_value || calcTotalAcquisition(p)
  }));
  const totalPortfolioValue = propsWithValue.reduce((s, p) => s + p._value, 0);

  const legalTypes = ['SCI', 'SCI familiale', 'SARL', 'SAS', 'SCPI', 'Indivision'];
  const legalHolders = allHolders.filter(h => legalTypes.includes(h.type));
  const physicalHolders = allHolders.filter(h => h.type === 'Personne physique');

  // Valeur économique d'un détenteur (traverse la chaîne des structures via HolderMember).
  const holderValue = (h) => computeHolderValue({
    holderId: h.id, properties: propsWithValue, members: allMembers, propertyHolders: allLinks
  }).value;

  const selectedLabel = selectedId === 'all' ? 'Tous les détenteurs' :
    allHolders.find(h => h.id === selectedId)?.name || 'Tous les détenteurs';

  const sections = [
    {
      label: 'Personnes morales',
      items: legalHolders.map(h => ({
        id: h.id, name: h.name, type: h.type, value: holderValue(h)
      })).filter(h => h.value > 0)
    },
    {
      label: 'Personnes physiques',
      items: physicalHolders.map(h => ({
        id: h.id, name: h.name, type: h.type, value: holderValue(h)
      })).filter(h => h.value > 0)
    }
  ];

  if (allHolders.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-sm font-medium shadow-sm"
      >
        <Users className="w-4 h-4 text-muted-foreground" />
        <span className="max-w-[180px] truncate">{selectedLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-80 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
          <button
            onClick={() => select('all')}
            className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors border-b border-border ${selectedId === 'all' ? 'bg-primary/5 text-primary font-semibold' : ''}`}
          >
            <span>Tous les détenteurs</span>
            <span className="text-xs text-muted-foreground number-fr">{formatCurrency(totalPortfolioValue)}</span>
          </button>

          {sections.map(section => (
            section.items.length === 0 ? null : (
              <div key={section.label}>
                <div className="px-4 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30 border-b border-border">
                  {section.label}
                </div>
                {section.items.map(item => (
                  <div key={item.id}>
                    <button
                      onClick={() => select(item.id)}
                      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors ${selectedId === item.id ? 'bg-primary/5 text-primary font-semibold' : ''}`}
                    >
                      <div className="text-left">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.type}</p>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="text-xs font-semibold number-fr">{formatCurrency(item.value)}</p>
                        <p className="text-xs text-muted-foreground">
                          {totalPortfolioValue > 0 ? formatPercent(item.value / totalPortfolioValue * 100) : '—'}
                        </p>
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}