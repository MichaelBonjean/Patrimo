import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, AlertCircle, FileUp, Trash2, X, ArrowLeftRight, Upload } from 'lucide-react';
import { formatCurrency, formatDateFR } from '@/lib/formatters';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useOwnerFilter } from '@/lib/tenantFilter';
import OnboardingEmptyState from '@/components/OnboardingEmptyState';
import TransferManager from '@/components/import/TransferManager';
import UnifiedImporter from '@/components/import/UnifiedImporter';
import { TRANSACTION_CATEGORIES, labelOf } from '@/lib/financeCategories';

const ALL_CATEGORIES = TRANSACTION_CATEGORIES.map(c => c.value);

export default function BankImportPage() {
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const [showImporter, setShowImporter] = useState(false);

  const { data: imports = [] } = useQuery({
    queryKey: ['bank-imports'],
    queryFn: () => base44.entities.BankImport.filter(withOwner(), '-created_date', 300),
  });
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => base44.entities.Property.filter(withOwner()),
  });
  const { data: lots = [] } = useQuery({
    queryKey: ['lots'],
    queryFn: () => base44.entities.Lot.filter(withOwner()),
  });
  const { data: rules = [] } = useQuery({
    queryKey: ['bank-rules'],
    queryFn: () => base44.entities.BankRule.filter(withOwner()),
  });
  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions-all'],
    queryFn: () => base44.entities.Transaction.filter(withOwner()),
  });
  const { data: bankTransactions = [] } = useQuery({
    queryKey: ['bank-transactions'],
    queryFn: () => base44.entities.BankTransaction.filter(withOwner(), '-created_date', 1000),
  });

  const updateImportMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.BankImport.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bank-imports'] }),
  });

  const createTransactionMutation = useMutation({
    mutationFn: (data) => base44.entities.Transaction.create(data),
  });

  if (properties.length === 0 && imports.length === 0) {
    return (
      <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Import & Saisie</h1>
          <p className="text-sm text-muted-foreground mt-1">Relevés bancaires, fichiers CAF, loyers et saisie manuelle</p>
        </div>
        <OnboardingEmptyState icon={FileUp} />
      </div>
    );
  }

  const handleCategorize = async (importItem, category, propertyId) => {
    await updateImportMutation.mutateAsync({ id: importItem.id, data: { assigned_category: category, assigned_property_id: propertyId, status: 'categorized' } });
    const date = new Date(importItem.import_date);
    await createTransactionMutation.mutateAsync(withOwner({
      property_id: propertyId,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      category,
      category_label: labelOf(category),
      amount: Math.abs(importItem.amount),
      type: importItem.amount >= 0 ? 'income' : 'expense',
      note: importItem.description,
      bank_import_id: importItem.id,
    }));
    queryClient.invalidateQueries({ queryKey: ['bank-imports'] });
    toast.success('Transaction catégorisée');
  };

  const pending = imports.filter(i => i.status === 'pending');
  const categorized = imports.filter(i => i.status === 'categorized');
  const transfersCount = transactions.filter(t => t.category === 'internal_transfer').length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Import & Saisie</h1>
          <p className="text-sm text-muted-foreground mt-1">Relevés bancaires, fichiers CAF, loyers et saisie manuelle</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="gap-1.5" onClick={() => setShowImporter(v => !v)}>
            <Upload className="w-4 h-4" /> Importer
          </Button>
        </div>
      </div>

      {/* Point d'entrée unique — pipeline unifié */}
      {showImporter && (
        <UnifiedImporter properties={properties} lots={lots} rules={rules} transactions={transactions}
          bankTransactions={bankTransactions}
          withOwner={withOwner} queryClient={queryClient} onClose={() => setShowImporter(false)} />
      )}

      {/* Alert pending */}
      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
          <p className="text-sm font-medium text-amber-800">{pending.length} transaction{pending.length > 1 ? 's' : ''} à catégoriser</p>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            Non catégorisées
            {pending.length > 0 && <Badge variant="destructive" className="text-xs ml-1">{pending.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="categorized">Catégorisées ({categorized.length})</TabsTrigger>
          <TabsTrigger value="transfers" className="gap-1.5">
            <ArrowLeftRight className="w-3.5 h-3.5" /> Transferts
            {transfersCount > 0 && <Badge variant="secondary" className="text-xs ml-1">{transfersCount}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {pending.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <FileUp className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Aucune transaction en attente</p>
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{pending.length} transaction{pending.length > 1 ? 's' : ''} en attente</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={async () => {
                      if (!confirm('Supprimer TOUTES les transactions en attente ?')) return;
                      for (let i = 0; i < pending.length; i += 5) {
                        const batch = pending.slice(i, i + 5);
                        await Promise.all(batch.map(item => base44.entities.BankImport.delete(item.id)));
                        await new Promise(resolve => setTimeout(resolve, 500));
                      }
                      queryClient.invalidateQueries({ queryKey: ['bank-imports'] });
                      toast.success('Transactions supprimées');
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Tout supprimer
                  </Button>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Date</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Description</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Montant</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Bien</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Catégorie</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map(item => (
                      <ImportRow key={item.id} item={item} properties={properties} onCategorize={handleCategorize} />
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="categorized">
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {categorized.length > 0 && (
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{categorized.length} transaction{categorized.length > 1 ? 's' : ''} catégorisée{categorized.length > 1 ? 's' : ''}</span>
                <Button
                   variant="destructive"
                   size="sm"
                   className="gap-1.5"
                   onClick={async () => {
                     if (!confirm(`Supprimer les ${categorized.length} transactions catégorisées ?`)) return;
                     for (let i = 0; i < categorized.length; i += 10) {
                       const batch = categorized.slice(i, i + 10);
                       await Promise.all(batch.map(item => base44.entities.BankImport.delete(item.id)));
                       await new Promise(resolve => setTimeout(resolve, 200));
                     }
                     queryClient.invalidateQueries({ queryKey: ['bank-imports'] });
                     toast.success('Transactions supprimées');
                   }}
                 >
                   <Trash2 className="w-3.5 h-3.5" /> Tout supprimer
                 </Button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Description</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Montant</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Catégorie</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Bien</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {categorized.map(item => (
                    <tr key={item.id} className="border-b border-border/50">
                      <td className="px-4 py-2 text-xs">{formatDateFR(item.import_date)}</td>
                      <td className="px-4 py-2 text-xs truncate max-w-xs">{item.description}</td>
                      <td className={cn("px-4 py-2 text-right number-fr text-xs font-medium", item.amount >= 0 ? 'text-emerald-600' : 'text-red-500')}>
                        {formatCurrency(item.amount)}
                      </td>
                      <td className="px-4 py-2"><Badge variant="secondary" className="text-xs">{labelOf(item.assigned_category)}</Badge></td>
                      <td className="px-4 py-2 text-xs">{properties.find(p => p.id === item.assigned_property_id)?.name || '—'}</td>
                      <td className="px-4 py-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={async () => {
                            await base44.entities.BankImport.delete(item.id);
                            queryClient.invalidateQueries({ queryKey: ['bank-imports'] });
                          }}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="transfers">
          <TransferManager properties={properties} transactions={transactions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ImportRow({ item, properties, onCategorize }) {
  const [category, setCategory] = useState(item.assigned_category || '');
  const [propertyId, setPropertyId] = useState(item.assigned_property_id || '');
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30">
      <td className="px-4 py-2 text-xs">{formatDateFR(item.import_date)}</td>
      <td className="px-4 py-2 text-xs max-w-xs truncate" title={item.description}>{item.description}</td>
      <td className={cn("px-4 py-2 text-right number-fr text-xs font-medium", item.amount >= 0 ? 'text-emerald-600' : 'text-red-500')}>
        {formatCurrency(item.amount)}
      </td>
      <td className="px-4 py-2">
        <Select value={propertyId} onValueChange={setPropertyId}>
          <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Bien" /></SelectTrigger>
          <SelectContent>{properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </td>
      <td className="px-4 py-2">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Catégorie" /></SelectTrigger>
          <SelectContent>{ALL_CATEGORIES.map(c => <SelectItem key={c} value={c}>{labelOf(c)}</SelectItem>)}</SelectContent>
        </Select>
      </td>
      <td className="px-4 py-2">
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!category || !propertyId}
          onClick={() => onCategorize(item, category, propertyId)}>
          <Check className="w-3 h-3" />
        </Button>
      </td>
    </tr>
  );
}