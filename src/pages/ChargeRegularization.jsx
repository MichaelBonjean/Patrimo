// Régularisation des charges locatives
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Loader2, Scale } from 'lucide-react';
import RegularizationCard from '@/components/chargereg/RegularizationCard';

export default function ChargeRegularization() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear() - 1);
  const [leaseId, setLeaseId] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['charge-reg', year],
    queryFn: () => base44.functions.invoke('manageChargeRegularization', { op: 'analyze', year }).then((r) => r.data),
  });
  const rows = data?.rows || [];

  React.useEffect(() => {
    if (rows.length && !leaseId) setLeaseId(rows[0].lease.id);
  }, [rows, leaseId]);

  const row = useMemo(() => rows.find((r) => r.lease.id === leaseId) || null, [rows, leaseId]);

  const reload = () => qc.invalidateQueries({ queryKey: ['charge-reg', year] });

  const onSave = async (payload) => {
    if (!row) return;
    setBusy(true);
    try {
      await base44.functions.invoke('manageChargeRegularization', {
        op: 'save', id: row.record?.id, lease_id: row.lease.id, year,
        ventilation: payload.ventilation, justificatifs: payload.justificatifs, note: payload.note,
      });
      toast.success('Régularisation enregistrée.');
      reload();
    } catch (e) { toast.error(e?.message || 'Erreur'); }
    finally { setBusy(false); }
  };

  const onValidate = async (id) => {
    if (!id) { toast.error('Enregistrez d\'abord la régularisation.'); return; }
    setBusy(true);
    try {
      const res = await base44.functions.invoke('manageChargeRegularization', { op: 'validate', id });
      if (res.data.direction === 'du_locataire') toast.success('Régularisation validée — échéance créée dans le compte locataire.');
      else if (res.data.direction === 'rembourser_locataire') toast.success('Régularisation validée — somme à rembourser au locataire.');
      else toast.success('Régularisation validée (solde nul).');
      reload();
    } catch (e) { toast.error(e?.message || 'Erreur'); }
    finally { setBusy(false); }
  };

  const onDelete = async (id) => {
    setBusy(true);
    try {
      await base44.functions.invoke('manageChargeRegularization', { op: 'delete', id });
      toast.success('Régularisation supprimée.');
      reload();
    } catch (e) { toast.error(e?.message || 'Erreur'); }
    finally { setBusy(false); }
  };

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2, now.getFullYear() - 3];

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-[1100px]">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Scale className="w-6 h-6 text-primary" />Régularisation des charges
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Charges récupérables − provisions encaissées = solde. Charges propriétaire et charges récupérables jamais mélangées.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => { setYear(Number(v)); setLeaseId(''); }}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={leaseId} onValueChange={setLeaseId}>
            <SelectTrigger className="w-[240px]"><SelectValue placeholder="Choisir un bail" /></SelectTrigger>
            <SelectContent>
              {(rows || []).map((r) => (
                <SelectItem key={r.lease.id} value={r.lease.id}>
                  {r.lease.lot_designation || 'Bail'}{r.lease.property_name ? ` · ${r.lease.property_name}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Aucun bail pour l'exercice sélectionné.
        </div>
      ) : row ? (
        <RegularizationCard row={row} onSave={onSave} onValidate={onValidate} onDelete={onDelete} busy={busy} />
      ) : null}
    </div>
  );
}