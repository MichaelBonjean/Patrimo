import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Check, AlertCircle } from 'lucide-react';
import { formatCurrency, formatDateFR } from '@/lib/formatters';
import { toast } from 'sonner';

// Detect if a bank line looks like a rent payment
function detectRentLine(description, amount, lots) {
  const desc = description.toLowerCase();
  const rentKeywords = ['loyer', 'location', 'quittance', 'bail', 'mois', 'virement locataire'];
  const isRentLike = rentKeywords.some(k => desc.includes(k)) || (amount > 200 && amount < 5000);
  if (!isRentLike) return null;

  // Try to match a tenant
  for (const lot of lots) {
    if (!lot.tenant_name) continue;
    const names = lot.tenant_name.toLowerCase().split(/\s+/);
    if (names.some(n => n.length > 2 && desc.includes(n))) {
      return lot;
    }
  }
  return isRentLike ? 'unknown' : null;
}

// Helper canonique (plus de duplication locale).
import { guessMonthYear } from '@/lib/import/csvUtils';

export default function RentAnalysisProcessor({ records, lots, properties, onDone }) {
  const queryClient = useQueryClient();

  const [assignments, setAssignments] = useState(() =>
    records
      .filter(r => r.amount > 0) // only income
      .map(r => {
        const matched = detectRentLine(r.description, r.amount, lots);
        const matchedLot = matched && matched !== 'unknown' ? matched : null;
        const matchedProp = matchedLot ? properties.find(p => p.id === matchedLot.property_id) : null;
        const { month, year } = guessMonthYear(r.import_date);
        return {
          ...r,
          lot_id: matchedLot?.id || '',
          property_id: matchedProp?.id || '',
          month, year,
          isRentLike: !!matched,
          include: !!matched,
        };
      })
      .filter(r => r.isRentLike)
  );

  const setAssign = (i, key, val) => setAssignments(prev => prev.map((a, idx) => idx === i ? { ...a, [key]: val } : a));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const toSave = assignments.filter(a => a.include && a.property_id);
      for (const a of toSave) {
        const bi = await base44.entities.BankImport.create({
          import_date: a.import_date,
          description: a.description,
          amount: a.amount,
          status: 'categorized',
          assigned_property_id: a.property_id,
          assigned_lot_id: a.lot_id || '',
          assigned_category: 'Loyer',
          batch_id: 'rent-analysis-' + new Date().toISOString(),
        });
        await base44.entities.Transaction.create({
          property_id: a.property_id,
          lot_id: a.lot_id || undefined,
          year: a.year,
          month: a.month,
          category: 'Loyer',
          amount: a.amount,
          type: 'income',
          note: a.description,
          bank_import_id: bi.id,
        });
      }
      return toSave.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['bank-imports'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      toast.success(`${count} loyer(s) enregistré(s)`);
      onDone();
    },
  });

  if (assignments.length === 0) {
    return (
      <div className="p-6 text-center text-muted-foreground text-sm border border-dashed border-border rounded-xl">
        Aucune ligne ressemblant à un loyer détectée dans ce fichier (montants positifs avec mots-clés loyer/virement).
        <div className="mt-2"><Button variant="outline" size="sm" onClick={onDone}>Fermer</Button></div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {assignments.length} ligne(s) potentiellement des loyers. Vérifiez et cochez celles à importer.
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="px-3 py-2"></th>
              <th className="text-left px-3 py-2 text-muted-foreground">Date</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Description</th>
              <th className="text-right px-3 py-2 text-muted-foreground">Montant</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Bien</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Lot / Locataire</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Mois / An</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a, i) => {
              const propLots = lots.filter(l => l.property_id === a.property_id);
              return (
                <tr key={i} className={`border-b border-border/50 ${!a.include ? 'opacity-50' : 'hover:bg-muted/30'}`}>
                  <td className="px-3 py-1.5 text-center">
                    <input type="checkbox" checked={a.include} onChange={e => setAssign(i, 'include', e.target.checked)} className="rounded" />
                  </td>
                  <td className="px-3 py-1.5">{formatDateFR(a.import_date)}</td>
                  <td className="px-3 py-1.5 max-w-xs truncate" title={a.description}>{a.description}</td>
                  <td className="px-3 py-1.5 text-right text-emerald-600 number-fr font-semibold">{formatCurrency(a.amount)}</td>
                  <td className="px-3 py-1.5">
                    <Select value={a.property_id} onValueChange={v => { setAssign(i, 'property_id', v); setAssign(i, 'lot_id', ''); }}>
                      <SelectTrigger className="h-6 text-xs w-32"><SelectValue placeholder="Bien" /></SelectTrigger>
                      <SelectContent>{properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-1.5">
                    <Select value={a.lot_id} onValueChange={v => setAssign(i, 'lot_id', v)} disabled={!a.property_id}>
                      <SelectTrigger className="h-6 text-xs w-36"><SelectValue placeholder="Lot..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={null}>Non spécifié</SelectItem>
                        {propLots.map(l => <SelectItem key={l.id} value={l.id}>{l.designation} – {l.tenant_name || 'Vacant'}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-1">
                      <input type="number" min="1" max="12" value={a.month} onChange={e => setAssign(i, 'month', Number(e.target.value))}
                        className="w-10 h-6 rounded border border-border bg-transparent px-1 text-xs" />
                      <input type="number" min="2000" max="2100" value={a.year} onChange={e => setAssign(i, 'year', Number(e.target.value))}
                        className="w-16 h-6 rounded border border-border bg-transparent px-1 text-xs" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone}>Annuler</Button>
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Check className="w-3.5 h-3.5 mr-1" />
          Valider {assignments.filter(a => a.include && a.property_id).length} loyer(s)
        </Button>
      </div>
    </div>
  );
}