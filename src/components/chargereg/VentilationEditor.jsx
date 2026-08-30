import React from 'react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { RECOVERABLE_CATEGORIES } from '@/lib/chargeRegularization';

export default function VentilationEditor({ lines, onChange }) {
  const addLine = () => {
    const cat = RECOVERABLE_CATEGORIES[0];
    onChange([...lines, { category: cat.key, category_label: cat.label, amount: 0, note: '' }]);
  };
  const update = (i, patch) => {
    const next = lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
    onChange(next);
  };
  const remove = (i) => onChange(lines.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      {lines.length === 0 && (
        <p className="text-xs text-muted-foreground italic">Aucune charge récupérable saisie pour le moment.</p>
      )}
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-12 sm:col-span-5">
            <Select value={l.category} onValueChange={(v) => {
              const c = RECOVERABLE_CATEGORIES.find((x) => x.key === v);
              update(i, { category: v, category_label: c?.label || v });
            }}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECOVERABLE_CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-7 sm:col-span-3">
            <Input type="number" step="0.01" value={l.amount} onChange={(e) => update(i, { amount: e.target.value })}
              placeholder="Montant €" className="h-8" />
          </div>
          <div className="col-span-9 sm:col-span-3">
            <Input value={l.note || ''} onChange={(e) => update(i, { note: e.target.value })}
              placeholder="Note" className="h-8" />
          </div>
          <div className="col-span-2 sm:col-span-1 flex justify-end">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(i)}>
              <Trash2 className="w-4 h-4 text-rose-500" />
            </Button>
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-3.5 h-3.5 mr-1" />Ajouter une charge récupérable</Button>
    </div>
  );
}