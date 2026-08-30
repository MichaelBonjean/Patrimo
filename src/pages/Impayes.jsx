import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Clock, ChevronRight, CheckCircle2 } from 'lucide-react';
import ImpayeDetailDialog from '@/components/impayes/ImpayeDetailDialog';
import { formatImpayeStatus, getDaysOutstanding } from '@/lib/impayeUtils';
import EmptyState from '@/components/EmptyState';
import { IlloImpayes } from '@/components/illustrations/EmptyIllustrations';
import { formatCurrency } from '@/lib/formatters';
import { stageOf } from '@/lib/recouvrementTemplates';

const TABS = [
  { key: 'actifs', label: 'Dettes en cours' },
  { key: 'régularisés', label: 'Régularisées' },
  { key: 'tous', label: 'Toutes' },
];

export default function Impayes() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('actifs');
  const [selected, setSelected] = useState(null);

  const { data: user } = useQuery({ queryKey: ['me'], queryFn: () => base44.auth.me() });
  const { data: impayes = [], isLoading } = useQuery({
    queryKey: ['impayes'],
    queryFn: () => base44.entities.Impaye.filter({}, '-detected_date', 200),
  });
  const { data: leases = [] } = useQuery({ queryKey: ['leases'], queryFn: () => base44.entities.Lease.filter({}, '-created_date', 200) });
  const { data: properties = [] } = useQuery({ queryKey: ['properties'], queryFn: () => base44.entities.Property.list() });
  const { data: lots = [] } = useQuery({ queryKey: ['lots'], queryFn: () => base44.entities.Lot.list() });

  const leaseById = new Map(leases.map((l) => [l.id, l]));
  const propById = new Map(properties.map((p) => [p.id, p]));
  const lotById = new Map(lots.map((l) => [l.id, l]));

  const refresh = () => qc.invalidateQueries({ queryKey: ['impayes'] });

  const filtered = impayes.filter((i) => {
    if (tab === 'actifs') return i.status !== 'régularisé' && i.status !== 'abandonné';
    if (tab === 'régularisés') return i.status === 'régularisé';
    return true;
  });

  const totalDette = impayes
    .filter((i) => i.status !== 'régularisé' && i.status !== 'abandonné')
    .reduce((s, i) => s + (i.outstanding_amount ?? i.missing_amount ?? 0), 0);

  const selectedLandlord = selected ? {
    name: user?.full_name || 'Le bailleur',
    email: user?.email || '',
    address: propById.get(selected.property_id)?.landlord_address || '',
  } : null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">Dettes locatives — recouvrement</h1>
        <p className="text-sm text-muted-foreground">
          Workflow de recouvrement clair. Documents du bailleur distingués des actes nécessitant un
          commissaire de justice ou un avocat. Aucun courrier généré n'est un acte de procédure.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Dettes en cours</p>
          <p className="text-lg font-bold text-red-600">{formatCurrency(totalDette)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Nombre d'impayés actifs</p>
          <p className="text-lg font-bold">
            {impayes.filter((i) => i.status !== 'régularisé' && i.status !== 'abandonné').length}
          </p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Plus ancien retard</p>
          <p className="text-lg font-bold">
            {Math.max(0, ...impayes.filter((i)=>i.status!=='régularisé'&&i.status!=='abandonné').map((i)=>i.late_days||0))} j
          </p>
        </CardContent></Card>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          illustration={<IlloImpayes />}
          title="Aucun impayé"
          subtitle="Bravo, vos locataires sont ponctuels. Le moteur de détection surveille chaque échéance pour vous."
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((imp) => {
            const days = imp.late_days || getDaysOutstanding(imp.period);
            const isCritical = days > 30;
            const st = formatImpayeStatus(imp.status);
            const stage = stageOf(imp.status);
            const lease = leaseById.get(imp.lease_id);
            const property = propById.get(imp.property_id);
            const lot = lotById.get(imp.lot_id);
            return (
              <button
                key={imp.id}
                onClick={() => setSelected({ imp, lease, property, lot })}
                className={`w-full text-left rounded-xl border p-3 transition-colors hover:bg-muted/40 ${
                  isCritical ? 'border-red-300 bg-red-50/40' : 'border-border bg-card'
                }`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{imp.tenant_name}</span>
                      <Badge variant="secondary" className={`text-xs ${st.className}`}>{st.label}</Badge>
                      {isCritical && (
                        <Badge className="text-xs bg-red-600 text-white"><Clock className="w-3 h-3 mr-1" />J+{days}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {imp.property_name} — {imp.lot_designation} · échéance {imp.period}
                    </p>
                    <p className="text-sm font-semibold mt-1">
                      {formatCurrency(imp.outstanding_amount ?? imp.missing_amount)}
                      <span className="text-xs font-normal text-muted-foreground"> restant sur {formatCurrency(imp.expected_amount)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{days} j</span>
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <ImpayeDetailDialog
          impaye={selected.imp}
          lease={selected.lease}
          property={selected.property}
          lot={selected.lot}
          landlord={selectedLandlord}
          open={!!selected}
          onOpenChange={(o) => !o && setSelected(null)}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}