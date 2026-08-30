import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Check, X, ChevronDown, ChevronUp, Sparkles, Loader2, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateFR } from '@/lib/formatters';
import MappingStep from '@/components/import/MappingStep';
import { TRANSACTION_CATEGORIES, labelOf } from '@/lib/financeCategories';
import { STATUS, STATUS_LABELS } from '@/lib/import/pipeline';

const CATEGORIES = TRANSACTION_CATEGORIES.map((c) => c.value);

const STATUS_BADGE = {
  [STATUS.IMPORTED]: 'bg-slate-100 text-slate-600 border-0',
  [STATUS.CATEGORIZED]: 'bg-emerald-100 text-emerald-700 border-0',
  [STATUS.TO_VERIFY]: 'bg-amber-100 text-amber-700 border-0',
  [STATUS.DUPLICATE]: 'bg-blue-100 text-blue-700 border-0',
  [STATUS.REJECTED]: 'bg-red-100 text-red-700 border-0',
};

const TAB_ORDER = [STATUS.IMPORTED, STATUS.CATEGORIZED, STATUS.TO_VERIFY, STATUS.DUPLICATE, STATUS.REJECTED];

export default function PreviewTable({ rows, onChange, onAICategorize, onCommit, aiRunning, committing, properties, lots }) {
  const [active, setActive] = useState(STATUS.IMPORTED);
  const [openRow, setOpenRow] = useState(null);

  const counts = TAB_ORDER.reduce((acc, s) => { acc[s] = rows.filter((r) => r.status === s).length; return acc; }, {});
  const visible = rows.filter((r) => r.status === active);
  const commitReady = rows.filter((r) => r.status === STATUS.CATEGORIZED && r.include && r.property_id && r.category).length;

  const patch = (row, p) => onChange(rows.map((r) => (r.row_id === row.row_id ? { ...r, ...p } : r)));
  const setStatus = (row, status) => patch(row, { status });
  const toggleInclude = (row) => patch(row, { include: !row.include });

  const acceptAll = () => onChange(rows.map((r) => {
    if (r.status !== STATUS.IMPORTED && r.status !== STATUS.TO_VERIFY) return r;
    // Les doublons probables restent à valider manuellement — jamais auto-acceptés.
    if (r.duplicate_level === 'probable') return r;
    return { ...r, status: r.category && r.property_id ? STATUS.CATEGORIZED : STATUS.TO_VERIFY };
  }));

  return (
    <div className="space-y-4">
      {/* Onglets d'aperçu par statut */}
      <div className="flex flex-wrap gap-1.5">
        {TAB_ORDER.map((s) => (
          <button key={s}
            className={cn('flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs font-medium border transition-colors',
              active === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-muted/40')}
            onClick={() => setActive(s)}>
            {STATUS_LABELS[s]}
            {counts[s] > 0 && <Badge className={cn('text-[10px] h-4 px-1.5', active === s ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground')}>{counts[s]}</Badge>}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={aiRunning} onClick={onAICategorize}>
            {aiRunning ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1" />}
            Analyser l'IA
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={acceptAll}>
            <Check className="w-3.5 h-3.5 mr-1" /> Tout catégoriser
          </Button>
        </div>
      </div>

      {/* Légende des statuts */}
      <p className="text-xs text-muted-foreground">
        Importé : ligne brute non traitée · Catégorisé : règle déterministe ou IA fiable, prête à valider · À vérifier : IA insuffisante ou doublon probable à valider · Doublon : déjà importé (exact — non recréé au réimport) · Rejeté : écarté.
      </p>

      {/* Tableau */}
      <div className="max-h-[460px] overflow-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0">
            <tr className="bg-muted/40 border-b border-border">
              <th className="w-8 px-2 py-2"></th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Description</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Montant</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Affectation</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Statut</th>
              <th className="w-20 px-2 py-2"></th>
              <th className="w-8 px-2"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Aucune ligne « {STATUS_LABELS[active].toLowerCase()} ».</td></tr>
            )}
            {visible.map((r) => {
              const open = openRow === r.row_id;
              const propName = properties.find((p) => p.id === r.property_id)?.name;
              return (
                <React.Fragment key={r.row_id}>
                  <tr className={cn('border-b border-border/50', !r.include && 'opacity-40', open && 'bg-muted/20')}>
                    <td className="px-2 py-2 text-center"><input type="checkbox" checked={!!r.include} onChange={() => toggleInclude(r)} className="rounded" /></td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.raw_date ? formatDateFR(r.raw_date) : `${String(r.month).padStart(2, '0')}/${r.year}`}</td>
                    <td className="px-3 py-2"><span className="truncate max-w-[220px] inline-block align-bottom">{r.description}</span>{r.reason && <span className="block text-[10px] text-muted-foreground italic">{r.reason}</span>}</td>
                    <td className={cn('px-3 py-2 text-right number-fr font-medium', r.type === 'income' ? 'text-emerald-600' : 'text-red-500')}>{formatCurrency(Math.abs(r.amount))}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 flex-wrap">
                        {r.category && <Badge variant="secondary" className="text-[10px]">{labelOf(r.category)}</Badge>}
                        {propName && <span className="text-[10px] text-muted-foreground">{propName}</span>}
                        {!r.category && <span className="text-[10px] text-amber-600">à affecter</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 flex-wrap">
                        <Badge className={cn('text-[10px]', STATUS_BADGE[r.status])}>{STATUS_LABELS[r.status]}</Badge>
                        {r.duplicate_level === 'exact' && <Badge variant="outline" className="text-[10px] border-blue-400 text-blue-700">doublon exact</Badge>}
                        {r.duplicate_level === 'probable' && <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700">doublon probable</Badge>}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <button title="Catégoriser" className={cn('w-6 h-6 rounded-full border flex items-center justify-center', r.status === STATUS.CATEGORIZED ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-border hover:border-emerald-400')} onClick={() => setStatus(r, r.category && r.property_id ? STATUS.CATEGORIZED : STATUS.TO_VERIFY)}><Check className="w-3 h-3" /></button>
                        <button title="Rejeter" className={cn('w-6 h-6 rounded-full border flex items-center justify-center', r.status === STATUS.REJECTED ? 'border-red-500 bg-red-500 text-white' : 'border-border hover:border-red-400')} onClick={() => setStatus(r, STATUS.REJECTED)}><X className="w-3 h-3" /></button>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <button className="text-muted-foreground hover:text-foreground" onClick={() => setOpenRow(open ? null : r.row_id)}>
                        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-border/50 bg-muted/10">
                      <td colSpan={8} className="px-4 py-3">
                        <MappingStep value={{ propertyId: r.property_id, lotId: r.lot_id, category: r.category, type: r.type, month: r.month, year: r.year }}
                          onChange={(v) => patch(r, { property_id: v.propertyId, lot_id: v.lotId, category: v.category, type: v.type, month: v.month, year: v.year })}
                          properties={properties} lots={lots} categories={CATEGORIES} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Commit */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <p className="text-xs text-muted-foreground">{rows.length} ligne(s) · {commitReady} à valider</p>
        <Button size="sm" disabled={committing || commitReady === 0} onClick={onCommit}>
          {committing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
          Valider {commitReady} transaction{commitReady > 1 ? 's' : ''}
        </Button>
      </div>
    </div>
  );
}