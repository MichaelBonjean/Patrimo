import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Euro, Home } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { toast } from 'sonner';

const REVENUE_CATEGORIES = ['Loyer', 'Charges locataire', 'CAF', 'Autres revenus'];

function RevenueForm({ revenue, lot, onClose }) {
  const [data, setData] = useState(revenue || {
    lot_id: lot.id,
    category: 'Loyer',
    monthly_amount: '',
    label: '',
  });
  const update = (f, v) => setData(prev => ({ ...prev, [f]: v }));

  // We persist revenue info directly on the lot as a JSON array
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const existing = lot.revenues || [];
      let updated;
      if (revenue?.id) {
        updated = existing.map(r => r.id === revenue.id ? { ...data } : r);
      } else {
        updated = [...existing, { ...data, id: Date.now().toString() }];
      }
      return base44.entities.Lot.update(lot.id, { revenues: updated });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lots'] });
      toast.success(revenue ? 'Revenu mis à jour' : 'Revenu ajouté');
      onClose();
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Catégorie</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
            value={data.category || 'Loyer'}
            onChange={e => update('category', e.target.value)}
          >
            {REVENUE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-xs">Montant mensuel (€)</Label>
          <Input
            type="number"
            value={data.monthly_amount || ''}
            onChange={e => update('monthly_amount', Number(e.target.value))}
            placeholder="0"
          />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Libellé / note (optionnel)</Label>
          <Input
            value={data.label || ''}
            onChange={e => update('label', e.target.value)}
            placeholder="ex: Loyer CC, CAF mensuel..."
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>Annuler</Button>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  );
}

function LotRevenueBlock({ lot }) {
  const [showForm, setShowForm] = useState(false);
  const [editingRevenue, setEditingRevenue] = useState(null);
  const queryClient = useQueryClient();
  const revenues = lot.revenues || [];

  const deleteMutation = useMutation({
    mutationFn: async (revId) => {
      const updated = revenues.filter(r => r.id !== revId);
      return base44.entities.Lot.update(lot.id, { revenues: updated });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lots'] });
      toast.success('Revenu supprimé');
    },
  });

  const total = revenues.reduce((s, r) => s + (Number(r.monthly_amount) || 0), 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Lot header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
        <div className="flex items-center gap-2">
          <Home className="w-4 h-4 text-primary" />
          <span className="font-medium text-sm">{lot.designation}</span>
          {lot.typology && <Badge variant="secondary" className="text-xs">{lot.typology}</Badge>}
          {lot.tenant_name && (
            <span className="text-xs text-muted-foreground">— {lot.tenant_name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <span className="text-sm font-semibold text-emerald-600">{formatCurrency(total)}/mois</span>
          )}
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => { setEditingRevenue(null); setShowForm(true); }}>
            <Plus className="w-3 h-3" /> Ajouter
          </Button>
        </div>
      </div>

      {/* Revenue lines */}
      {revenues.length > 0 ? (
        <div className="divide-y divide-border">
          {revenues.map(rev => (
            <div key={rev.id} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-3">
                <Euro className="w-3.5 h-3.5 text-muted-foreground" />
                <div>
                  <span className="text-sm">{rev.category}</span>
                  {rev.label && <span className="text-xs text-muted-foreground ml-2">— {rev.label}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-emerald-600">{formatCurrency(Number(rev.monthly_amount) || 0)}</span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingRevenue(rev); setShowForm(true); }}>
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(rev.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-3 text-xs text-muted-foreground italic">Aucun revenu régulier enregistré</div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRevenue ? 'Modifier le revenu' : `Ajouter un revenu — ${lot.designation}`}</DialogTitle>
          </DialogHeader>
          <RevenueForm
            revenue={editingRevenue}
            lot={lot}
            onClose={() => { setShowForm(false); setEditingRevenue(null); }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LotsRevenue({ lots }) {
  const totalMonthly = lots.reduce((s, lot) => {
    const revs = lot.revenues || [];
    return s + revs.reduce((ls, r) => ls + (Number(r.monthly_amount) || 0), 0);
  }, 0);

  if (lots.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Revenus réguliers par lot</h3>
        {totalMonthly > 0 && (
          <span className="text-sm font-bold text-emerald-600">Total : {formatCurrency(totalMonthly)}/mois</span>
        )}
      </div>
      <div className="space-y-2">
        {lots.map(lot => (
          <LotRevenueBlock key={lot.id} lot={lot} />
        ))}
      </div>
    </div>
  );
}