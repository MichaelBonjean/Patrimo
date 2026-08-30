import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, Wallet, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import EmptyState from '@/components/EmptyState';
import { IlloLoyers } from '@/components/illustrations/EmptyIllustrations';
import DueStatusBadge from '@/components/rentledger/DueStatusBadge';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { formatCurrency } from '@/lib/formatters';

const STATUS_ORDER = { unpaid: 0, partial: 1, overpaid: 2, paid: 3 };

/**
 * Tab "Compte locataire" de la page Loyers : liste par locataire du mois choisi,
 * statut par échéance (Payé / Partiel / Impayé) et encaissement one-click du solde restant.
 * Partage la queryKey ['loyers-dues', period] avec l'en-tête KPI de la page.
 */
export default function MonthCollections({ period }) {
  const qc = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const [busyId, setBusyId] = useState(null);

  const { data: dues = [], isLoading } = useQuery({
    queryKey: ['loyers-dues', period],
    queryFn: () => base44.entities.RentDue.filter(withOwner({ period }), undefined, 500),
  });
  const { data: leases = [] } = useQuery({ queryKey: ['loyers-leases'], queryFn: () => base44.entities.Lease.filter(withOwner()) });
  const { data: lots = [] } = useQuery({ queryKey: ['loyers-lots'], queryFn: () => base44.entities.Lot.filter(withOwner()) });
  const { data: properties = [] } = useQuery({ queryKey: ['loyers-props'], queryFn: () => base44.entities.Property.filter(withOwner()) });

  const leaseById = useMemo(() => new Map(leases.map((l) => [l.id, l])), [leases]);
  const lotById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots]);
  const propById = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);

  const rows = useMemo(() => {
    return dues
      .map((d) => {
        const lease = leaseById.get(d.lease_id) || {};
        const lot = lotById.get(d.lot_id) || {};
        const property = propById.get(d.property_id || lease.property_id) || {};
        const tenantName = d.tenant_name || (lease.tenants || [])[0]?.name || 'Locataire';
        const reste = Math.max(0, Number(d.balance) || 0);
        return {
          due: d,
          tenantName,
          property: property.name || '—',
          lot: lot.designation || lot.code || 'Lot',
          totalDue: Number(d.total_due) || 0,
          paid: Number(d.paid_amount) || 0,
          reste,
          status: d.status,
        };
      })
      .sort(
        (a, b) =>
          (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
          a.tenantName.localeCompare(b.tenantName)
      );
  }, [dues, leaseById, lotById, propById]);

  async function quickPay(d) {
    const reste = Math.max(0, Number(d.balance) || 0);
    if (reste <= 0) return;
    setBusyId(d.id);
    try {
      await base44.functions.invoke('recordPayment', {
        lease_id: d.lease_id,
        date: new Date().toISOString().slice(0, 10),
        amount: reste,
        payer_type: 'tenant',
        method: 'virement',
        allocations: [{ rent_due_id: d.id, amount: reste }],
      });
      toast.success(`${formatCurrency(reste)} encaissé — ${d.tenant_name || ''}`);
      qc.invalidateQueries({ queryKey: ['loyers-dues', period] });
      qc.invalidateQueries({ queryKey: ['impayes'] });
    } catch (e) {
      toast.error(e?.message || "Échec de l'enregistrement");
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        illustration={<IlloLoyers />}
        title="Aucun loyer à afficher"
        subtitle="Créez un bail pour commencer à suivre vos encaissements. Les échéances du mois apparaîtront ici."
        primary={<Link to="/biens/nouveau"><Button className="gap-2"><Plus className="w-4 h-4" />Créer un bail</Button></Link>}
      />
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const canPay = r.reste > 0 && busyId !== r.due.id;
        return (
          <Card key={r.due.id} className="p-4 flex flex-wrap items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm truncate">{r.tenantName}</p>
              <p className="text-xs text-muted-foreground truncate">{r.property} — {r.lot}</p>
            </div>
            <div className="hidden sm:block text-right text-sm shrink-0 pr-2">
              <p className="text-xs text-muted-foreground">Dû {formatCurrency(r.totalDue)} · payé {formatCurrency(r.paid)}</p>
              <p className="text-xs font-medium text-muted-foreground">Reste {formatCurrency(r.reste)}</p>
            </div>
            <div className="shrink-0"><DueStatusBadge status={r.status} /></div>
            {r.reste > 0 ? (
              <Button
                size="sm"
                onClick={() => quickPay(r.due)}
                disabled={busyId === r.due.id}
                className="gap-1.5 shrink-0"
              >
                <CheckCircle2 className="w-4 h-4" />
                {busyId === r.due.id ? '…' : 'Marquer payé'}
              </Button>
            ) : (
              <span className="text-xs text-emerald-600 font-medium shrink-0 w-[110px] text-right">Soldé</span>
            )}
          </Card>
        );
      })}
    </div>
  );
}