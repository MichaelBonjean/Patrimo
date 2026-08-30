import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, User } from 'lucide-react';
import { toast } from 'sonner';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { LEASE_TYPES, PAYMENT_FREQUENCIES, INDEXATION_TYPES, computeLeaseStatus, statusLabel } from '@/lib/lease';

const emptyTenant = () => ({ name: '', entry_date: '', exit_date: '', email: '', phone: '' });

export default function LeaseForm({ lease, lot, onClose }) {
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const isEdit = !!lease?.id;
  const [data, setData] = useState(() => ({
    lease_type: lot?.lease_type || 'Vide-Nu',
    date_start: lease?.date_start || '',
    date_end: lease?.date_end || '',
    tenants: lease?.tenants && lease.tenants.length > 0 ? lease.tenants : [emptyTenant()],
    rent_excluding_charges: lease?.rent_excluding_charges ?? lot?.rent_excluding_charges ?? '',
    charges: lease?.charges ?? lot?.charges ?? 0,
    deposit: lease?.deposit ?? lot?.deposit ?? '',
    due_day: lease?.due_day ?? 5,
    payment_frequency: lease?.payment_frequency || 'mensuel',
    indexation_type: lease?.indexation_type || 'aucune',
    index_reference: lease?.index_reference || '',
    last_revision_date: lease?.last_revision_date || '',
    next_revision_date: lease?.next_revision_date || '',
    furnished: lease?.furnished ?? !!lot?.furnished,
    notes: lease?.notes || '',
    status: lease?.status || 'actif',
  }));
  const [errors, setErrors] = useState({});
  const update = (f, v) => setData(p => ({ ...p, [f]: v }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const computedStatus = computeLeaseStatus({ date_start: data.date_start, date_end: data.date_end, status: data.status });
      const tenants = (data.tenants || [])
        .filter(t => t.name && t.name.trim())
        .map(t => ({ ...t, name: t.name.trim() }));
      const payload = {
        lease_type: data.lease_type,
        date_start: data.date_start || null,
        date_end: data.date_end || null,
        status: computedStatus,
        tenants,
        rent_excluding_charges: data.rent_excluding_charges === '' ? null : Number(data.rent_excluding_charges),
        charges: data.charges === '' ? 0 : Number(data.charges),
        deposit: data.deposit === '' ? null : Number(data.deposit),
        due_day: Number(data.due_day) || 5,
        payment_frequency: data.payment_frequency,
        indexation_type: data.indexation_type,
        index_reference: data.index_reference || '',
        last_revision_date: data.last_revision_date || null,
        next_revision_date: data.next_revision_date || null,
        furnished: !!data.furnished,
        notes: data.notes || '',
      };
      if (isEdit) {
        return base44.entities.Lease.update(lease.id, payload);
      }
      return base44.entities.Lease.create(withOwner({
        ...payload,
        property_id: lot?.property_id,
        lot_id: lot?.id,
        migrated_from: 'manual',
      }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leases'] });
      queryClient.invalidateQueries({ queryKey: ['lots'] });
      toast.success(isEdit ? 'Bail mis à jour' : 'Bail créé');
      onClose();
    },
    onError: (e) => toast.error('Erreur : ' + (e?.message || e)),
  });

  const handleSave = () => {
    const errs = {};
    if (!data.date_start) errs.date_start = "Date d'effet obligatoire";
    if (!data.tenants.some(t => t.name && t.name.trim())) errs.tenants = 'Au moins un locataire';
    if (data.date_end && data.date_end < data.date_start) errs.date_end = 'Fin avant début';
    if (data.tenants.some(t => t.exit_date && t.entry_date && t.exit_date < t.entry_date)) {
      errs.tenants = 'Date de sortie antérieure à l\'entrée pour un locataire';
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast.error('Vérifiez les champs du bail');
      return;
    }
    setErrors({});
    saveMutation.mutate();
  };

  const updateTenant = (i, f, v) => {
    setData(p => {
      const tenants = [...p.tenants];
      tenants[i] = { ...tenants[i], [f]: v };
      return { ...p, tenants };
    });
  };
  const addTenant = () => setData(p => ({ ...p, tenants: [...p.tenants, emptyTenant()] }));
  const removeTenant = (i) => setData(p => ({ ...p, tenants: p.tenants.filter((_, idx) => idx !== i) }));

  const computed = computeLeaseStatus({ date_start: data.date_start, date_end: data.date_end, status: data.status });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{isEdit ? `Bail ${statusLabel(data.status)}` : 'Nouveau bail'}</h4>
        <Badge className={data.status === 'actif' ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}>
          Statut calculé : {statusLabel(computed)}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Type de bail</Label>
          <Select value={data.lease_type} onValueChange={v => update('lease_type', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{LEASE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Date d'effet *</Label>
          <Input type="date" value={data.date_start} onChange={e => update('date_start', e.target.value)} className={errors.date_start ? 'border-destructive' : ''} />
          {errors.date_start && <p className="text-xs text-destructive mt-1">{errors.date_start}</p>}
        </div>
        <div>
          <Label className="text-xs">Date de fin</Label>
          <Input type="date" value={data.date_end} onChange={e => update('date_end', e.target.value)} className={errors.date_end ? 'border-destructive' : ''} />
          {errors.date_end && <p className="text-xs text-destructive mt-1">{errors.date_end}</p>}
        </div>
        <div>
          <Label className="text-xs">Fréquence de paiement</Label>
          <Select value={data.payment_frequency} onValueChange={v => update('payment_frequency', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PAYMENT_FREQUENCIES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <h4 className="text-xs font-semibold mb-3 text-muted-foreground">CONDITIONS FINANCIÈRES</h4>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label className="text-xs">Loyer HC €</Label>
            <Input type="number" min="0" value={data.rent_excluding_charges} onChange={e => update('rent_excluding_charges', e.target.value)} placeholder="€" />
          </div>
          <div>
            <Label className="text-xs">Charges €</Label>
            <Input type="number" min="0" value={data.charges} onChange={e => update('charges', e.target.value)} placeholder="0 €" />
          </div>
          <div>
            <Label className="text-xs">Caution €</Label>
            <Input type="number" min="0" value={data.deposit} onChange={e => update('deposit', e.target.value)} placeholder="€" />
          </div>
          <div>
            <Label className="text-xs">Jour d'échéance</Label>
            <Input type="number" min="1" max="31" value={data.due_day} onChange={e => update('due_day', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Indexation</Label>
            <Select value={data.indexation_type} onValueChange={v => update('indexation_type', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{INDEXATION_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Référence d'index</Label>
            <Input value={data.index_reference} onChange={e => update('index_reference', e.target.value)} placeholder="ex: IRL T1 2024" />
          </div>
          <div>
            <Label className="text-xs">Dernière révision</Label>
            <Input type="date" value={data.last_revision_date} onChange={e => update('last_revision_date', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Prochaine révision</Label>
            <Input type="date" value={data.next_revision_date} onChange={e => update('next_revision_date', e.target.value)} />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={data.furnished} onChange={e => update('furnished', e.target.checked)} />
              Bail meublé
            </label>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-muted-foreground">LOCATAIRES {data.tenants.length > 1 && <span className="text-blue-600">(colocation)</span>}</h4>
          <Button size="sm" variant="outline" onClick={addTenant} className="h-7 gap-1 text-xs">
            <Plus className="w-3 h-3" />Ajouter un colocataire
          </Button>
        </div>
        {errors.tenants && <p className="text-xs text-destructive mb-2">{errors.tenants}</p>}
        <div className="space-y-2">
          {data.tenants.map((t, i) => (
            <div key={i} className="rounded-md border border-border p-2 space-y-2">
              <div className="flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <Input className="h-8 text-sm" value={t.name} onChange={e => updateTenant(i, 'name', e.target.value)} placeholder="Prénom(s) Nom" />
                {data.tenants.length > 1 && (
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeTenant(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Input type="date" className="h-7 text-xs" value={t.entry_date || ''} onChange={e => updateTenant(i, 'entry_date', e.target.value)} title="Entrée" />
                <Input type="date" className="h-7 text-xs" value={t.exit_date || ''} onChange={e => updateTenant(i, 'exit_date', e.target.value)} title="Sortie" />
                <Input className="h-7 text-xs" value={t.email || ''} onChange={e => updateTenant(i, 'email', e.target.value)} placeholder="email" />
                <Input className="h-7 text-xs" value={t.phone || ''} onChange={e => updateTenant(i, 'phone', e.target.value)} placeholder="tél" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-xs">Notes / clauses particulières</Label>
        <Input value={data.notes || ''} onChange={e => update('notes', e.target.value)} placeholder="Clauses, dérogations…" />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="outline" onClick={onClose}>Annuler</Button>
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer le bail'}
        </Button>
      </div>
    </div>
  );
}