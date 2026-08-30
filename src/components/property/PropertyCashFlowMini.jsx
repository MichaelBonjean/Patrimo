import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { formatCurrency, formatCurrencyDecimal, getMonthName } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Plus, X, MessageSquare } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { getCurrentTenants } from '@/lib/lease';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';

// Locataires actifs d'un lot pour un mois donné — bail d'abord (source de vérité),
// repli legacy (lot.tenant_name / previous_tenants) pour l'historique non migré.
const leaseActiveTenantNames = (lot, leases, year, month) => {
  const midISO = `${year}-${String(month + 1).padStart(2, '0')}-15`;
  const names = getCurrentTenants(lot.id, leases, midISO).map((t) => t.name);
  if (names.length > 0) return names;
  return getActiveTenantsForMonth(lot, year, month);
};

const NOW_MONTH = new Date().getMonth() + 1;
const NOW_YEAR = new Date().getFullYear();
const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// Normalize string: lowercase, remove punctuation, collapse spaces → array of words
const normalizeWords = (s) =>
  s.toLowerCase().replace(/[,\-\.]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);

// Match a transaction to a lot: either by lot_id or by note matching lot designation
// Uses keyword matching to handle variants like "RDC T4" ↔ "RDC, T4" or "T3 RDC Duplex" ↔ "T3, RDC Duplex F3"
const txMatchesLot = (t, lot) => {
  if (!lot) return false;
  if (t.lot_id) return t.lot_id === lot.id;
  if (!t.note || !lot.designation) return false;
  const noteWords = normalizeWords(t.note);
  const desigWords = normalizeWords(lot.designation);
  if (noteWords.length === 0 || desigWords.length === 0) return false;
  // All note words must appear in designation words (or vice-versa for short notes)
  const noteInDesig = noteWords.every(w => desigWords.includes(w));
  const desigInNote = desigWords.every(w => noteWords.includes(w));
  return noteInDesig || desigInNote;
};

// Get active tenants for a lot on a specific month/year
const getActiveTenantsForMonth = (lot, year, month) => {
  const tenants = [];
  // Add current tenant if in range
  if (lot.tenant_name && lot.tenant_entry_date) {
    const entryDate = new Date(lot.tenant_entry_date);
    const isInRange = (entryDate.getFullYear() < year || 
      (entryDate.getFullYear() === year && entryDate.getMonth() + 1 <= month));
    if (isInRange) tenants.push(lot.tenant_name);
  }
  // Add previous tenants if in range
  if (lot.previous_tenants && Array.isArray(lot.previous_tenants)) {
    for (const pt of lot.previous_tenants) {
      if (pt.name && pt.entry_date && pt.exit_date) {
        const entryDate = new Date(pt.entry_date);
        const exitDate = new Date(pt.exit_date);
        const isInRange = 
          (entryDate.getFullYear() < year || (entryDate.getFullYear() === year && entryDate.getMonth() + 1 <= month)) &&
          (exitDate.getFullYear() > year || (exitDate.getFullYear() === year && exitDate.getMonth() + 1 >= month));
        if (isInRange && !tenants.includes(pt.name)) tenants.push(pt.name);
      }
    }
  }
  return tenants;
};

// Income sub-cols (property level or per lot)
const INCOME_CATS = ['Loyer', 'CAF'];
const INCOME_CATS_LABELS = { 'Loyer': 'Loyer+ch.', 'CAF': 'CAF' };
// Categories shown in the global (exceptional) income group
const GLOBAL_INCOME_CATS = ['Virement interne', 'Autres revenus', 'Remboursement', 'Divers'];

const EXTRA_GLOBAL_INCOME_OPTIONS = ['Caution', 'CAF', 'Autres revenus', 'Virement interne', 'Remboursement', 'Divers', 'Provisions', 'Honoraires', 'TVA', 'CFE', 'Régularisation charges'];

// Default expense columns matching the Excel structure
// (Échéance prêt, Assurance habitation, EDF, Frais SCI, Travaux, Virement interne, Autres charges)
const DEFAULT_EXPENSE = [
  'Échéance prêt',
  'Assurance habitation',
  'Électricité',
  'Frais SCI',
  'Travaux',
  'Virement interne',
  'Autres charges',
];

const EXTRA_EXPENSE_OPTIONS = [
  'Assurance prêt', 'Eau', 'Gaz', 'Internet',
  'Copropriété', 'Taxe foncière', 'PNO', 'Frais gestion', 'Comptable',
  'Notaire', 'Banque', 'Assurance loyers impayés', 'Entretien',
  'Régularisation charges', 'Honoraires', 'CFE', 'TVA', 'Amortissement',
  'Provisions', 'Remboursement', 'Divers',
];

function EditableCell({ value, note, onSave, onSaveNote, color }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteVal, setNoteVal] = useState('');

  const start = () => {
    setVal(value ? String(Math.abs(value)) : '');
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const num = parseFloat(val);
    onSave(isNaN(num) ? null : num);
  };

  const openNote = (e) => {
    e.stopPropagation();
    setNoteVal(note || '');
    setNoteOpen(true);
  };

  const saveNote = () => {
    onSaveNote(noteVal.trim() || null);
    setNoteOpen(false);
  };

  if (editing) {
    return (
      <td className="px-1 py-0.5">
        <Input autoFocus type="number" step="0.01" value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          className="h-6 text-xs text-center number-fr w-full min-w-[60px]" />
      </td>
    );
  }

  return (
    <td className={cn('text-center px-1 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors group/cell relative', color)}
      onDoubleClick={start}>
      <div className="flex items-center justify-center gap-0.5">
        <span className={cn('text-xs number-fr', value ? (color || 'text-foreground') : 'text-muted-foreground/30 select-none')}>
          {value ? formatCurrencyDecimal(Math.abs(value)) : '·'}
        </span>
        <Popover open={noteOpen} onOpenChange={setNoteOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={openNote}
              className={cn(
                'transition-opacity ml-0.5 flex-shrink-0',
                note ? 'opacity-70 hover:opacity-100 text-amber-500' : 'opacity-0 group-hover/cell:opacity-40 hover:!opacity-80 text-muted-foreground'
              )}
              title={note || 'Ajouter un commentaire'}
            >
              <MessageSquare className="w-2.5 h-2.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" side="top">
            <p className="text-xs font-medium mb-2">Commentaire</p>
            <Textarea
              autoFocus
              value={noteVal}
              onChange={e => setNoteVal(e.target.value)}
              placeholder="Ajouter une note..."
              className="text-xs h-20 resize-none"
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) saveNote(); }}
            />
            <div className="flex justify-between items-center mt-2 gap-2">
              <span className="text-[10px] text-muted-foreground">Ctrl+Entrée pour valider</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setNoteOpen(false)}>Annuler</Button>
                <Button size="sm" className="h-6 text-xs px-2" onClick={saveNote}>OK</Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </td>
  );
}

export default function PropertyCashFlowMini({ propertyId, lots }) {
  const [year, setYear] = useState(NOW_YEAR);
  const [extraExpenses, setExtraExpenses] = useState([]);
  const [addingExp, setAddingExp] = useState(false);
  const [extraGlobalIncome, setExtraGlobalIncome] = useState([]);
  const [addingGlobalIncome, setAddingGlobalIncome] = useState(false);
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', propertyId, year],
    queryFn: () => base44.entities.Transaction.filter(withOwner({ property_id: propertyId, year })),
  });
  const { data: leases = [] } = useQuery({
    queryKey: ['leases'],
    queryFn: () => base44.entities.Lease.filter(withOwner()),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Transaction.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions', propertyId] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Transaction.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions', propertyId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Transaction.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions', propertyId] }),
  });

  // All lots shown (including vacant), occupied for tenant label
  const allLots = lots || [];

  // Check if any income tx have no lot_id AND don't match any lot by note
  const hasPropertyLevelIncome = useMemo(() => {
    return transactions.some(
      t => t.type === 'income' && !t.lot_id && !allLots.some(l => txMatchesLot(t, l))
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, allLots]);

  // Auto-detect extra global income categories from existing transactions
  const globalIncomeCats = useMemo(() => {
    const fromTx = [...new Set(transactions.filter(t => t.type === 'income' && !t.lot_id).map(t => t.category))];
    const merged = [...new Set([...GLOBAL_INCOME_CATS, ...extraGlobalIncome, ...fromTx])];
    return merged;
  }, [transactions, extraGlobalIncome]);

  // Auto-detect extra expense categories from existing transactions
  const txExpExtras = useMemo(() => {
    const cats = [...new Set(transactions.filter(t => t.type === 'expense').map(t => t.category))];
    return cats.filter(c => !DEFAULT_EXPENSE.includes(c) && !extraExpenses.includes(c));
  }, [transactions, extraExpenses]);

  const expenseRows = [...DEFAULT_EXPENSE, ...extraExpenses, ...txExpExtras];
  const availableExpOptions = EXTRA_EXPENSE_OPTIONS.filter(c => !expenseRows.includes(c));

  // --- Cell value helpers ---

  // Income: by group id (__global__ = no lot_id, __empty__ = no lot_id, else lot_id match)
  const getIncomeCellVal = (month, category, groupId) => {
    if (groupId === '__global__' || groupId === '__empty__') {
      const txs = transactions.filter(
        t => t.month === month && t.category === category && t.type === 'income' && !t.lot_id
          && !allLots.some(l => txMatchesLot(t, l))
      );
      const total = txs.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
      return total > 0 ? total : null;
    }
    const lot = allLots.find(l => l.id === groupId);
    const txs = transactions.filter(
      t => t.month === month && t.category === category && t.type === 'income' && txMatchesLot(t, lot)
    );
    const total = txs.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    return total > 0 ? total : null;
  };

  // Expense (no lot_id)
  const getExpenseCellVal = (month, category) => {
    const txs = transactions.filter(
      t => t.month === month && t.category === category && t.type === 'expense' && !t.lot_id
    );
    const total = txs.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    return total > 0 ? total : null;
  };

  // Get note for a cell (with auto-tenant for Loyer)
  const getIncomeCellNote = (month, category, groupId) => {
    // For Loyer, always show active tenant names
    if (category === 'Loyer' && groupId !== '__global__' && groupId !== '__empty__') {
      const autoNote = getAutoNote(month, category, groupId);
      return autoNote || null;
    }
    
    if (groupId === '__global__' || groupId === '__empty__') {
      const txs = transactions.filter(
        t => t.month === month && t.category === category && t.type === 'income' && !t.lot_id
          && !allLots.some(l => txMatchesLot(t, l))
      );
      return txs.map(t => t.note).filter(Boolean).join(' | ') || null;
    }
    const lot = allLots.find(l => l.id === groupId);
    const txs = transactions.filter(
      t => t.month === month && t.category === category && t.type === 'income' && txMatchesLot(t, lot)
    );
    const existingNote = txs.map(t => t.note).filter(Boolean).join(' | ');
    return existingNote || null;
  };

  const getExpenseCellNote = (month, category) => {
    const txs = transactions.filter(
      t => t.month === month && t.category === category && t.type === 'expense' && !t.lot_id
    );
    return txs.map(t => t.note).filter(Boolean).join(' | ') || null;
  };

  // --- Save handler ---
  const handleCellSave = (month, category, type, newVal, groupId = null) => {
    const realLotId = (groupId && groupId !== '__global__' && groupId !== '__empty__') ? groupId : null;
    const lot = realLotId ? allLots.find(l => l.id === realLotId) : null;
    const existing = transactions.find(
      t => t.month === month && t.category === category && t.type === type &&
        (lot ? txMatchesLot(t, lot) : (!t.lot_id && !allLots.some(l => txMatchesLot(t, l))))
    );
    if (newVal === null || newVal === 0) {
      if (existing) deleteMutation.mutate(existing.id);
      return;
    }
    if (existing) {
      updateMutation.mutate({ id: existing.id, data: { amount: newVal } });
    } else {
      createMutation.mutate(withOwner({
        property_id: propertyId, year, month, category, type, amount: newVal,
        ...(realLotId ? { lot_id: realLotId } : {}),
      }));
    }
  };

  const handleNoteSave = (month, category, type, newNote, groupId = null) => {
    const realLotId = (groupId && groupId !== '__global__' && groupId !== '__empty__') ? groupId : null;
    const lot = realLotId ? allLots.find(l => l.id === realLotId) : null;
    const existing = transactions.find(
      t => t.month === month && t.category === category && t.type === type &&
        (lot ? txMatchesLot(t, lot) : (!t.lot_id && !allLots.some(l => txMatchesLot(t, l))))
    );
    if (existing) {
      updateMutation.mutate({ id: existing.id, data: { note: newNote } });
    } else if (newNote) {
      // Create transaction with 0 amount just for the note (user can fill amount later)
      createMutation.mutate(withOwner({
        property_id: propertyId, year, month, category, type, amount: 0, note: newNote,
        ...(realLotId ? { lot_id: realLotId } : {}),
      }));
    }
  };

  // Auto-generate note with active tenants for a loyer cell (bail d'abord, repli legacy).
  const getAutoNote = (month, category, groupId) => {
    if (category !== 'Loyer' || groupId === '__global__' || groupId === '__empty__') return '';
    const lot = allLots.find(l => l.id === groupId);
    if (!lot) return '';
    const activeTenants = leaseActiveTenantNames(lot, leases, year, month - 1);
    return activeTenants.length > 0 ? activeTenants.join(', ') : '';
  };

  const isCurrentMonth = (m) => m === NOW_MONTH && year === NOW_YEAR;



  // Total income for a month = exact sum of visible income cells
  const getMonthIncome = (m) =>
    incomeGroups.reduce((s, group) => {
      const cats = group.id === '__global__' ? visibleGlobalIncomeCats : INCOME_CATS;
      return s + cats.reduce((s2, cat) => s2 + (getIncomeCellVal(m, cat, group.id) || 0), 0);
    }, 0);

  // Total expense for a month = exact sum of visible expense cells
  const getMonthExpense = (m) =>
    expenseRows.reduce((s, cat) => s + (getExpenseCellVal(m, cat) || 0), 0);

  // Income columns: one group per lot + optionally one global group if property-level income exists
  // If no lots AND no property-level income, show one empty column group
  const incomeGroups = useMemo(() => {
    const groups = allLots.map(lot => ({
      id: lot.id,
      label: lot.designation,
      tenant: getCurrentTenants(lot.id, leases).map((t) => t.name).join(', ') || lot.tenant_name,
      vacant: lot.is_vacant,
    }));
    if (hasPropertyLevelIncome) {
      groups.push({ id: '__global__', label: 'Global', tenant: null, vacant: false });
    }
    if (groups.length === 0) {
      groups.push({ id: '__empty__', label: 'Entrées', tenant: null, vacant: false });
    }
    return groups;
  }, [allLots, hasPropertyLevelIncome, leases]);

  // Only show columns that have at least one value in the year
  const expCols = expenseRows
    .filter(cat => ALL_MONTHS.some(m => getExpenseCellVal(m, cat) !== null))
    .map(cat => ({ cat }));

  const visibleGlobalIncomeCats = globalIncomeCats.filter(cat =>
    incomeGroups.some(group =>
      (group.id === '__global__' || group.id === '__empty__') &&
      ALL_MONTHS.some(m => getIncomeCellVal(m, cat, group.id) !== null)
    )
  );

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold">Cash-flow {year}</h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setYear(y => y - 1)}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <span className="text-sm font-medium w-12 text-center">{year}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setYear(y => y + 1)}>
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>

      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            {/* Row 1: group headers */}
            <tr className="border-b border-border bg-muted/30">
              <th className="sticky left-0 z-20 bg-muted/60 px-3 py-2 text-left font-medium text-muted-foreground min-w-[90px]" rowSpan={2}>
                Mois
              </th>

              {/* Income group header: one column group per lot (+ global if property-level income) */}
              {incomeGroups.map(group => (
                <th key={group.id}
                  colSpan={
                    group.id === '__global__' || group.id === '__empty__'
                      ? visibleGlobalIncomeCats.length + 1  // +1 for the add button col
                      : INCOME_CATS.length
                  }
                  className="text-center px-2 py-1.5 font-semibold text-emerald-700 border-l border-emerald-200 bg-emerald-50/40">
                  <div className="font-medium truncate max-w-[120px]">
                    {group.id === '__global__' ? 'Revenus exceptionnels' : group.label}
                  </div>
                  {group.tenant && (
                    <div className="text-[9px] text-emerald-600/70 font-normal truncate">{group.tenant}</div>
                  )}
                  {group.vacant && (
                    <div className="text-[9px] text-amber-500 font-normal">vacant</div>
                  )}
                </th>
              ))}

              {/* Total income */}
              <th className="text-center px-2 py-1.5 font-semibold text-emerald-700 bg-emerald-100/50 border-l border-emerald-300">
                Total entrées
              </th>

              {/* Expense group header */}
              <th colSpan={expCols.length + 1}
                className="text-center px-2 py-1.5 font-semibold text-red-700 border-l border-red-200 bg-red-50/40">
                Dépenses
              </th>

              {/* Total expense */}
              <th className="text-center px-2 py-1.5 font-semibold text-red-700 bg-red-100/50 border-l border-red-300">
                Total sorties
              </th>

              {/* Net */}
              <th className="text-center px-2 py-1.5 font-bold text-foreground bg-muted/50 border-l border-border">
                Net
              </th>
            </tr>

            {/* Row 2: sub-headers */}
            <tr className="border-b-2 border-border bg-muted/20">
              {/* Income sub-cols: Loyer+ch. / CAF per group, or global cats for __global__ */}
              {incomeGroups.flatMap(group => {
                const cats = group.id === '__global__' ? visibleGlobalIncomeCats : INCOME_CATS;
                return cats.map((cat, ci) => (
                  <th key={`${group.id}-${cat}`}
                    className={cn('text-center px-2 py-1.5 font-medium text-muted-foreground min-w-[80px]',
                      ci === 0 ? 'border-l border-emerald-200' : ''
                    )}>
                    {INCOME_CATS_LABELS[cat] || cat}
                  </th>
                ));
              })}

              {/* Add global income col button — only shown when __global__ group exists */}
              {incomeGroups.some(g => g.id === '__global__' || g.id === '__empty__') && (
                <th className="px-1 min-w-[40px] border-l border-emerald-200 bg-emerald-50/20">
                  {addingGlobalIncome ? (
                    <div className="flex items-center gap-1">
                      <Select onValueChange={v => { setExtraGlobalIncome(p => [...p, v]); setAddingGlobalIncome(false); }}>
                        <SelectTrigger className="h-6 text-xs w-40"><SelectValue placeholder="Catégorie..." /></SelectTrigger>
                        <SelectContent>
                          {EXTRA_GLOBAL_INCOME_OPTIONS.filter(c => !globalIncomeCats.includes(c)).map(c => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setAddingGlobalIncome(false)}><X className="w-2.5 h-2.5" /></Button>
                    </div>
                  ) : (
                    <button onClick={() => setAddingGlobalIncome(true)} className="text-emerald-500 hover:text-emerald-700 transition-colors" title="Ajouter une colonne revenu exceptionnel">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </th>
              )}

              {/* Total income placeholder */}
              <th className="min-w-[80px] bg-emerald-100/50 border-l border-emerald-300" />

              {/* Expense sub-cols */}
              {expCols.map((col, ci) => (
                <th key={col.cat}
                  className={cn('text-center px-2 py-1.5 font-medium text-muted-foreground min-w-[80px] group',
                    ci === 0 ? 'border-l border-red-200' : ''
                  )}>
                  <div className="flex items-center justify-center gap-1">
                    <span>{col.cat}</span>
                    {!DEFAULT_EXPENSE.includes(col.cat) && (
                      <button onClick={() => {
                        const hasTx = transactions.some(t => t.category === col.cat && t.type === 'expense');
                        if (!hasTx) setExtraExpenses(p => p.filter(c => c !== col.cat));
                      }} className="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-destructive">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </th>
              ))}

              {/* Add expense col button */}
              <th className="px-1 min-w-[40px] border-l border-red-200 bg-red-50/20">
                {addingExp ? (
                  <div className="flex items-center gap-1">
                    <Select onValueChange={v => { setExtraExpenses(p => [...p, v]); setAddingExp(false); }}>
                      <SelectTrigger className="h-6 text-xs w-40"><SelectValue placeholder="Catégorie..." /></SelectTrigger>
                      <SelectContent>{availableExpOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setAddingExp(false)}><X className="w-2.5 h-2.5" /></Button>
                  </div>
                ) : (
                  <button onClick={() => setAddingExp(true)} className="text-red-500 hover:text-red-700 transition-colors" title="Ajouter une colonne dépense">
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </th>

              {/* Total expense placeholder */}
              <th className="bg-red-100/50 border-l border-red-300" />
              {/* Net placeholder */}
              <th className="bg-muted/50 border-l border-border" />
            </tr>
          </thead>

          <tbody>
            {ALL_MONTHS.map(m => {
              const isCurrent = isCurrentMonth(m);
              const monthIncome = getMonthIncome(m);
              const monthExpense = getMonthExpense(m);
              const cf = monthIncome - monthExpense;
              const hasData = monthIncome > 0 || monthExpense > 0;

              return (
                <tr key={m} className={cn(
                  'border-b border-border/40 transition-colors',
                  isCurrent ? 'bg-primary/5 font-semibold' : 'hover:bg-muted/20'
                )}>
                  {/* Month label */}
                  <td className={cn(
                    'sticky left-0 z-10 px-3 py-1.5 font-medium',
                    isCurrent ? 'bg-primary/10 text-primary' : 'bg-card text-muted-foreground'
                  )}>
                    <div className="flex items-center gap-1">
                      {getMonthName(m).substring(0, 3)}
                      {isCurrent && <span className="text-[9px] text-primary/70 font-normal">◀</span>}
                    </div>
                  </td>

                  {/* Income cells: one group per lot/global */}
                  {incomeGroups.flatMap(group => {
                    const cats = group.id === '__global__' ? visibleGlobalIncomeCats : INCOME_CATS;
                    return cats.map((cat, ci) => (
                      <EditableCell
                        key={`${group.id}-${cat}`}
                        value={getIncomeCellVal(m, cat, group.id)}
                        note={getIncomeCellNote(m, cat, group.id)}
                        color={cn('text-emerald-600', ci === 0 ? 'border-l border-emerald-200/50' : '')}
                        onSave={(v) => handleCellSave(m, cat, 'income', v, group.id)}
                        onSaveNote={(n) => handleNoteSave(m, cat, 'income', n, group.id)}
                      />
                    ));
                  })}

                  {/* Add global income col placeholder */}
                  {incomeGroups.some(g => g.id === '__global__' || g.id === '__empty__') && (
                    <td className="border-l border-emerald-200/50 bg-emerald-50/10" />
                  )}

                  {/* Total income */}
                  <td className={cn('text-center px-2 py-1.5 number-fr font-semibold text-emerald-700 border-l border-emerald-200',
                    isCurrent ? 'bg-primary/5' : 'bg-emerald-50/30')}>
                    {monthIncome > 0 ? formatCurrency(monthIncome) : ''}
                  </td>

                  {/* Expense cells */}
                  {expCols.map((col, ci) => (
                    <EditableCell
                      key={col.cat}
                      value={getExpenseCellVal(m, col.cat)}
                      note={getExpenseCellNote(m, col.cat)}
                      color={cn('text-red-500', ci === 0 ? 'border-l border-red-200/50' : '')}
                      onSave={(v) => handleCellSave(m, col.cat, 'expense', v, null)}
                      onSaveNote={(n) => handleNoteSave(m, col.cat, 'expense', n, null)}
                    />
                  ))}

                  {/* Add col placeholder */}
                  <td className="border-l border-red-200/50 bg-red-50/10" />

                  {/* Total expense */}
                  <td className={cn('text-center px-2 py-1.5 number-fr font-semibold text-red-700 border-l border-red-200',
                    isCurrent ? 'bg-primary/5' : 'bg-red-50/30')}>
                    {monthExpense > 0 ? formatCurrency(monthExpense) : ''}
                  </td>

                  {/* CF net */}
                  <td className={cn(
                    'text-center px-2 py-1.5 number-fr font-bold border-l border-border',
                    isCurrent ? 'bg-primary/10' : 'bg-muted/30',
                    hasData ? (cf >= 0 ? 'text-emerald-700' : 'text-red-600') : 'text-muted-foreground'
                  )}>
                    {hasData ? formatCurrency(cf, true) : ''}
                  </td>
                </tr>
              );
            })}

            {/* Annual totals row */}
            <tr className="border-t-2 border-border bg-muted/60 font-bold text-xs">
              <td className="sticky left-0 z-10 px-3 py-2 bg-muted/80 font-bold">Total {year}</td>

              {incomeGroups.flatMap(group => {
                const cats = group.id === '__global__' ? visibleGlobalIncomeCats : INCOME_CATS;
                return cats.map((cat, ci) => {
                  const total = ALL_MONTHS.reduce((s, m) => s + (getIncomeCellVal(m, cat, group.id) || 0), 0);
                  return (
                    <td key={`${group.id}-${cat}-tot`}
                      className={cn('text-center px-1 py-2 number-fr text-emerald-700', ci === 0 ? 'border-l border-emerald-200' : '')}>
                      {total > 0 ? formatCurrency(total) : ''}
                    </td>
                  );
                });
              })}

              {/* Add global income col placeholder in totals */}
              {incomeGroups.some(g => g.id === '__global__' || g.id === '__empty__') && (
                <td className="border-l border-emerald-200" />
              )}

              <td className="text-center px-2 py-2 number-fr text-emerald-700 border-l border-emerald-200 bg-emerald-100/50">
                {formatCurrency(ALL_MONTHS.reduce((s, m) => s + getMonthIncome(m), 0))}
              </td>

              {expCols.map((col, ci) => {
                const total = ALL_MONTHS.reduce((s, m) => s + (getExpenseCellVal(m, col.cat) || 0), 0);
                return (
                  <td key={`${col.cat}-tot`}
                    className={cn('text-center px-1 py-2 number-fr text-red-600', ci === 0 ? 'border-l border-red-200' : '')}>
                    {total > 0 ? formatCurrency(total) : ''}
                  </td>
                );
              })}

              <td className="border-l border-red-200" />

              <td className="text-center px-2 py-2 number-fr text-red-600 border-l border-red-200 bg-red-100/50">
                {formatCurrency(ALL_MONTHS.reduce((s, m) => s + getMonthExpense(m), 0))}
              </td>

              {(() => {
                const totalCf = ALL_MONTHS.reduce((s, m) => s + getMonthIncome(m) - getMonthExpense(m), 0);
                return (
                  <td className={cn('text-center px-2 py-2 number-fr border-l border-border bg-muted/70',
                    totalCf >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                    {formatCurrency(totalCf, true)}
                  </td>
                );
              })()}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2 border-t border-border bg-muted/20 text-[10px] text-muted-foreground">
        Double-cliquer sur une cellule pour saisir ou modifier une valeur
      </div>
    </div>
  );
}