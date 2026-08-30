// Révision des loyers — IRL / ILC / ILAT / aucune
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Loader2, TrendingUp, RefreshCw, Info } from 'lucide-react';
import RevisionCard from '@/components/rentindex/RevisionCard';

export default function RentIndexation() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['rent-revisions'],
    queryFn: () => base44.functions.invoke('manageRentRevision', { op: 'analyze' }).then((r) => r.data),
  });
  const proposals = data?.proposals || [];

  const act = async (op, payload) => {
    setBusy(true);
    try {
      await base44.functions.invoke('manageRentRevision', { op, ...payload });
      toast.success(op === 'validate' ? 'Proposition validée.' : op === 'apply' ? 'Nouveau loyer appliqué au bail.' : op === 'reject' ? 'Proposition refusée.' : 'Proposition recalculée.');
      qc.invalidateQueries({ queryKey: ['rent-revisions'] });
    } catch (e) {
      toast.error(e?.message || 'Erreur');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1280px]">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" />Révision des loyers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Calcul explicable IRL / ILC / ILAT. Aucune augmentation appliquée sans action du bailleur.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['rent-revisions'] })} disabled={isLoading || busy}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" />Recalculer
        </Button>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 text-blue-800 text-xs px-3 py-2 flex items-center gap-2">
        <Info className="w-3.5 h-3.5 shrink-0" />
        <span>Simulation indicative — la révision n'est appliquée au bail qu'après validation expresse du bailleur, puis action « Appliquer au bail ».</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : proposals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Aucun bail à indexer. Renseignez un type d'indexation (IRL/ILC/ILAT) et les indices sur les bails pour générer des propositions.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {proposals.map((p) => (
            <RevisionCard
              key={p.record?.id || p.lease?.id}
              p={p}
              onRecompute={(id, iv) => act('compute', { lease_id: id, new_index_value: iv })}
              onAction={(op, rid) => act(op, { rent_revision_id: rid })}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}