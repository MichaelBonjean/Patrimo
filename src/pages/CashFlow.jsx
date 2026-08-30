import React, { useState, useMemo, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ArrowLeft, Plus, MessageSquare, ChevronLeft, ChevronRight, X, ChevronDown } from 'lucide-react';
import { formatCurrency, getMonthName } from '@/lib/formatters';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { labelOf, resolveKey } from '@/lib/financeCategories';
import CategoryBadge from '@/components/finance/CategoryBadge';

// Default pinned rows always visible (clés stables canoniques)
const DEFAULT_INCOME = ["rent", "tenant_charges"];
const DEFAULT_EXPENSE = ["loan_installment", "property_insurance"];

// Additional categories available in the dropdown (clés stables canoniques)
const EXTRA_INCOME = ["deposit_received", "caf", "internal_transfer", "other_income"];
const EXTRA_EXPENSE = ["loan_insurance", "electricity", "water", "gas", "internet", "sci_fees", "condo_fees", "works", "property_tax", "management_fees", "accounting_fees", "notary_fees", "bank_fees", "other_expense", "unpaid_rent_insurance", "maintenance", "charge_regularization", "agency_fees", "cfe", "vat", "amortization", "provisions", "refunds"];

const txCatKey = (t) => resolveKey(t.category);

export default function CashFlow() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [extraIncomes, setExtraIncomes] = useState([]);
  const [extraExpenses, setExtraExpenses] = useState([]);
  const [addingIncome, setAddingIncome] = useState(false);
  const [addingExpense, setAddingExpense] = useState(false);

  const { data: properties = [] } = useQuery({
    queryKey: ['property', id],
    queryFn: () => base44.entities.Property.filter(withOwner({ id })),
  });
  const property = properties[0];

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', id, year],
    queryFn: () => base44.entities.Transaction.filter(withOwner({ property_id: id, year })),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Transaction.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions', id, year] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ txId, data }) => base44.entities.Transaction.update(txId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions', id, year] }),
  });

  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  // Auto-add extra rows for categories that have transactions but aren't already shown
  const txIncomeExtras = useMemo(() => {
    const cats = [...new Set(transactions.filter(t => t.type === 'income').map(txCatKey))];
    return cats.filter(c => c && c !== 'other' && !DEFAULT_INCOME.includes(c) && !extraIncomes.includes(c) && !DEFAULT_EXPENSE.includes(c) && !extraExpenses.includes(c));
  }, [transactions, extraIncomes, extraExpenses]);

  const txExpenseExtras = useMemo(() => {
    const cats = [...new Set(transactions.filter(t => t.type === 'expense').map(txCatKey))];
    return cats.filter(c => c && c !== 'other' && !DEFAULT_EXPENSE.includes(c) && !extraExpenses.includes(c) && !DEFAULT_INCOME.includes(c) && !extraIncomes.includes(c));
  }, [transactions, extraExpenses, extraIncomes]);

  const incomeRows = [...DEFAULT_INCOME, ...extraIncomes, ...txIncomeExtras];
  const expenseRows = [...DEFAULT_EXPENSE, ...extraExpenses, ...txExpenseExtras];

  const getMonthTotal = (month, type) => {
    const visibleRows = type === 'income' ? incomeRows : expenseRows;
    // Sum only transactions that match BOTH the category row AND the type of that row
    // This ensures the total = exact sum of what's displayed in the cells
    return visibleRows.reduce((sum, cat) => {
      const tx = transactions.find(t => t.month === month && txCatKey(t) === cat && t.type === type);
      return sum + (tx ? Math.abs(tx.amount || 0) : 0);
    }, 0);
  };

  const handleCellSave = (month, category, type, value, existingTx) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue) && !existingTx) return;
    if (existingTx && (isNaN(numValue) || numValue === 0)) {
      base44.entities.Transaction.delete(existingTx.id).then(() =>
        queryClient.invalidateQueries({ queryKey: ['transactions', id, year] })
      );
      return;
    }
    if (existingTx) {
      updateMutation.mutate({ txId: existingTx.id, data: { amount: numValue } });
    } else if (numValue && numValue !== 0) {
      createMutation.mutate(withOwner({ property_id: id, year, month, category, category_label: labelOf(category), type, amount: numValue }));
    }
  };

  const handleNoteSave = (existingTx, note) => {
    if (existingTx) {
      updateMutation.mutate({ txId: existingTx.id, data: { note } });
      toast.success('Note enregistrée');
    }
  };

  // Auto-remove manually added rows that have no transactions (unless just added)
  const [recentlyAdded, setRecentlyAdded] = useState([]);

  useEffect(() => {
    if (transactions.length === 0) return;
    setExtraIncomes(prev => prev.filter(cat =>
      recentlyAdded.includes(cat) || transactions.some(t => txCatKey(t) === cat)
    ));
    setExtraExpenses(prev => prev.filter(cat =>
      recentlyAdded.includes(cat) || transactions.some(t => txCatKey(t) === cat)
    ));
  }, [transactions]);

  const addIncomeRow = (cat) => {
    if (!extraIncomes.includes(cat)) {
      setExtraIncomes(p => [...p, cat]);
      setRecentlyAdded(p => [...p, cat]);
    }
    setAddingIncome(false);
  };

  const addExpenseRow = (cat) => {
    if (!extraExpenses.includes(cat)) {
      setExtraExpenses(p => [...p, cat]);
      setRecentlyAdded(p => [...p, cat]);
    }
    setAddingExpense(false);
  };

  const removeRow = (cat, type) => {
    const hasTx = transactions.some(t => txCatKey(t) === cat && t.type === type);
    if (hasTx) { toast.error('Supprimez d\'abord les données de cette ligne'); return; }
    setRecentlyAdded(p => p.filter(c => c !== cat));
    if (type === 'income') setExtraIncomes(p => p.filter(c => c !== cat));
    else setExtraExpenses(p => p.filter(c => c !== cat));
  };

  const availableIncomes = EXTRA_INCOME.filter(c => !incomeRows.includes(c));
  const availableExpenses = EXTRA_EXPENSE.filter(c => !expenseRows.includes(c));

  if (!property) return null;

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/biens/${id}`}>
            <Button variant="ghost" size="icon"><ArrowLeft className="w-5 h-5" /></Button>
          </Link>
          <div>
            <h1 className="text-lg font-bold">Cash-flow : {property.name}</h1>
            <p className="text-xs text-muted-foreground">{property.city} • {property.tax_regime}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setYear(y => y - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="font-bold text-lg w-16 text-center">{year}</span>
          <Button variant="outline" size="icon" onClick={() => setYear(y => y + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="sticky left-0 bg-muted/90 z-10 text-left px-3 py-2 font-medium text-muted-foreground w-48 min-w-[12rem]">Catégorie</th>
                {months.map(m => (
                  <th key={m} className="text-center px-2 py-2 font-medium text-muted-foreground min-w-[90px]">
                    {getMonthName(m).substring(0, 3)}
                  </th>
                ))}
                <th className="text-center px-3 py-2 font-semibold text-muted-foreground min-w-[100px] bg-muted/70">Total</th>
              </tr>
            </thead>
            <tbody>
              {/* INCOMES */}
              <tr className="bg-emerald-50/50">
                <td colSpan={14} className="sticky left-0 px-3 py-1.5 font-semibold text-emerald-700 text-xs uppercase tracking-wider bg-emerald-50/80 z-10">
                  Entrées
                </td>
              </tr>
              {incomeRows.map(cat => (
                <CashFlowRow
                  key={cat}
                  category={cat}
                  type="income"
                  months={months}
                  transactions={transactions}
                  onSave={handleCellSave}
                  onNoteSave={handleNoteSave}
                  rowColor="hover:bg-emerald-50/30"
                  isExtra={!DEFAULT_INCOME.includes(cat)}
                  onRemove={removeRow}
                />
              ))}
              {/* Add income row */}
              <tr className="border-b border-border/30 bg-emerald-50/20">
                <td className="sticky left-0 z-10 bg-emerald-50/20 px-3 py-1.5" colSpan={14}>
                  {addingIncome ? (
                    <div className="flex items-center gap-2">
                      <Select onValueChange={addIncomeRow}>
                        <SelectTrigger className="h-7 text-xs w-52"><SelectValue placeholder="Choisir une catégorie..." /></SelectTrigger>
                        <SelectContent>{availableIncomes.map(c => <SelectItem key={c} value={c}>{labelOf(c)}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setAddingIncome(false)}><X className="w-3 h-3" /></Button>
                    </div>
                  ) : (
                    <button onClick={() => setAddingIncome(true)} className="flex items-center gap-1 text-emerald-600 hover:text-emerald-800 text-xs font-medium transition-colors">
                      <Plus className="w-3.5 h-3.5" />Ajouter une ligne entrée
                    </button>
                  )}
                </td>
              </tr>
              {/* Income totals */}
              <tr className="border-t-2 border-emerald-200 bg-emerald-50/40 font-semibold">
                <td className="sticky left-0 bg-emerald-50/80 z-10 px-3 py-2 text-emerald-700">Total entrées</td>
                {months.map(m => (
                 <TotalCell key={m} month={m} type="income" transactions={transactions} getMonthTotal={getMonthTotal} colorClass="text-emerald-700" bgClass="hover:bg-emerald-100/60" visibleRows={incomeRows} />
                ))}
                <TotalYearCell type="income" transactions={transactions} months={months} getMonthTotal={getMonthTotal} colorClass="text-emerald-700" bgClass="bg-emerald-100/50 hover:bg-emerald-200/50" visibleRows={incomeRows} />
              </tr>

              {/* EXPENSES */}
              <tr className="bg-red-50/50">
                <td colSpan={14} className="sticky left-0 px-3 py-1.5 font-semibold text-red-700 text-xs uppercase tracking-wider bg-red-50/80 z-10">
                  Sorties
                </td>
              </tr>
              {expenseRows.map(cat => (
                <CashFlowRow
                  key={cat}
                  category={cat}
                  type="expense"
                  months={months}
                  transactions={transactions}
                  onSave={handleCellSave}
                  onNoteSave={handleNoteSave}
                  rowColor="hover:bg-red-50/30"
                  isExtra={!DEFAULT_EXPENSE.includes(cat)}
                  onRemove={removeRow}
                />
              ))}
              {/* Add expense row */}
              <tr className="border-b border-border/30 bg-red-50/20">
                <td className="sticky left-0 z-10 bg-red-50/20 px-3 py-1.5" colSpan={14}>
                  {addingExpense ? (
                    <div className="flex items-center gap-2">
                      <Select onValueChange={addExpenseRow}>
                        <SelectTrigger className="h-7 text-xs w-52"><SelectValue placeholder="Choisir une catégorie..." /></SelectTrigger>
                        <SelectContent>{availableExpenses.map(c => <SelectItem key={c} value={c}>{labelOf(c)}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setAddingExpense(false)}><X className="w-3 h-3" /></Button>
                    </div>
                  ) : (
                    <button onClick={() => setAddingExpense(true)} className="flex items-center gap-1 text-red-600 hover:text-red-800 text-xs font-medium transition-colors">
                      <Plus className="w-3.5 h-3.5" />Ajouter une ligne sortie
                    </button>
                  )}
                </td>
              </tr>
              {/* Expense totals */}
              <tr className="border-t-2 border-red-200 bg-red-50/40 font-semibold">
                <td className="sticky left-0 bg-red-50/80 z-10 px-3 py-2 text-red-700">Total sorties</td>
                {months.map(m => (
                 <TotalCell key={m} month={m} type="expense" transactions={transactions} getMonthTotal={getMonthTotal} colorClass="text-red-700" bgClass="hover:bg-red-100/60" visibleRows={expenseRows} />
                ))}
                <TotalYearCell type="expense" transactions={transactions} months={months} getMonthTotal={getMonthTotal} colorClass="text-red-700" bgClass="bg-red-100/50 hover:bg-red-200/50" visibleRows={expenseRows} />
              </tr>

              {/* CASHFLOW */}
              <tr className="border-t-4 border-border bg-muted/50 font-bold">
                <td className="sticky left-0 bg-muted/80 z-10 px-3 py-3 text-sm">Cashflow net</td>
                {months.map(m => {
                  const cf = getMonthTotal(m, 'income') - getMonthTotal(m, 'expense');
                  return (
                    <td key={m} className={cn("text-center px-2 py-3 number-fr", cf >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                      {(getMonthTotal(m, 'income') > 0 || getMonthTotal(m, 'expense') > 0) ? formatCurrency(cf, true) : ''}
                    </td>
                  );
                })}
                <td className="text-center px-3 py-3 number-fr bg-muted/70">
                  {(() => {
                    const total = months.reduce((s, m) => s + getMonthTotal(m, 'income') - getMonthTotal(m, 'expense'), 0);
                    return <span className={total >= 0 ? 'text-emerald-700' : 'text-red-600'}>{formatCurrency(total, true)}</span>;
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TotalCell({ month, type, transactions, getMonthTotal, colorClass, bgClass, visibleRows }) {
  const total = getMonthTotal(month, type);
  if (total === 0) return <td className="text-center px-2 py-2 number-fr" />;

  // Breakdown mirrors exactly what CashFlowRow shows: one tx per (category, type, month)
  const breakdown = visibleRows.reduce((acc, cat) => {
    const tx = transactions.find(t => t.month === month && resolveKey(t.category) === cat && t.type === type);
    if (tx && tx.amount) acc[cat] = Math.abs(tx.amount);
    return acc;
  }, {});

  return (
    <td className={cn("text-center px-2 py-2 number-fr", colorClass)}>
      <Popover>
        <PopoverTrigger asChild>
          <button className={cn("w-full rounded px-1 py-0.5 transition-colors", bgClass)}>
            {formatCurrency(total)}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-52 p-3" side="top">
          <p className="text-xs font-semibold mb-2">Détail</p>
          <div className="space-y-1">
            {Object.entries(breakdown).map(([cat, amt]) => (
              <div key={cat} className="flex justify-between text-xs">
                <span className="text-muted-foreground truncate pr-2">{labelOf(cat)}</span>
                <span className={cn("font-medium number-fr shrink-0", colorClass)}>{formatCurrency(amt)}</span>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </td>
  );
}

function TotalYearCell({ type, transactions, months, getMonthTotal, colorClass, bgClass, visibleRows }) {
  const total = months.reduce((s, m) => s + getMonthTotal(m, type), 0);

  // Breakdown mirrors exactly what CashFlowRow shows: one tx per (category, type, month)
  const breakdown = visibleRows.reduce((acc, cat) => {
    const monthTotal = months.reduce((s, m) => {
      const tx = transactions.find(t => t.month === m && resolveKey(t.category) === cat && t.type === type);
      return s + (tx ? Math.abs(tx.amount || 0) : 0);
    }, 0);
    if (monthTotal > 0) acc[cat] = monthTotal;
    return acc;
  }, {});

  return (
    <td className={cn("text-center px-3 py-2 number-fr", bgClass, colorClass)}>
      <Popover>
        <PopoverTrigger asChild>
          <button className="w-full rounded px-1 py-0.5 transition-colors hover:brightness-95">
            {formatCurrency(total)}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-3" side="top">
          <p className="text-xs font-semibold mb-2">Détail annuel</p>
          <div className="space-y-1">
            {Object.entries(breakdown).map(([cat, amt]) => (
              <div key={cat} className="flex justify-between text-xs">
                <span className="text-muted-foreground truncate pr-2">{labelOf(cat)}</span>
                <span className={cn("font-medium number-fr shrink-0", colorClass)}>{formatCurrency(amt)}</span>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </td>
  );
}

function CashFlowRow({ category, type, months, transactions, onSave, onNoteSave, rowColor, isExtra, onRemove }) {
  const rowTxs = transactions.filter(t => resolveKey(t.category) === category && t.type === type);
  const total = rowTxs.reduce((s, t) => s + Math.abs(t.amount || 0), 0);

  return (
    <tr className={cn("border-b border-border/50 transition-colors group/row", rowColor)}>
      <td className="sticky left-0 bg-card z-10 px-3 py-1 text-xs font-medium text-muted-foreground">
        <div className="flex items-center gap-1">
          <CategoryBadge category={category} className="flex-1" />
          {isExtra && (
            <button onClick={() => onRemove(category, type)}
              className="opacity-0 group-hover/row:opacity-60 hover:!opacity-100 text-destructive transition-opacity">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </td>
      {months.map(m => {
        const tx = rowTxs.find(t => t.month === m);
        return (
          <CashFlowCell key={m} tx={tx} month={m} category={category} type={type} onSave={onSave} onNoteSave={onNoteSave} />
        );
      })}
      <td className="text-center px-3 py-1 number-fr font-medium bg-muted/30">
        {total > 0 ? formatCurrency(total) : ''}
      </td>
    </tr>
  );
}

function CashFlowCell({ tx, month, category, type, onSave, onNoteSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const handleClick = () => {
    setValue(tx?.amount ? Math.abs(tx.amount).toString() : '');
    setEditing(true);
  };

  const handleBlur = () => {
    setEditing(false);
    onSave(month, category, type, value, tx);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') e.target.blur();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <td className="text-center px-1 py-0.5">
        <Input autoFocus type="number" step="0.01" value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={handleBlur} onKeyDown={handleKeyDown}
          className="h-7 text-xs text-center number-fr w-full min-w-[70px]" />
      </td>
    );
  }

  return (
    <td className="text-center px-2 py-1 cursor-pointer group relative" onClick={handleClick}>
      <span className={cn("number-fr text-xs", type === 'income' ? 'text-emerald-600' : 'text-red-500')}>
        {tx?.amount ? formatCurrency(Math.abs(tx.amount)) : ''}
      </span>
      {tx?.note && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="absolute top-0 right-0.5 opacity-60 hover:opacity-100">
              <MessageSquare className="w-2.5 h-2.5 text-primary" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-3">
            <p className="text-xs font-medium mb-2">Note</p>
            <p className="text-xs text-muted-foreground">{tx.note}</p>
          </PopoverContent>
        </Popover>
      )}
    </td>
  );
}