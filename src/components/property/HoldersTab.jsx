import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/formatters';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { memberChildrenOf } from '@/lib/ownership';

const STRUCTURE_TYPES = ["SCI", "SCI familiale", "SARL", "SAS", "SCPI", "Indivision"];

export default function HoldersTab({ propertyId, estimatedValue }) {
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const [showAdd, setShowAdd] = useState(false);
  const [holderId, setHolderId] = useState('');
  const [sharePercent, setSharePercent] = useState('');
  const [expandedHolders, setExpandedHolders] = useState({});

  const { data: links = [] } = useQuery({
    queryKey: ['property-holders', propertyId],
    queryFn: () => base44.entities.PropertyHolder.filter(withOwner({ property_id: propertyId })),
  });
  const { data: allHolders = [] } = useQuery({
    queryKey: ['holders'],
    queryFn: () => base44.entities.Holder.filter(withOwner()),
  });
  // Membres canoniques (HolderMember) — détention imbriquée.
  const { data: allMembers = [] } = useQuery({
    queryKey: ['holder-members'],
    queryFn: () => base44.entities.HolderMember.filter(withOwner()),
  });

  // Détenteurs disponibles: structures + personnes physiques (mêmes celles déjà associées à une SCI).
  const availableHolders = allHolders;
  const linkedIds = new Set(links.map(l => l.holder_id));

  const addLinkMutation = useMutation({
    mutationFn: (d) => base44.entities.PropertyHolder.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-holders', propertyId] });
      queryClient.invalidateQueries({ queryKey: ['all-property-holders'] });
      toast.success('Détenteur ajouté');
      setShowAdd(false); setHolderId(''); setSharePercent('');
    },
  });

  const deleteLinkMutation = useMutation({
    mutationFn: (id) => base44.entities.PropertyHolder.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-holders', propertyId] });
      queryClient.invalidateQueries({ queryKey: ['all-property-holders'] });
      toast.success('Détenteur retiré');
    },
  });

  const handleAdd = () => {
    if (!holderId) { toast.error('Sélectionner un détenteur'); return; }
    if (!sharePercent || Number(sharePercent) <= 0 || Number(sharePercent) > 100) { toast.error('Part entre 1 et 100 %'); return; }
    addLinkMutation.mutate({ property_id: propertyId, holder_id: holderId, share_percent: Number(sharePercent), owner_id: withOwner().owner_id });
  };

  const totalShare = links.reduce((s, l) => s + (l.share_percent || 0), 0);
  const getHolder = (id) => allHolders.find(h => h.id === id);
  const getSubHolders = (hId) => memberChildrenOf(allMembers, hId);
  const isStructure = (holder) => holder && STRUCTURE_TYPES.includes(holder.type);
  const toggleExpand = (id) => setExpandedHolders(p => ({ ...p, [id]: !p[id] }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Répartition des parts</p>
          <p className="text-xs text-muted-foreground">
            Total déclaré : <span className={totalShare === 100 ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>{totalShare.toFixed(2)} %</span>
            {totalShare !== 100 && <span className="ml-1 text-amber-600">(⚠ doit être 100%)</span>}
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowAdd(v => !v)}>
          <Plus className="w-4 h-4" />Associer un détenteur
        </Button>
      </div>

      {showAdd && (
        <div className="bg-muted/40 border border-border rounded-xl p-4 space-y-3">
          <p className="text-xs text-muted-foreground font-medium">Les détenteurs sont gérés dans <strong>Paramètres → Détenteurs</strong></p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Détenteur</Label>
              <Select value={holderId} onValueChange={setHolderId}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Choisir..." /></SelectTrigger>
                <SelectContent>
                  {availableHolders.filter(h => !linkedIds.has(h.id)).map(h => (
                    <SelectItem key={h.id} value={h.id}>{h.name} ({h.type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Part (%)*</Label>
              <Input type="number" min="0.01" max="100" step="0.01" value={sharePercent}
                onChange={e => setSharePercent(e.target.value)} placeholder="50" className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Annuler</Button>
            <Button size="sm" onClick={handleAdd} disabled={addLinkMutation.isPending}>Enregistrer</Button>
          </div>
        </div>
      )}

      {links.length === 0 && !showAdd ? (
        <div className="text-center py-10 text-muted-foreground border border-dashed border-border rounded-xl">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Aucun détenteur associé</p>
        </div>
      ) : (
        <div className="space-y-2">
          {links.map((link, i) => {
            const holder = getHolder(link.holder_id);
            const propValue = estimatedValue ? (estimatedValue * link.share_percent / 100) : null;
            const subHolders = getSubHolders(link.holder_id);
            const isStruct = isStructure(holder);
            const expanded = expandedHolders[link.holder_id];

            return (
              <div key={link.id} className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3">
                    {isStruct && subHolders.length > 0 && (
                      <button onClick={() => toggleExpand(link.holder_id)} className="text-muted-foreground hover:text-foreground transition-colors">
                        {expanded ? '+' : '▸'}
                      </button>
                    )}
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-primary font-semibold text-sm"
                      style={{ backgroundColor: `hsl(${(i * 60 + 200) % 360} 70% 90%)`, color: `hsl(${(i * 60 + 200) % 360} 70% 35%)` }}>
                      {holder?.name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{holder?.name || 'Inconnu'}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-xs py-0">{holder?.type || '—'}</Badge>
                        {isStruct && subHolders.length > 0 && (
                          <span className="text-xs text-muted-foreground">{subHolders.length} associé{subHolders.length > 1 ? 's' : ''}</span>
                        )}
                        {link.entry_date && <span className="text-xs text-muted-foreground">depuis {link.entry_date}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-base font-bold text-primary">{link.share_percent} %</p>
                      {propValue !== null && <p className="text-xs text-muted-foreground">{formatCurrency(propValue)}</p>}
                    </div>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                      onClick={() => deleteLinkMutation.mutate(link.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {isStruct && expanded && subHolders.length > 0 && (
                  <div className="border-t border-border/50 bg-muted/20 px-3 pb-3 space-y-2 pt-2">
                    <p className="text-xs text-muted-foreground font-medium px-1">Associés dans {holder?.name}</p>
                    {subHolders.map(sm => {
                      const sh = getHolder(sm.member_holder_id);
                      const shPropValue = propValue !== null ? (propValue * (sm.share_percent || 0) / 100) : null;
                      return (
                        <div key={sm.id} className="flex items-center justify-between p-2 bg-card rounded-lg border border-border/50 ml-4">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-xs font-semibold">
                              {sh?.name?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <div>
                              <p className="text-xs font-medium">{sh?.name || 'Inconnu'}</p>
                              <p className="text-xs text-muted-foreground">{sm.share_percent ?? '—'}% dans la structure</p>
                            </div>
                          </div>
                          {shPropValue !== null && sm.share_percent != null && (
                            <p className="text-xs font-medium text-muted-foreground">{formatCurrency(shPropValue)}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Progress bar */}
          <div className="mt-3 space-y-1">
            <div className="h-2 rounded-full bg-muted overflow-hidden flex">
              {links.map((link, i) => (
                <div key={link.id} title={`${getHolder(link.holder_id)?.name} : ${link.share_percent}%`}
                  className="h-full transition-all"
                  style={{ width: `${Math.min(link.share_percent, 100)}%`, backgroundColor: `hsl(${(i * 60 + 200) % 360} 70% 50%)` }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              {links.map((link, i) => (
                <div key={link.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: `hsl(${(i * 60 + 200) % 360} 70% 50%)` }} />
                  {getHolder(link.holder_id)?.name} ({link.share_percent}%)
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}