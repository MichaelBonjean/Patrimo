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
 * Formulaire minimal pour créer un premier bien très vite,
 * afin que le dashboard commence à afficher de la valeur.
 */
export default function QuickPropertyForm({ ownerEmail, onCreated }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', category: 'Appartement', city: '', purchase_price: '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const valid = form.name.trim();

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const rec = await base44.entities.Property.create({
        owner_id: ownerEmail,
        name: form.name.trim(),
        category: form.category,
        holding_structure: 'En propre',
        tax_regime: 'Location nue (revenus fonciers)',
        city: form.city.trim() || undefined,
        purchase_price: form.purchase_price ? Number(form.purchase_price) : undefined,
      });
      await qc.invalidateQueries();
      logAudit({ action: 'create', entity_type: 'Property', entity_id: rec.id, entity_label: rec.name, details: { source: 'onboarding' } });
      toast.success('Bien créé — votre patrimoine est initialisé');
      onCreated?.(rec);
    } catch (e) {
      toast.error(e?.message || 'Création échouée');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <Label className="text-xs text-muted-foreground">Nom du bien *</Label>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex: Appartement rue Lafayette" className="h-9" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Catégorie</Label>
          <Select value={form.category} onValueChange={(v) => set('category', v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['Appartement', 'Maison', 'Immeuble', 'Local commercial', 'Bureau', 'Parking', 'Garage', 'SCPI'].map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Ville</Label>
          <Input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Paris" className="h-9" />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs text-muted-foreground">Prix d'achat (optionnel)</Label>
          <Input type="number" value={form.purchase_price} onChange={(e) => set('purchase_price', e.target.value)} placeholder="250000" className="h-9 number-fr" />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={submit} disabled={!valid || saving} className="gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Créer mon patrimoine
        </Button>
      </div>
    </div>
  );
}