import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Calendar, Users, FileText, SquarePen } from 'lucide-react';
import { toast } from 'sonner';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { formatCurrency, formatDateFR } from '@/lib/formatters';
import LeaseForm from '@/components/property/LeaseForm';
import {
  groupLeasesByStatus, statusBadgeClass, statusLabel, computeLeaseStatus, todayISO,
} from '@/lib/lease';

export default function LeasesSection({ lot }) {
  const queryClient = useQueryClient();
  const { withOwner } = useOwnerFilter();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: leases = [] } = useQuery({
    queryKey: ['leases', lot?.id],
    queryFn: () => base44.entities.Lease.filter(withOwner({ lot_id: lot?.id })),
    enabled: !!lot?.id,
  });

  const endLease = useMutation({
    mutationFn: async (lease) => {
      const today = todayISO();
      return base44.entities.Lease.update(lease.id, {
        date_end: lease.date_end && lease.date_end < today ? lease.date_end : today,
        status: computeLeaseStatus({ date_start: lease.date_start, date_end: today }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leases'] });
      toast.success('Bail clôturé — l\'historique du lot est préservé');
    },
  });

  const groups = groupLeasesByStatus(leases);
  const today = todayISO();

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (l) => { setEditing(l); setShowForm(true); };

  const Row = ({ l }) => {
    const st = computeLeaseStatus(l, today);
    const tenants = l.tenants || [];
    return (
      <div className="flex items-center gap-3 p-2 rounded-md border border-border hover:bg-muted/30">
        <button className="flex-1 min-w-0 text-left" onClick={() => openEdit(l)}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">
              {tenants.map(t => t.name).join(', ') || 'Bail sans locataire'}
            </span>
            {tenants.length > 1 && <Badge variant="secondary" className="text-xs">Colocation ({tenants.length})</Badge>}
            <Badge className={`text-xs ${statusBadgeClass(st)}`}>{statusLabel(st)}</Badge>
          </div>
          <div className="flex items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5 flex-wrap">
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{formatDateFR(l.date_start)} → {l.date_end ? formatDateFR(l.date_end) : 'ouvert'}</span>
            <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{l.lease_type || '—'}</span>
            <span>{formatCurrency(l.rent_excluding_charges || 0)} HC</span>
            {l.charges > 0 && <span>+ {formatCurrency(l.charges)} ch.</span>}
            {l.indexation_type && l.indexation_type !== 'aucune' && <span>· {l.indexation_type}</span>}
          </div>
        </button>
        {st === 'actif' && (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => endLease.mutate(l)}>
            Clôturer
          </Button>
        )}
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(l)}><SquarePen className="w-3.5 h-3.5" /></Button>
      </div>
    );
  };

  const Section = ({ title, items, empty }) => (
    <div>
      <h5 className="text-xs font-semibold mb-1.5 text-muted-foreground uppercase tracking-wider">{title} ({items.length})</h5>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic pl-1">{empty}</p>
      ) : (
        <div className="space-y-1.5">{items.map(l => <Row key={l.id} l={l} />)}</div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-muted-foreground">BAUX</h4>
        <Button size="sm" variant="outline" onClick={openNew} className="h-7 gap-1 text-xs">
          <Plus className="w-3 h-3" />Nouveau bail
        </Button>
      </div>

      {leases.length === 0 ? (
        <div className="text-xs text-muted-foreground italic pl-1">
          Aucun bail enregistré. Les conditions locatives héritées du lot restent affichées ci-dessous tant que la migration n'est pas lancée.
        </div>
      ) : (
        <div className="space-y-3">
          <Section title="Bail actif" items={groups.actif} empty="Aucun bail actif" />
          <Section title="À venir" items={groups.futur} empty="Aucun bail à venir" />
          <Section title="Anciens baux" items={groups.termine} empty="Aucun ancien bail" />
          {groups.resilie.length > 0 && <Section title="Résiliés" items={groups.resilie} empty="" />}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifier le bail' : 'Nouveau bail'}</DialogTitle>
          </DialogHeader>
          <LeaseForm lease={editing} lot={lot} onClose={() => { setShowForm(false); setEditing(null); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}