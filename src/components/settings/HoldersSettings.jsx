import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, ChevronDown, ChevronRight, Building2, User, Percent } from 'lucide-react';
import { toast } from 'sonner';
import { useOwnerFilter } from '@/lib/tenantFilter';

const LEGAL_TYPES = ['SCI', 'SCI familiale', 'SARL', 'SAS', 'SCPI', 'Indivision'];
const PHYSICAL_TYPE = 'Personne physique';

const EMPTY_LEGAL = { name: '', type: 'SCI', email: '', phone: '', siret: '', capital: '', creation_date: '', bank: '', notes: '' };
const EMPTY_PHYSICAL = { name: '', type: PHYSICAL_TYPE, email: '', phone: '', notes: '' };
const EMPTY_LINK = { holder_id: '', share_percent: '' };

function FormField({ label, value, onChange, placeholder, type = 'text', className = '' }) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
      <Input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="h-8 text-sm" />
    </div>
  );
}

function LegalHolderCard({ holder, allHolders, members, onDelete, onAddMember, onDeleteMember }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_LINK });

  // Membres canoniques via HolderMember (parent = cette structure).
  const memberLinks = (members || []).filter(m => m.parent_holder_id === holder.id);
  const memberDetails = memberLinks.map(m => ({
    ...m,
    holderInfo: allHolders.find(h => h.id === m.member_holder_id)
  }));

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-3 p-4 bg-card hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={() => setOpen(v => !v)}>
        <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
          <Building2 className="w-4 h-4 text-violet-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{holder.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="outline" className="text-xs py-0">{holder.type}</Badge>
            {holder.siret && <span className="text-xs text-muted-foreground">SIRET: {holder.siret}</span>}
            <span className="text-xs text-muted-foreground">{memberDetails.length} associé{memberDetails.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive shrink-0"
          onClick={e => { e.stopPropagation(); onDelete(holder.id); }}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
        <span className="text-muted-foreground shrink-0">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
      </div>

      {open && (
        <div className="border-t border-border bg-muted/10 p-4 space-y-3">
          {/* Membres (HolderMember canonique) */}
          {memberDetails.length > 0 ? (
            <div className="space-y-2">
              {memberDetails.map(m => (
                <div key={m.id} className="flex items-center justify-between p-2.5 bg-card rounded-lg border border-border/60">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                      <User className="w-3.5 h-3.5 text-blue-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{m.holderInfo?.name || 'Inconnu'}</p>
                      <p className="text-xs text-muted-foreground">{m.holderInfo?.type || 'Type inconnu'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-semibold">
                      <Percent className="w-3 h-3" />
                      {m.share_percent}%
                    </div>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive"
                      onClick={() => onDeleteMember(m.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">Aucun associé déclaré</p>
          )}

          {/* Ajouter un associé = créer un HolderMember */}
          <div className="flex items-end gap-2 pt-1 border-t border-border/40">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground mb-1 block">Ajouter un associé</Label>
              <Select value={form.holder_id} onValueChange={v => setForm(p => ({ ...p, holder_id: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Détenteur..." /></SelectTrigger>
                <SelectContent>
                  {allHolders.filter(h => h.id !== holder.id && !memberDetails.find(m => m.member_holder_id === h.id)).map(h => (
                    <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-28">
              <Label className="text-xs text-muted-foreground mb-1 block">Part (%)</Label>
              <Input type="number" min={0} max={100} value={form.share_percent}
                onChange={e => setForm(p => ({ ...p, share_percent: e.target.value }))}
                placeholder="Ex: 50" className="h-8 text-xs" />
            </div>
            <Button size="sm" className="h-8 text-xs gap-1" disabled={!form.holder_id || !form.share_percent}
              onClick={() => {
                onAddMember(holder.id, form.holder_id, parseFloat(form.share_percent));
                setForm({ ...EMPTY_LINK });
              }}>
              <Plus className="w-3.5 h-3.5" />Ajouter
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HoldersSettings() {
  const queryClient = useQueryClient();
  const { withOwner, ownerEmail } = useOwnerFilter();
  const [legalForm, setLegalForm] = useState(null);
  const [physForm, setPhysForm] = useState(null);
  const [editingPhysical, setEditingPhysical] = useState(null);

  const { data: holders = [] } = useQuery({
    queryKey: ['holders'],
    queryFn: () => base44.entities.Holder.filter(withOwner()),
  });
  const { data: members = [] } = useQuery({
    queryKey: ['holder-members'],
    queryFn: () => base44.entities.HolderMember.filter(withOwner()),
  });

  const legalHolders = holders.filter(h => LEGAL_TYPES.includes(h.type));
  const physicalHolders = holders.filter(h => h.type === PHYSICAL_TYPE);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Holder.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['holders'] }); toast.success('Détenteur créé'); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Holder.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holders'] });
      setEditingPhysical(null);
      toast.success('Personne modifiée');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Holder.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holders'] });
      queryClient.invalidateQueries({ queryKey: ['holder-members'] });
      queryClient.invalidateQueries({ queryKey: ['all-property-holders'] });
      toast.success('Détenteur supprimé');
    },
  });

  const createMemberMutation = useMutation({
    mutationFn: (data) => base44.entities.HolderMember.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['holder-members'] }); toast.success('Associé ajouté'); },
  });
  const deleteMemberMutation = useMutation({
    mutationFn: (id) => base44.entities.HolderMember.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['holder-members'] }); toast.success('Associé retiré'); },
  });

  const handleAddLegal = () => {
    if (!legalForm.name) return toast.error('Nom obligatoire');
    const { ...rest } = legalForm;
    createMutation.mutate({ ...rest, owner_id: ownerEmail });
    setLegalForm(null);
  };

  const handleAddPhysical = () => {
    if (!physForm.name) return toast.error('Nom obligatoire');
    const nameExists = physicalHolders.some(h => h.name?.toLowerCase() === physForm.name?.toLowerCase());
    if (nameExists) return toast.error('Cette personne physique existe déjà');
    createMutation.mutate({ ...physForm, owner_id: ownerEmail });
    setPhysForm(null);
  };

  // Création d'un lien canonique HolderMember (parent = structure, member = associé).
  const handleAddMember = (legalId, memberId, pct) => {
    if (members.some(m => m.parent_holder_id === legalId && m.member_holder_id === memberId)) {
      return toast.error('Cet associé est déjà dans cette structure');
    }
    createMemberMutation.mutate({
      owner_id: ownerEmail,
      parent_holder_id: legalId,
      member_holder_id: memberId,
      share_percent: pct
    });
  };

  const handleDeleteMember = (memberLinkId) => {
    deleteMemberMutation.mutate(memberLinkId);
  };

  return (
    <div className="space-y-8">
      {/* Personnes morales */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Building2 className="w-4 h-4 text-violet-600" />
          <h2 className="font-semibold text-sm">Personnes morales</h2>
          <Badge variant="secondary" className="text-xs ml-auto">{legalHolders.length}</Badge>
        </div>
        <div className="p-6 space-y-4">
          {legalForm ? (
            <div className="space-y-3 pb-4 border-b border-border">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <FormField label="Nom *" value={legalForm.name} onChange={v => setLegalForm(p => ({ ...p, name: v }))} placeholder="SCI Dupont..." />
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Type *</Label>
                  <Select value={legalForm.type} onValueChange={v => setLegalForm(p => ({ ...p, type: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{LEGAL_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <FormField label="SIRET" value={legalForm.siret} onChange={v => setLegalForm(p => ({ ...p, siret: v }))} placeholder="123 456 789 00012" />
                <FormField label="Capital social" type="number" value={legalForm.capital} onChange={v => setLegalForm(p => ({ ...p, capital: v }))} placeholder="€" />
                <FormField label="Date de création" type="date" value={legalForm.creation_date} onChange={v => setLegalForm(p => ({ ...p, creation_date: v }))} />
                <FormField label="Banque" value={legalForm.bank} onChange={v => setLegalForm(p => ({ ...p, bank: v }))} placeholder="Banque société" />
                <FormField label="Email" value={legalForm.email} onChange={v => setLegalForm(p => ({ ...p, email: v }))} placeholder="contact@sci.fr" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="gap-1.5" onClick={handleAddLegal} disabled={createMutation.isPending}>
                  <Plus className="w-3.5 h-3.5" />Créer
                </Button>
                <Button size="sm" variant="outline" onClick={() => setLegalForm(null)}>Annuler</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setLegalForm({ ...EMPTY_LEGAL })}>
              <Plus className="w-3.5 h-3.5" />Ajouter une personne morale
            </Button>
          )}

          <div className="space-y-3 mt-2">
            {legalHolders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Aucune personne morale déclarée</p>
            ) : legalHolders.map(h => (
              <LegalHolderCard
                key={h.id}
                holder={h}
                allHolders={holders}
                members={members}
                onDelete={(id) => deleteMutation.mutate(id)}
                onAddMember={handleAddMember}
                onDeleteMember={handleDeleteMember}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Personnes physiques */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <User className="w-4 h-4 text-blue-600" />
          <h2 className="font-semibold text-sm">Personnes physiques</h2>
          <Badge variant="secondary" className="text-xs ml-auto">{physicalHolders.length}</Badge>
        </div>
        <div className="p-6 space-y-4">
          {physForm ? (
            <div className="space-y-3 pb-4 border-b border-border">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <FormField label="Nom *" value={physForm.name} onChange={v => setPhysForm(p => ({ ...p, name: v }))} placeholder="Jean Dupont" />
                <FormField label="Email" value={physForm.email} onChange={v => setPhysForm(p => ({ ...p, email: v }))} placeholder="jean@email.fr" />
                <FormField label="Téléphone" value={physForm.phone} onChange={v => setPhysForm(p => ({ ...p, phone: v }))} placeholder="06..." />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="gap-1.5" onClick={handleAddPhysical} disabled={createMutation.isPending}>
                  <Plus className="w-3.5 h-3.5" />Créer
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPhysForm(null)}>Annuler</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPhysForm({ ...EMPTY_PHYSICAL })}>
              <Plus className="w-3.5 h-3.5" />Ajouter une personne physique
            </Button>
          )}

          <div className="space-y-2">
            {physicalHolders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Aucune personne physique déclarée</p>
            ) : physicalHolders.map(ph => {
              return editingPhysical?.id === ph.id ? (
                <div key={ph.id} className="p-3 rounded-lg border border-primary bg-primary/5 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <FormField label="Nom *" value={editingPhysical.name} onChange={v => setEditingPhysical(p => ({ ...p, name: v }))} placeholder="Jean Dupont" />
                    <FormField label="Email" value={editingPhysical.email} onChange={v => setEditingPhysical(p => ({ ...p, email: v }))} placeholder="jean@email.fr" />
                    <FormField label="Téléphone" value={editingPhysical.phone} onChange={v => setEditingPhysical(p => ({ ...p, phone: v }))} placeholder="06..." />
                  </div>
                  <FormField label="Adresse" value={editingPhysical.address} onChange={v => setEditingPhysical(p => ({ ...p, address: v }))} placeholder="Adresse complète" />
                  <div className="flex gap-2 justify-end pt-1 border-t border-primary/20">
                    <Button variant="outline" size="sm" onClick={() => setEditingPhysical(null)}>Annuler</Button>
                    <Button size="sm" onClick={() => updateMutation.mutate({ id: ph.id, data: editingPhysical })} disabled={updateMutation.isPending || !editingPhysical.name}>
                      Enregistrer
                    </Button>
                  </div>
                </div>
              ) : (
                <div key={ph.id} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => setEditingPhysical(ph)}>
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-blue-700">{ph.name?.charAt(0)?.toUpperCase()}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium">{ph.name}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {ph.email && <span className="text-xs text-muted-foreground">{ph.email}</span>}
                        {ph.phone && <span className="text-xs text-muted-foreground">{ph.phone}</span>}
                      </div>
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive shrink-0"
                    onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(ph.id); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}