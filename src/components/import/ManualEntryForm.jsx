import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { TRANSACTION_CATEGORIES, labelOf } from '@/lib/financeCategories';

const ALL_CATEGORIES = TRANSACTION_CATEGORIES.map(c => c.value);

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

function validateManualEntry(form) {
  const errors = {};
  if (!form.property_id) errors.property_id = 'Le bien est obligatoire';
  if (!form.category) errors.category = 'La catégorie est obligatoire';
  if (!form.amount || Number(form.amount) <= 0) errors.amount = 'Le montant doit être > 0';
  if (!form.date) {
    errors.date = 'La date est obligatoire';
  } else {
    const d = new Date(form.date);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    if (y < 2000 || y > 2030) errors.date = 'L\'année doit être entre 2000 et 2030';
    else if (m < 1 || m > 12) errors.date = 'Le mois est invalide';
  }
  return errors;
}

export default function ManualEntryForm({ properties, lots, onClose }) {
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const [formErrors, setFormErrors] = useState({});
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: '',
    amount: '',
    type: 'income',
    property_id: '',
    lot_id: '',
    category: '',
  });

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setFormErrors(p => ({ ...p, [k]: undefined })); };
  const propLots = lots.filter(l => l.property_id === form.property_id);

  const createTransactionMutation = useMutation({
    mutationFn: async (data) => {
      // Also create a BankImport record for traceability
      const bi = await base44.entities.BankImport.create(withOwner({
        import_date: data.date,
        description: data.description,
        amount: data.type === 'income' ? Math.abs(data.amount) : -Math.abs(data.amount),
        status: 'categorized',
        assigned_property_id: data.property_id,
        assigned_lot_id: data.lot_id || '',
        assigned_category: data.category,
        batch_id: 'manual-' + new Date().toISOString(),
      }));
      const d = new Date(data.date);
      await base44.entities.Transaction.create(withOwner({
        property_id: data.property_id,
        lot_id: data.lot_id || undefined,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        category: data.category,
        category_label: labelOf(data.category),
        amount: Math.abs(Number(data.amount)),
        type: data.type,
        note: data.description,
        bank_import_id: bi.id,
      }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-imports'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      toast.success('Opération enregistrée');
      onClose();
    },
  });

  const handleSubmit = () => {
    const errs = validateManualEntry(form);
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      toast.error('Veuillez corriger les champs en erreur');
      return;
    }
    setFormErrors({});
    createTransactionMutation.mutate(form);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold">Saisie manuelle</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Date *</Label>
          <Input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={formErrors.date ? 'border-destructive' : ''} />
          {formErrors.date && <p className="text-xs text-destructive mt-1">{formErrors.date}</p>}
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Type *</Label>
          <Select value={form.type} onValueChange={v => set('type', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="income">Entrée (+)</SelectItem>
              <SelectItem value="expense">Sortie (-)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Montant * (€)</Label>
          <Input type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00"
            className={cn("number-fr", formErrors.amount ? 'border-destructive' : form.type === 'income' ? 'border-emerald-400' : 'border-red-400')} />
          {formErrors.amount && <p className="text-xs text-destructive mt-1">{formErrors.amount}</p>}
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Bien *</Label>
          <Select value={form.property_id} onValueChange={v => { set('property_id', v); set('lot_id', ''); }}>
            <SelectTrigger className={formErrors.property_id ? 'border-destructive' : ''}><SelectValue placeholder="Choisir..." /></SelectTrigger>
            <SelectContent>{properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          {formErrors.property_id && <p className="text-xs text-destructive mt-1">{formErrors.property_id}</p>}
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Lot (optionnel)</Label>
          <Select value={form.lot_id} onValueChange={v => set('lot_id', v)} disabled={!form.property_id}>
            <SelectTrigger><SelectValue placeholder="Tous les lots" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>Tous les lots</SelectItem>
              {propLots.map(l => <SelectItem key={l.id} value={l.id}>{l.designation} {l.tenant_name ? `(${l.tenant_name})` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Catégorie *</Label>
          <Select value={form.category} onValueChange={v => set('category', v)}>
            <SelectTrigger className={formErrors.category ? 'border-destructive' : ''}><SelectValue placeholder="Catégorie..." /></SelectTrigger>
            <SelectContent>{ALL_CATEGORIES.map(c => <SelectItem key={c} value={c}>{labelOf(c)}</SelectItem>)}</SelectContent>
          </Select>
          {formErrors.category && <p className="text-xs text-destructive mt-1">{formErrors.category}</p>}
        </div>
        <div className="col-span-2 md:col-span-3">
          <Label className="text-xs text-muted-foreground mb-1 block">Description / Libellé</Label>
          <Input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Ex: Loyer janvier 2025 – M. Dupont" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
        <Button size="sm" onClick={handleSubmit} disabled={createTransactionMutation.isPending}>Enregistrer</Button>
      </div>
    </div>
  );
}