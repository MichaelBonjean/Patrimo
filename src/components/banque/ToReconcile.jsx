import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Check, FileUp } from 'lucide-react';
import { formatCurrency, formatDateFR } from '@/lib/formatters';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { TRANSACTION_CATEGORIES, labelOf } from '@/lib/financeCategories';
import EmptyState from '@/components/EmptyState';
import { IlloBanque } from '@/components/illustrations/EmptyIllustrations';
import { proposeRule } from '@/lib/ruleLearningEngine';
import RuleProposalDialog from '@/components/banque/RuleProposalDialog';

const ALL_CATEGORIES = TRANSACTION_CATEGORIES.map((c) => c.value);

/**
 * Onglet "À rapprocher" de la page Banque : transactions bancaires importées
 * non catégorisées, triées par ancienneté (date la plus ancienne en premier).
 */
export default function ToReconcile() {
  const qc = useQueryClient();
  const { withOwner, ownerEmail } = useOwnerFilter();
  const [proposal, setProposal] = useState(null);

  const { data: imports = [], isLoading } = useQuery({
    queryKey: ['bank-imports'],
    queryFn: () => base44.entities.BankImport.filter(withOwner(), '-created_date', 300),
  });
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => base44.entities.Property.filter(withOwner()),
  });
  const { data: rules = [] } = useQuery({
    queryKey: ['bank-rules'],
    queryFn: () => base44.entities.BankRule.filter(withOwner()),
  });

  // Pending triés par ancienneté (date la plus ancienne d'abord) = prio.
  const pending = useMemo(
    () => imports.filter((i) => i.status === 'pending').sort((a, b) => String(a.import_date).localeCompare(String(b.import_date))),
    [imports]
  );

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.BankImport.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-imports'] }),
  });
  const createTx = useMutation({ mutationFn: (data) => base44.entities.Transaction.create(data) });

  async function categorize(item, category, propertyId) {
    try {
      await updateMutation.mutateAsync({ id: item.id, data: { assigned_category: category, assigned_property_id: propertyId, status: 'categorized' } });
      const d = new Date(item.import_date);
      await createTx.mutateAsync(withOwner({
        property_id: propertyId,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        category,
        category_label: labelOf(category),
        amount: Math.abs(item.amount),
        type: item.amount >= 0 ? 'income' : 'expense',
        note: item.description,
        bank_import_id: item.id,
      }));
      qc.invalidateQueries({ queryKey: ['bank-imports'] });
      toast.success('Transaction rapprochée');
      // Apprentissage déterministe : proposer une BankRule pour les prochains virements similaires.
      const p = proposeRule({
        description: item.description,
        amount: item.amount,
        target: { category, property_id: propertyId },
        existingRules: rules,
      });
      if (p.candidate && (p.suggestion === 'create' || p.suggestion === 'update_existing')) {
        setProposal({ ...p, learned_from_transaction_id: item.id, owner_id: ownerEmail });
      }
    } catch (e) {
      toast.error(e?.message || 'Échec');
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>;
  }

  if (pending.length === 0) {
    if (imports.length === 0) {
      return (
        <EmptyState
          illustration={<IlloBanque />}
          title="Aucune transaction"
          subtitle="Importez votre 1er relevé bancaire ou saisissez une opération manuellement pour commencer le rapprochement."
          primary={<Link to="/banque?tab=import"><Button className="gap-2"><FileUp className="w-4 h-4" />Importer un relevé</Button></Link>}
          secondary={<Link to="/banque?tab=saisie"><Button variant="ghost" className="gap-2">Saisie manuelle</Button></Link>}
        />
      );
    }
    return (
      <div className="bg-card rounded-xl border border-border p-12 text-center">
        <FileUp className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">Aucune transaction à rapprocher. Tout est catégorisé 🎉</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="destructive">{pending.length} à rapprocher</Badge>
        <span className="text-xs text-muted-foreground">triées par ancienneté (plus ancienne en premier)</span>
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
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
              {pending.map((item) => (
                <ReconcileRow key={item.id} item={item} properties={properties} onCategorize={categorize} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <RuleProposalDialog
        open={!!proposal}
        proposal={proposal}
        onAccept={async (ruleData) => {
          try {
            await base44.entities.BankRule.create(ruleData);
            qc.invalidateQueries({ queryKey: ['bank-rules'] });
            toast.success('Règle créée — les prochains virements similaires seront reconnus automatiquement.');
          } catch (e) {
            toast.error(e?.message || 'Échec de la création de la règle');
          } finally {
            setProposal(null);
          }
        }}
        onClose={() => setProposal(null)}
      />
    </div>
  );
}

function ReconcileRow({ item, properties, onCategorize }) {
  const [category, setCategory] = useState(item.assigned_category || '');
  const [propertyId, setPropertyId] = useState(item.assigned_property_id || '');
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30">
      <td className="px-4 py-2 text-xs whitespace-nowrap">{formatDateFR(item.import_date)}</td>
      <td className="px-4 py-2 text-xs max-w-xs truncate" title={item.description}>{item.description}</td>
      <td className={cn('px-4 py-2 text-right number-fr text-xs font-medium', item.amount >= 0 ? 'text-emerald-600' : 'text-red-500')}>
        {formatCurrency(item.amount)}
      </td>
      <td className="px-4 py-2">
        <Select value={propertyId} onValueChange={setPropertyId}>
          <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Bien" /></SelectTrigger>
          <SelectContent>{properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
      </td>
      <td className="px-4 py-2">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-7 text-xs w-48"><SelectValue placeholder="Catégorie" /></SelectTrigger>
          <SelectContent>{ALL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{labelOf(c)}</SelectItem>)}</SelectContent>
        </Select>
      </td>
      <td className="px-4 py-2">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={!category || !propertyId}
          onClick={() => onCategorize(item, category, propertyId)}>
          <Check className="w-3 h-3" /> Valider
        </Button>
      </td>
    </tr>
  );
}