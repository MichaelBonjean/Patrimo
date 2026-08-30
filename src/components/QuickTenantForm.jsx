import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { formatCurrency } from '@/lib/formatters';
import { toast } from 'sonner';

function getLotTenants(lot) {
  const arr = Array.isArray(lot.tenants) ? [...lot.tenants] : [];
  if (lot.tenant_name && !arr.find(t => t.name === lot.tenant_name)) {
    arr.unshift({ id: 'legacy', name: lot.tenant_name, entry_date: lot.tenant_entry_date || '', exit_date: lot.tenant_exit_date || '', email: lot.tenant_email || '', phone: lot.tenant_phone || '' });
  }
  return arr;
}

export default function QuickTenantForm({ open, onClose }) {
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const [lotId, setLotId] = useState('');
  const [data, setData] = useState({ name: '', entry_date: '', exit_date: '', email: '', phone: '' });
  const update = (f, v) => setData(p => ({ ...p, [f]: v }));

  useQuery({ queryKey: ['lots'], queryFn: () => base44.entities.Lot.filter(withOwner()), enabled: open });
  useQuery({ queryKey: ['properties'], queryFn: () => base44.entities.Property.filter(withOwner()), enabled: open });
  const lots = queryClient.getQueryData(['lots']) || [];
  const properties = queryClient.getQueryData(['properties']) || [];

  const selectedLot = lots.find(l => l.id === lotId);
  const propName = (id) => properties.find(p => p.id === id)?.name || '—';

  const reset = () => {
    setLotId('');
    setData({ name: '', entry_date: '', exit_date: '', email: '', phone: '' });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const existing = getLotTenants(selectedLot);
      const newTenant = { id: crypto.randomUUID(), name: data.name, entry_date: data.entry_date || '', exit_date: data.exit_date || '', email: data.email || '', phone: data.phone || '' };
      return base44.entities.Lot.update(lotId, { tenants: [...existing, newTenant], is_vacant: false });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lots'] });
      toast.success('Locataire ajouté');
      reset();
      onClose();
    },
  });

  const submit = () => {
    if (!lotId) { toast.error('Sélectionnez un lot'); return; }
    if (!data.name?.trim()) { toast.error('Le nom est obligatoire'); return; }
    saveMutation.mutate();
  };

  const close = () => { reset(); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouveau locataire</DialogTitle>
          <DialogDescription>Renseignez le locataire et associez-le à un lot.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Lot *</Label>
            <Select value={lotId} onValueChange={setLotId}>
              <SelectTrigger><SelectValue placeholder="Choisir un lot" /></SelectTrigger>
              <SelectContent>
                {lots.map(l => {
                  const existing = getLotTenants(l);
                  const label = existing.length > 0 ? ` (${existing.map(t => t.name).join(', ')})` : '';
                  return <SelectItem key={l.id} value={l.id}>{propName(l.property_id)} — {l.designation}{label}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Prénom(s) et Nom *</Label>
            <Input value={data.name} onChange={e => update('name', e.target.value)} placeholder="Prénom(s) Nom" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label className="text-xs">Date d'entrée</Label><Input type="date" value={data.entry_date} onChange={e => update('entry_date', e.target.value)} /></div>
            <div><Label className="text-xs">Date de sortie</Label><Input type="date" value={data.exit_date} onChange={e => update('exit_date', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label className="text-xs">Email</Label><Input value={data.email} onChange={e => update('email', e.target.value)} placeholder="email@example.com" /></div>
            <div><Label className="text-xs">Téléphone</Label><Input value={data.phone} onChange={e => update('phone', e.target.value)} placeholder="+33..." /></div>
          </div>
          {selectedLot && (
            <div className="rounded-md bg-muted/40 border border-border p-2.5 text-xs text-muted-foreground">
              Loyer HC : <strong>{selectedLot.rent_excluding_charges ? formatCurrency(selectedLot.rent_excluding_charges) : '—'}</strong>
              {' · '}Charges : <strong>{formatCurrency(selectedLot.charges ?? 0)}</strong>
              {' · '}Caution : <strong>{selectedLot.deposit ? formatCurrency(selectedLot.deposit) : '—'}</strong>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={close}>Annuler</Button>
            <Button onClick={submit} disabled={saveMutation.isPending}>{saveMutation.isPending ? 'Enregistrement...' : 'Créer'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}