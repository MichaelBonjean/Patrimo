import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { labelOf } from '@/lib/financeCategories';

const NONE = 'none';

/**
 * Shared mapping control for one import row: property, lot, category,
 * month/year, type. Fully controlled via `value` / `onChange`.
 */
export default function MappingStep({ value, onChange, properties, lots, categories, options = {} }) {
  const { showMonthYear = true, showType = true } = options;
  const propLots = lots.filter(l => l.property_id === value.propertyId);
  const setLotId = (v) => onChange({ ...value, lotId: v === NONE ? '' : v });

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      <div>
        <Label className="text-[10px] text-muted-foreground">Bien *</Label>
        <Select value={value.propertyId || ''} onValueChange={v => onChange({ ...value, propertyId: v, lotId: '' })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Bien" /></SelectTrigger>
          <SelectContent>
            {properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">Lot</Label>
        <Select value={value.lotId || NONE} onValueChange={setLotId} disabled={!value.propertyId}>
          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Lot" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Aucun</SelectItem>
            {propLots.map(l => <SelectItem key={l.id} value={l.id}>{l.designation} {l.tenant_name ? `(${l.tenant_name})` : ''}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">Catégorie *</Label>
        <Select value={value.category || ''} onValueChange={v => onChange({ ...value, category: v })}>
          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Catégorie" /></SelectTrigger>
          <SelectContent>
            {categories.map(c => <SelectItem key={c} value={c}>{labelOf(c)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {showMonthYear && (
        <>
          <div>
            <Label className="text-[10px] text-muted-foreground">Mois</Label>
            <Select value={String(value.month || '')} onValueChange={v => onChange({ ...value, month: Number(v) })}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => <SelectItem key={m} value={String(m)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Année</Label>
            <Input type="number" className="h-7 text-xs" value={value.year ?? ''}
              onChange={e => onChange({ ...value, year: Number(e.target.value) || new Date().getFullYear() })} />
          </div>
        </>
      )}
      {showType && (
        <div>
          <Label className="text-[10px] text-muted-foreground">Type</Label>
          <Select value={value.type || 'income'} onValueChange={v => onChange({ ...value, type: v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="income">Entrée</SelectItem>
              <SelectItem value="expense">Sortie</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}