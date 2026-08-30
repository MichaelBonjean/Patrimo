import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeftRight, Link2, Sparkles, Unlink, Check } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { detectTransferPairs, groupLinkedPairs } from '@/lib/transferEngine';
import { labelOf } from '@/lib/financeCategories';

const propName = (list, id) => list.find((p) => p.id === id)?.name || '—';
const periodLabel = (p) => p;

export default function TransferManager({ properties, transactions }) {
  const queryClient = useQueryClient();
  const [candidates, setCandidates] = useState(null);
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);

  // Liage manuel : sélection de deux transactions (une expense, une income)
  const [outId, setOutId] = useState('');
  const [inId, setInId] = useState('');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['transactions-all'] });
    queryClient.invalidateQueries({ queryKey: ['bank-imports'] });
  };

  const linkedPairs = useMemo(() => groupLinkedPairs(transactions), [transactions]);
  const unmatchedTx = useMemo(
    () => transactions.filter((t) => !t.transfer_pair_id && (t.type === 'income' || t.type === 'expense')),
    [transactions],
  );
  const expenseTx = unmatchedTx.filter((t) => t.type === 'expense');
  const incomeTx = unmatchedTx.filter((t) => t.type === 'income');

  const detect = async () => {
    setDetecting(true);
    try {
      const cands = detectTransferPairs(transactions, { tolerance_periods: 1 });
      setCandidates(cands);
      if (cands.length === 0) toast.info('Aucun virement inter-comptes détecté');
      else toast.success(`${cands.length} paire(s) candidate(s)`);
    } finally {
      setDetecting(false);
    }
  };

  const invoke = async (payload) => {
    setBusy(true);
    try {
      // base44.functions.invoke renvoie une réponse axios : la payload est dans `.data`.
      const r = await base44.functions.invoke('manageInternalTransfers', payload);
      const res = r?.data ?? r;
      if (res?.error) throw new Error(res.error);
      return res;
    } finally {
      setBusy(false);
    }
  };

  const validatePair = async (c) => {
    try {
      const res = await invoke({ action: 'link', out_tx_id: c.out_tx_id, in_tx_id: c.in_tx_id });
      if (res?.warning) toast.warning(res.warning);
      toast.success('Paire validée — flux neutralisé');
      setCandidates((cur) => (cur || []).filter((x) => x.out_tx_id !== c.out_tx_id));
      refresh();
    } catch (e) {
      toast.error(e.message || 'Échec du liage');
    }
  };

  const applyAll = async () => {
    if (!confirm(`Valider et lier les ${candidates?.length || 0} paires détectées ?`)) return;
    try {
      const res = await invoke({ action: 'apply' });
      toast.success(`${res?.applied_pairs || 0} paire(s) liée(s) automatiquement`);
      setCandidates(null);
      refresh();
    } catch (e) {
      toast.error(e.message || 'Échec');
    }
  };

  const manualLink = async () => {
    if (!outId || !inId) return;
    try {
      const res = await invoke({ action: 'link', out_tx_id: outId, in_tx_id: inId });
      if (res?.warning) toast.warning(res.warning);
      toast.success('Transactions liées — flux neutralisé');
      setOutId(''); setInId('');
      refresh();
    } catch (e) {
      toast.error(e.message || 'Échec du liage');
    }
  };

  const unlink = async (transaction_id) => {
    try {
      await invoke({ action: 'unlink', transaction_id });
      toast.success('Paire déliée');
      refresh();
    } catch (e) {
      toast.error(e.message || 'Échec');
    }
  };

  return (
    <div className="space-y-5">
      {/* Bandeau explicatif */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex gap-3">
        <ArrowLeftRight className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
        <div className="text-sm text-slate-700 space-y-1">
          <p className="font-medium">Virements inter-comptes (flux internes neutres)</p>
          <p className="text-muted-foreground">
            Un virement entre deux de vos comptes ne doit ni gonfler les revenus ni les dépenses consolidés : once liée,
            la paire est neutralisée (catégorie « Virement inter-comptes »). En vue d'un compte individuel, le flux reste
            visible mais identifié comme transfert.
          </p>
        </div>
      </div>

      {/* Détection automatique */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Détection automatique</span>
            <span className="text-xs text-muted-foreground">Même montant · sens opposé · période proche · comptes distincts</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={detecting || busy} onClick={detect}>
              <Sparkles className="w-3.5 h-3.5" /> {detecting ? 'Détection…' : 'Détecter les paires'}
            </Button>
            {candidates && candidates.length > 0 && (
              <Button size="sm" disabled={busy} onClick={applyAll}>
                <Check className="w-3.5 h-3.5" /> Tout valider ({candidates.length})
              </Button>
            )}
          </div>
        </div>

        {candidates !== null && (
          <div className="overflow-x-auto">
            {candidates.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Aucune paire candidate.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Compte émetteur (sortie)</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Compte destinataire (entrée)</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Montant</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Période</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Indice</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr key={c.out_tx_id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-4 py-2 text-xs">{propName(properties, transactions.find((t) => t.id === c.out_tx_id)?.property_id)}</td>
                      <td className="px-4 py-2 text-xs">{propName(properties, transactions.find((t) => t.id === c.in_tx_id)?.property_id)}</td>
                      <td className="px-4 py-2 text-right number-fr text-xs font-medium">{formatCurrency(c.amount)}</td>
                      <td className="px-4 py-2 text-xs">{c.out_period}{c.period_gap > 0 ? ` → ${c.in_period}` : ''}</td>
                      <td className="px-4 py-2">
                        <Badge variant={c.confidence === 'high' ? 'default' : 'secondary'} className="text-xs">{c.confidence === 'high' ? 'Élevé' : 'Moyen'}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => validatePair(c)}>
                          <Link2 className="w-3.5 h-3.5" /> Valider
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Liage manuel */}
      <div className="bg-card border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Lier manuellement deux transactions</span>
        </div>
        <p className="text-xs text-muted-foreground">Sélectionnez une sortie (compte émetteur) et une entrée (compte destinataire) sur deux comptes distincts.</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Select value={outId} onValueChange={setOutId}>
            <SelectTrigger><SelectValue placeholder="Sortie (compte émetteur)" /></SelectTrigger>
            <SelectContent>
              {expenseTx.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {propName(properties, t.property_id)} · {formatCurrency(Math.abs(t.amount))} · {t.year}-{String(t.month).padStart(2, '0')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={inId} onValueChange={setInId}>
            <SelectTrigger><SelectValue placeholder="Entrée (compte destinataire)" /></SelectTrigger>
            <SelectContent>
              {incomeTx.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {propName(properties, t.property_id)} · {formatCurrency(Math.abs(t.amount))} · {t.year}-{String(t.month).padStart(2, '0')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={busy || !outId || !inId} onClick={manualLink}>
            <Link2 className="w-4 h-4" /> Lier
          </Button>
        </div>
      </div>

      {/* Paires déjà liées */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Virements inter-comptes liés</span>
          {linkedPairs.length > 0 && <Badge variant="secondary" className="text-xs">{linkedPairs.length}</Badge>}
        </div>
        {linkedPairs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Aucun virement lié pour l'instant.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Émetteur (sortie)</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Destinataire (entrée)</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Montant</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Origine</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {linkedPairs.map((p) => (
                  <tr key={p.out.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-4 py-2 text-xs">{propName(properties, p.out.property_id)} · {p.out.period || `${p.out.year}-${String(p.out.month).padStart(2, '0')}`}</td>
                    <td className="px-4 py-2 text-xs">{propName(properties, p.in.property_id)} · {p.in.period || `${p.in.year}-${String(p.in.month).padStart(2, '0')}`}</td>
                    <td className="px-4 py-2 text-right number-fr text-xs font-medium">{formatCurrency(Math.abs(p.out.amount))}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="text-xs">{p.method === 'auto' ? 'Auto' : 'Manuel'}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => unlink(p.out.id)}>
                        <Unlink className="w-3.5 h-3.5" /> Délier
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}