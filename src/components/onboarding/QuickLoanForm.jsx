import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { logAudit } from '@/lib/patrimony';

/**
 * Renseigne rapidement les conditions d'un prêt sur un bien existant.
 */
export default function QuickLoanForm({ properties, ownerEmail, onSaved }) {
  const qc = useQueryClient();
  const [propertyId, setPropertyId] = useState(properties[0]?.id || '');
  const [form, setForm] = useState({ loan_amount: '', loan_rate: '', loan_duration_years: '', loan_start_date: '', monthly_insurance: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const valid = propertyId && form.loan_amount && form.loan_rate && form.loan_duration_years;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const patch = {
        loan_amount: Number(form.loan_amount),
        loan_rate: Number(form.loan_rate),
        loan_duration_years: Number(form.loan_duration_years),
        loan_start_date: form.loan_start_date || undefined,
        monthly_insurance: form.monthly_insurance ? Number(form.monthly_insurance) : undefined,
      };
      const rec = await base44.entities.Property.update(propertyId, patch);
      await qc.invalidateQueries();
      const label = properties.find((p) => p.id === propertyId)?.name || 'Bien';
      logAudit({ action: 'update', entity_type: 'Property', entity_id: propertyId, entity_label: label, details: { section: 'loan', ...patch } });
      toast.success('Prêt enregistré');
      onSaved?.(rec);
    } catch (e) {
      toast.error(e?.message || 'Enregistrement échoué');
    } finally {
      setSaving(false);
    }
  };

  if (!properties.length) {
    return <p className="text-sm text-muted-foreground">Ajoutez d'abord un bien pour y associer un prêt.</p>;
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-muted-foreground">Bien concerné</Label>
        <Select value={propertyId} onValueChange={setPropertyId}>
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Montant emprunté (€) *</Label>
          <Input type="number" value={form.loan_amount} onChange={(e) => set('loan_amount', e.target.value)} placeholder="180000" className="h-9 number-fr" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Taux annuel (%) *</Label>
          <Input type="number" step="0.01" value={form.loan_rate} onChange={(e) => set('loan_rate', e.target.value)} placeholder="3.20" className="h-9 number-fr" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Durée (années) *</Label>
          <Input type="number" value={form.loan_duration_years} onChange={(e) => set('loan_duration_years', e.target.value)} placeholder="20" className="h-9 number-fr" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Date de début</Label>
          <Input type="date" value={form.loan_start_date} onChange={(e) => set('loan_start_date', e.target.value)} className="h-9" />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs text-muted-foreground">Assurance mensuelle (€)</Label>
          <Input type="number" value={form.monthly_insurance} onChange={(e) => set('monthly_insurance', e.target.value)} placeholder="35" className="h-9 number-fr" />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={submit} disabled={!valid || saving} className="gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Enregistrer le prêt
        </Button>
      </div>
    </div>
  );
}