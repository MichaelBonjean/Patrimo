import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Check, Pencil, X, Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { formatCurrency, formatDateFR } from '@/lib/formatters';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TRANSACTION_CATEGORIES, labelOf } from '@/lib/financeCategories';

const invokeF = async (name, payload) => {
  try { return { ok: true, data: (await base44.functions.invoke(name, payload)).data }; }
  catch (e) { return { ok: false, status: e?.response?.status, data: e?.response?.data || { error: e?.message } }; }
};

const CATS = TRANSACTION_CATEGORIES.map((c) => c.value);

/**
 * File de rapprochement réelle : appelle reconcileBankTransactions (moteur) puis
 * applyReconciliation pour chaque décision [Valider|Modifier|Ignorer].
 * Niveaux : automatic (validable en lot), proposed (exception à trancher),
 * to_identify (À vérifier — Modifier uniquement).
 */
export default function ReconcileQueue() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['reconcile-queue'],
    queryFn: () => invokeF('reconcileBankTransactions', {}),
    refetchOnWindowFocus: false,
  });
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => base44.entities.Property.filter({}),
  });

  const proposals = data?.data?.proposals || [];
  const aggregate = data?.data?.aggregate || {};
  const counts = data?.data?.context_counts || {};

  const [editing, setEditing] = useState(null); // proposal en cours de modification

  const applyMut = useMutation({
    mutationFn: (payload) => invokeF('applyReconciliation', payload),
    onSuccess: (res, vars) => {
      if (res.ok && res.data.ok) {
        toast.success(vars.decision === 'ignore' ? 'Opération ignorée' : 'Rapprochement validé');
      } else {
        toast.error(res.data?.error || 'Échec de la validation');
      }
      qc.invalidateQueries({ queryKey: ['reconcile-queue'] });
      qc.invalidateQueries({ queryKey: ['bank-transactions'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['transactions-all'] });
      qc.invalidateQueries({ queryKey: ['rent-dues'] });
    },
  });

  const automatic = proposals.filter((p) => p.level === 'automatic');
  const proposed = proposals.filter((p) => p.level === 'proposed');
  const toIdentify = proposals.filter((p) => p.level === 'to_identify');

  const validateAll = async () => {
    for (const p of automatic) {
      await applyMut.mutateAsync({ bank_transaction_id: p.bank_transaction_id, decision: 'validate' });
    }
  };

  if (isLoading) {
    return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>;
  }

  if (!data?.ok) {
    return <Card><CardContent className="py-8 text-sm text-muted-foreground">Impossible de charger le rapprochement : {data?.data?.error}</CardContent></Card>;
  }

  if (proposals.length === 0) {
    return (
      <Card><CardContent className="py-12 text-center">
        <Check className="w-10 h-10 mx-auto mb-3 text-emerald-500" />
        <p className="text-sm font-medium">Aucune opération à rapprocher</p>
        <p className="text-xs text-muted-foreground mt-1">Importez un relevé ou saisissez une opération pour lancer le moteur de rapprochement.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{proposals.length} opération{proposals.length > 1 ? 's' : ''}</Badge>
        {aggregate.automatic_count > 0 && <Badge className="bg-emerald-600 text-white">{aggregate.automatic_count} auto</Badge>}
        {aggregate.proposed_count > 0 && <Badge className="bg-amber-500 text-white">{aggregate.proposed_count} à confirmer</Badge>}
        {aggregate.to_identify_count > 0 && <Badge variant="destructive">{aggregate.to_identify_count} à vérifier</Badge>}
        <Button size="sm" variant="ghost" className="h-7 gap-1 ml-auto" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} /> Actualiser
        </Button>
      </div>

      {automatic.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium"><Sparkles className="w-4 h-4 text-emerald-500" /> Reconnu automatiquement</div>
              <Button size="sm" className="h-7 gap-1" onClick={validateAll} disabled={applyMut.isPending}>
                <Check className="w-3.5 h-3.5" /> Valider les {automatic.length}
              </Button>
            </div>
            <div className="space-y-2">
              {automatic.map((p) => <ProposalRow key={p.bank_transaction_id} p={p} properties={properties} onValidate={(pp) => applyMut.mutate({ bank_transaction_id: pp.bank_transaction_id, decision: 'validate' })} onModify={(pp) => setEditing(pp)} onIgnore={(pp) => applyMut.mutate({ bank_transaction_id: pp.bank_transaction_id, decision: 'ignore' })} />)}
            </div>
          </CardContent>
        </Card>
      )}

      {proposed.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="w-4 h-4 text-amber-500" /> À confirmer</div>
            <div className="space-y-2">
              {proposed.map((p) => <ProposalRow key={p.bank_transaction_id} p={p} properties={properties} onValidate={(pp) => applyMut.mutate({ bank_transaction_id: pp.bank_transaction_id, decision: 'validate' })} onModify={(pp) => setEditing(pp)} onIgnore={(pp) => applyMut.mutate({ bank_transaction_id: pp.bank_transaction_id, decision: 'ignore' })} />)}
            </div>
          </CardContent>
        </Card>
      )}

      {toIdentify.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="w-4 h-4 text-red-500" /> À vérifier</div>
            <p className="text-xs text-muted-foreground">Le moteur n'a pas de rapprochement fiable. Affectez manuellement une catégorie et un bien.</p>
            <div className="space-y-2">
              {toIdentify.map((p) => <ProposalRow key={p.bank_transaction_id} p={p} properties={properties} onValidate={null} onModify={(pp) => setEditing(pp)} onIgnore={(pp) => applyMut.mutate({ bank_transaction_id: pp.bank_transaction_id, decision: 'ignore' })} />)}
            </div>
          </CardContent>
        </Card>
      )}

      {editing && (
        <ModifyDialog
          p={editing} properties={properties}
          onClose={() => setEditing(null)}
          onApply={(override) => {
            applyMut.mutate({ bank_transaction_id: editing.bank_transaction_id, decision: 'modify', override });
            setEditing(null);
          }}
          applying={applyMut.isPending}
        />
      )}
    </div>
  );
}

function ProposalRow({ p, properties, onValidate, onModify, onIgnore }) {
  return (
    <div className="rounded-lg border border-border p-3 bg-muted/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDateFR(p.date)}</span>
            <span className="text-xs font-medium truncate">{p.raw_description}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className={cn('text-sm font-semibold number-fr', p.amount >= 0 ? 'text-emerald-600' : 'text-red-500')}>{formatCurrency(p.amount)}</span>
            <Badge variant="outline" className="text-[10px]">{labelOf(p.transaction_patch?.category)}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{p.reason}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onValidate && <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => onValidate(p)}><Check className="w-3.5 h-3.5" /> Valider</Button>}
          <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => onModify(p)}><Pencil className="w-3.5 h-3.5" /> Modifier</Button>
          <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={() => onIgnore(p)}><X className="w-3.5 h-3.5" /> Ignorer</Button>
        </div>
      </div>
    </div>
  );
}

function ModifyDialog({ p, properties, onClose, onApply, applying }) {
  const [category, setCategory] = useState(p.transaction_patch?.category || 'other_expense');
  const [propertyId, setPropertyId] = useState(p.transaction_patch?.property_id || '');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border p-4 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="font-medium text-sm">Modifier le rapprochement</div>
        <div className="text-xs text-muted-foreground truncate">{p.raw_description} · {formatCurrency(p.amount)}</div>
        <div className="space-y-2">
          <label className="text-xs font-medium">Catégorie</label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Catégorie" /></SelectTrigger>
            <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{labelOf(c)}</SelectItem>)}</SelectContent>
          </Select>
          <label className="text-xs font-medium">Bien</label>
          <Select value={propertyId} onValueChange={setPropertyId}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Bien obligatoire" /></SelectTrigger>
            <SelectContent>{properties.map((pr) => <SelectItem key={pr.id} value={pr.id}>{pr.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Annuler</Button>
          <Button size="sm" disabled={!propertyId || applying} onClick={() => onApply({ category, property_id: propertyId })}>Valider</Button>
        </div>
      </div>
    </div>
  );
}