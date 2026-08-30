import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Wallet, Plus, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { toast } from 'sonner';
import DueStatusBadge from '@/components/rentledger/DueStatusBadge';
import PaymentDialog from '@/components/rentledger/PaymentDialog';

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const monthFR = (p) => {
  const [y, m] = p.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};

const PAYER_LABEL = {
  tenant: 'Locataire', caf: 'CAF / APL', guarantor: 'Garant',
  insurance: 'Assurance', other: 'Autre',
};

export default function RentLedger() {
  const qc = useQueryClient();
  const [leaseId, setLeaseId] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: leases = [], isLoading: lLoading } = useQuery({
    queryKey: ['rl-leases'],
    queryFn: async () => base44.entities.Lease.list('-created_date', 500),
  });
  const { data: props = [] } = useQuery({
    queryKey: ['rl-props'],
    queryFn: async () => base44.entities.Property.list(500),
  });
  const { data: lots = [] } = useQuery({
    queryKey: ['rl-lots'],
    queryFn: async () => base44.entities.Lot.list(500),
  });

  const propById = useMemo(() => new Map(props.map((p) => [p.id, p])), [props]);
  const lotById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots]);

  const leaseOptions = useMemo(() => leases.map((l) => {
    const p = propById.get(l.property_id);
    const lot = lotById.get(l.lot_id);
    const tenant = (l.tenants || [])[0]?.name || l.tenant_name || '';
    return {
      id: l.id,
      label: `${p?.name || 'Bien ?'} — ${lot?.designation || 'Lot ?'}${tenant ? ' · ' + tenant : ''}`,
      monthly: (Number(l.rent_excluding_charges) || 0) + (Number(l.charges) || 0),
    };
  }), [leases, propById, lotById]);

  const ledgerKey = ['rl-ledger', leaseId];
  const { data: ledger, isLoading: llLoading } = useQuery({
    queryKey: ledgerKey,
    queryFn: async () => {
      if (!leaseId) return { dues: [], payments: [] };
      const [dues, payments] = await Promise.all([
        base44.entities.RentDue.filter({ lease_id: leaseId }),
        base44.entities.Payment.filter({ lease_id: leaseId }),
      ]);
      return {
        dues: dues.sort((a, b) => String(a.period).localeCompare(String(b.period))),
        payments: payments.sort((a, b) => String(b.date).localeCompare(String(a.date))),
      };
    },
    enabled: !!leaseId,
  });

  const selected = leases.find((l) => l.id === leaseId);
  const monthly = selected ? (Number(selected.rent_excluding_charges) || 0) + (Number(selected.charges) || 0) : 0;
  const dues = ledger?.dues || [];
  const payments = ledger?.payments || [];

  const totals = useMemo(() => {
    const totalDue = dues.reduce((s, d) => s + (d.total_due || 0), 0);
    const totalPaid = dues.reduce((s, d) => s + (d.paid_amount || 0), 0);
    const reste = dues.reduce((s, d) => s + Math.max(0, d.balance || 0), 0);
    const credit = payments.reduce((s, p) => s + (p.unallocated || 0), 0);
    return { totalDue, totalPaid, reste, credit };
  }, [dues, payments]);

  async function generate() {
    if (!leaseId) return;
    try {
      const r = await base44.functions.invoke('generateRentDues', { lease_id: leaseId, backfill_months: 6, forward_months: 2 });
      toast.success(`${r.data?.created || 0} échéance(s) générée(s)`);
      qc.invalidateQueries({ queryKey: ['rl-ledger', leaseId] });
    } catch (e) {
      toast.error(e?.message || 'Génération impossible');
    }
  }

  function onSaved() {
    setDialogOpen(false);
    qc.invalidateQueries({ queryKey: ['rl-ledger', leaseId] });
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Compte locataire</h1>
            <p className="text-sm text-muted-foreground">Échéances et paiements de loyer — source de vérité locative</p>
          </div>
        </div>
        <div className="w-full md:w-80">
          {lLoading ? <Skeleton className="h-9 w-full" /> : (
            <Select value={leaseId} onValueChange={setLeaseId}>
              <SelectTrigger><SelectValue placeholder="Sélectionner un bail…" /></SelectTrigger>
              <SelectContent>
                {leaseOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {!leaseId ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <ArrowLeftRight className="w-8 h-8 mx-auto mb-3 opacity-40" />
            Choisissez un bail pour afficher son compte locataire.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Loyer mensuel</p>
              <p className="text-lg font-semibold">{eur.format(monthly)}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Total dû (période)</p>
              <p className="text-lg font-semibold">{eur.format(totals.totalDue)}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Encaissé</p>
              <p className="text-lg font-semibold text-emerald-600">{eur.format(totals.totalPaid)}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-4">
              <p className="text-xs text-muted-foreground">Reste à percevoir</p>
              <p className={`text-lg font-semibold ${totals.reste > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {eur.format(totals.reste)}
              </p>
            </CardContent></Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setDialogOpen(true)}><Plus className="w-4 h-4" /> Encaisser un loyer</Button>
            <Button variant="outline" onClick={generate}><RefreshCw className="w-4 h-4" /> Générer / actualiser les échéances</Button>
            {totals.credit > 0 && (
              <span className="inline-flex items-center text-sm text-indigo-600 font-medium self-center px-2">
                Crédit / avoir en attente : {eur.format(totals.credit)}
              </span>
            )}
          </div>

          {/* Due échéances */}
          <Card>
            <CardHeader><CardTitle className="text-base">Échéances</CardTitle></CardHeader>
            <CardContent className="p-0">
              {llLoading ? (
                <div className="p-4 space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
              ) : dues.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Aucune échéance. Cliquez sur « Générer les échéances ».
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="text-left font-medium px-4 py-2">Période</th>
                        <th className="text-left font-medium px-4 py-2">Échéance</th>
                        <th className="text-right font-medium px-4 py-2">Loyer HC</th>
                        <th className="text-right font-medium px-4 py-2">Charges</th>
                        <th className="text-right font-medium px-4 py-2">Dû</th>
                        <th className="text-right font-medium px-4 py-2">Payé</th>
                        <th className="text-right font-medium px-4 py-2">Reste</th>
                        <th className="text-center font-medium px-4 py-2">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dues.map((d) => (
                        <tr key={d.id} className="border-t">
                          <td className="px-4 py-2 capitalize">{monthFR(d.period)}</td>
                          <td className="px-4 py-2 text-muted-foreground">{d.due_date}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{eur.format(d.rent_excluding_charges || 0)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{eur.format(d.charges || 0)}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">{eur.format(d.total_due || 0)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-emerald-600">{eur.format(d.paid_amount || 0)}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">{eur.format(d.balance || 0)}</td>
                          <td className="px-4 py-2 text-center"><DueStatusBadge status={d.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Paiements */}
          <Card>
            <CardHeader><CardTitle className="text-base">Paiements</CardTitle></CardHeader>
            <CardContent className="p-0">
              {payments.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Aucun paiement enregistré pour ce bail.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="text-left font-medium px-4 py-2">Date</th>
                        <th className="text-right font-medium px-4 py-2">Montant</th>
                        <th className="text-left font-medium px-4 py-2">Payeur</th>
                        <th className="text-left font-medium px-4 py-2">Moyen</th>
                        <th className="text-left font-medium px-4 py-2">Affecté sur</th>
                        <th className="text-right font-medium px-4 py-2">Non affecté</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => {
                        const allocs = (p.allocations || []).map((a) => {
                          const due = dues.find((d) => d.id === a.rent_due_id);
                          return due ? `${monthFR(due.period)} (${eur.format(a.amount)})` : '';
                        }).filter(Boolean).join(' · ');
                        return (
                          <tr key={p.id} className="border-t">
                            <td className="px-4 py-2">{p.date}</td>
                            <td className="px-4 py-2 text-right tabular-nums font-medium">{eur.format(p.amount || 0)}</td>
                            <td className="px-4 py-2">
                              {PAYER_LABEL[p.payer_type] || p.payer_type}
                              {p.payer_name ? <span className="text-muted-foreground"> — {p.payer_name}</span> : ''}
                            </td>
                            <td className="px-4 py-2 capitalize">{p.method || '—'}</td>
                            <td className="px-4 py-2 text-muted-foreground">{allocs || '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {p.unallocated > 0 ? <span className="text-indigo-600 font-medium">{eur.format(p.unallocated)}</span> : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <PaymentDialog open={dialogOpen} onClose={(saved) => saved ? onSaved() : setDialogOpen(false)} leaseId={leaseId} defaultAmount={monthly} />
    </div>
  );
}