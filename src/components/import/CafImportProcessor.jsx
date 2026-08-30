import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Check, AlertCircle } from 'lucide-react';
import { formatCurrency, formatDateFR } from '@/lib/formatters';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
// Helpers canoniques (parser RFC 4180 + validateurs) — jamais de split artisanal.
import { guessMonthYear } from '@/lib/import/csvUtils';

export default function CafImportProcessor({ records, lots, properties, onDone }) {
  const queryClient = useQueryClient();
  // Match each record to a lot by beneficiary name similarity
  const [assignments, setAssignments] = useState(() =>
    records.map(r => {
      // Try fuzzy match on tenant name
      const nameLower = r.beneficiary.toLowerCase();
      const matchedLot = lots.find(l => l.tenant_name && nameLower.includes(l.tenant_name.toLowerCase().split(' ')[0].toLowerCase()));
      const matchedProp = matchedLot ? properties.find(p => p.id === matchedLot.property_id) : null;
      const { month, year } = guessMonthYear(r.period, r.import_date);
      return {
        ...r,
        lot_id: matchedLot?.id || '',
        property_id: matchedProp?.id || '',
        month, year,
        confirmed: false,
      };
    })
  );

  const setAssign = (i, key, val) => setAssignments(prev => prev.map((a, idx) => idx === i ? { ...a, [key]: val, confirmed: false } : a));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const toSave = assignments.filter(a => a.property_id && a.lot_id);
      for (const a of toSave) {
        const bi = await base44.entities.BankImport.create({
          import_date: a.import_date,
          description: `CAF – ${a.beneficiary}`,
          amount: a.amount,
          status: 'categorized',
          assigned_property_id: a.property_id,
          assigned_lot_id: a.lot_id,
          assigned_category: 'CAF',
          batch_id: 'caf-' + new Date().toISOString(),
        });
        await base44.entities.Transaction.create({
          property_id: a.property_id,
          lot_id: a.lot_id,
          year: a.year,
          month: a.month,
          category: 'CAF',
          amount: a.amount,
          type: 'income',
          note: `CAF – ${a.beneficiary}`,
          bank_import_id: bi.id,
        });
      }
      return toSave.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['bank-imports'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      toast.success(`${count} versements CAF importés`);
      onDone();
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {assignments.length} ligne(s) CAF détectée(s). Vérifiez l'affectation par locataire et validez.
      </div>
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-3 py-2 text-muted-foreground">Date</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Bénéficiaire</th>
              <th className="text-right px-3 py-2 text-muted-foreground">Montant</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Bien</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Lot / Locataire</th>
              <th className="text-left px-3 py-2 text-muted-foreground">Mois/An</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a, i) => {
              const propLots = lots.filter(l => l.property_id === a.property_id);
              return (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-1.5">{formatDateFR(a.import_date)}</td>
                  <td className="px-3 py-1.5 font-medium">{a.beneficiary}</td>
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
                      <SelectContent>{propLots.map(l => <SelectItem key={l.id} value={l.id}>{l.designation} – {l.tenant_name || 'Vacant'}</SelectItem>)}</SelectContent>
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
          Valider {assignments.filter(a => a.property_id && a.lot_id).length} versement(s) CAF
        </Button>
      </div>
    </div>
  );
}