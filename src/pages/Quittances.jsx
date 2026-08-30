// Quittances de loyer — pilotées par le compte locataire réel (RentDue / Payments).
// Une quittance n'est jamais émise sur la base du loyer théorique du bail :
// elle reflète ce qui a réellement été réglé sur la période.
import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  FileText, Download, Mail, Users, AlertTriangle, FilePlus2, ArrowLeft, Send, CircleSlash,
} from 'lucide-react';
import { formatCurrency, getMonthName } from '@/lib/formatters';
import { useOwnerFilter } from '@/lib/tenantFilter';
import { toast } from 'sonner';
import OnboardingEmptyState from '@/components/OnboardingEmptyState';
import EmptyState from '@/components/EmptyState';
import { IlloQuittances } from '@/components/illustrations/EmptyIllustrations';
import { Link } from 'react-router-dom';
import { quittanceToPdfRow, buildSingleQuittance, periodLabel, resolveEligibility } from '@/lib/quittanceReport';
import { pickLeaseForPeriod, effectiveTenants } from '@/lib/lease';
import EmertreDialog from '@/components/quittances/EmertreDialog';
import { triggerMilestone } from '@/lib/celebrations';
import SlowLoadingMessage from '@/components/ui/SlowLoadingMessage';

export default function Quittances({ period: controlledPeriod, onPeriodChange }) {
  const { user } = useAuth();
  const { withOwner } = useOwnerFilter();
  const queryClient = useQueryClient();

  const now = new Date();
  const [internalPeriod, setInternalPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const period = controlledPeriod || internalPeriod;
  const setPeriod = onPeriodChange || setInternalPeriod;
  const [generating, setGenerating] = useState(false);
  const [emitRow, setEmitRow] = useState(null);
  const [selectedLotId, setSelectedLotId] = useState(null);

  const { data: lots = [] } = useQuery({ queryKey: ['lots'], queryFn: () => base44.entities.Lot.filter(withOwner()) });
  const { data: properties = [] } = useQuery({ queryKey: ['properties'], queryFn: () => base44.entities.Property.filter(withOwner()) });
  const { data: quittances = [] } = useQuery({ queryKey: ['quittances'], queryFn: () => base44.entities.Quittance.filter(withOwner(), '-created_date', 200) });
  const { data: leases = [] } = useQuery({ queryKey: ['leases'], queryFn: () => base44.entities.Lease.filter(withOwner()) });
  const { data: rentDues = [] } = useQuery({ queryKey: ['rentdues'], queryFn: () => base44.entities.RentDue.filter(withOwner(), undefined, 500) });
  const { data: payments = [] } = useQuery({ queryKey: ['payments'], queryFn: () => base44.entities.Payment.filter(withOwner(), undefined, 500) });

  const year = parseInt(period.slice(0, 4), 10);
  const month = parseInt(period.slice(5, 7), 10);
  const getProperty = (id) => properties.find((p) => p.id === id) || {};

  // Lignes "compte locataire" par bail actif sur la période + éligibilité quittance.
  const ledgerRows = useMemo(() => {
    return lots
      .map((lot) => {
        const lotLeases = leases.filter((l) => l.lot_id === lot.id);
        const lease = pickLeaseForPeriod(lotLeases, year, month);
        if (!lease) return null; // pas de bail sur cette période -> hors périmètre
        const property = getProperty(lot.property_id);
        const eligibility = resolveEligibility(lease.id, rentDues, payments, { year, month });
        const fullAddr = `${property.address || ''}${property.postal_code ? ' ' + property.postal_code : ''}${property.city ? ' ' + property.city : ''}`.trim();
        const landlordName = user?.full_name || property.landlord_email || 'Bailleur';
        const landlordAddress = property.landlord_address || fullAddr;
        return {
          lot, property, lease,
          year, month, period,
          ownerEmail: user?.email,
          tenantName: (lease.tenants || []).map((t) => t.name).filter(Boolean).join(', ') || '—',
          tenantEmail: (effectiveTenants(lot, lotLeases)[0] || {}).email || '',
          tenantAddress: fullAddr,
          landlordName, landlordAddress,
          propertyName: property.name || '—',
          lotDesignation: lot.designation || lot.code || 'Lot',
          lotAddress: fullAddr,
          eligibility,
        };
      })
      .filter(Boolean);
  }, [lots, properties, leases, rentDues, payments, year, month, user, period]);

  const issuedMap = useMemo(() => {
    const m = new Map();
    for (const q of quittances) {
      const key = (q.lease_id ? `L:${q.lease_id}` : `lot:${q.lot_id}`) + `${q.year}-${String(q.month).padStart(2, '0')}`;
      if (!m.has(key)) m.set(key, q);
    }
    return m;
  }, [quittances]);

  const issuedKey = (r) => `${r.lease.id}${r.year}-${String(r.month).padStart(2, '0')}`;
  const monthLabelStr = periodLabel(year, month);

  // Éligibles à l'émission (solde soldé OU partiel), non déjà émises.
  const toGenerate = useMemo(
    () => ledgerRows.filter((r) => r.eligibility.kind !== 'none' && !issuedMap.has(issuedKey(r))),
    [ledgerRows, issuedMap, period]
  );
  const blockedRows = ledgerRows.filter((r) => r.eligibility.kind === 'none');

  // Génération groupée (PDFs individuels) via generateQuittance (snapshot immuable serveur).
  const handleGenerate = async () => {
    if (toGenerate.length === 0) {
      toast.error('Aucune quittance à émettre (soldées déjà émises ou impayées)');
      return;
    }
    setGenerating(true);
    try {
      let ok = 0, failed = 0;
      for (const r of toGenerate) {
        try {
          const res = await base44.functions.invoke('generateQuittance', {
            lease_id: r.lease.id, year: r.year, month: r.month,
          });
          const data = res.data;
          if (!data.ok) { failed++; continue; }
          const q = data.quittance;
          buildSingleQuittance(quittanceToPdfRow(q)).save(`${q.receipt_number}.pdf`);
          ok++;
          await new Promise((res) => setTimeout(res, 200));
        } catch (_e) { failed++; }
      }
      queryClient.invalidateQueries({ queryKey: ['quittances'] });
      if (ok > 0) { try { await triggerMilestone('first_quittance'); } catch { /* noop */ } }
      if (failed === 0) toast.success(`${ok} quittance(s) émise(s)`);
      else toast.warning(`${ok} émise(s) · ${failed} échec(s)`);
    } finally {
      setGenerating(false);
    }
  };

  const onEmitted = () => queryClient.invalidateQueries({ queryKey: ['quittances'] });

  const downloadSingle = (q) => buildSingleQuittance(quittanceToPdfRow(q)).save(`${q.receipt_number}.pdf`);

  const resendEmail = async (q) => {
    let email = '';
    const leaseOf = leases.find((l) => l.id === q.lease_id) || leases.find((l) => l.id && l.lot_id === q.lot_id);
    if (leaseOf) {
      const t = (leaseOf.tenants || []).find((tn) => (q.tenant_name || '').includes(tn.name));
      if (t?.email) email = t.email;
    }
    if (!email) {
      const lot = lots.find((l) => l.id === q.lot_id);
      if (lot) {
        const t = (lot.tenants || []).find((tn) => (q.tenant_name || '').includes(tn.name));
        if (t?.email) email = t.email;
        else if (lot.tenant_email) email = lot.tenant_email;
      }
    }
    if (!email) { toast.error("Email du locataire introuvable"); return; }
    try {
      const partial = q.kind === 'partial';
      await base44.integrations.Core.SendEmail({
        to: email,
        subject: `${partial ? 'Reçu de loyer' : 'Quittance de loyer'} — ${getMonthName(q.month)} ${q.year}`,
        body:
          `Bonjour ${q.tenant_name},\n\n` +
          `Veuillez trouver votre ${partial ? 'reçu de loyer' : 'quittance de loyer'} pour ${getMonthName(q.month)} ${q.year}.\n\n` +
          `Total payé : ${formatCurrency(q.paid_amount ?? q.total)}\n` +
          (partial ? `Reste à payer : ${formatCurrency(q.balance)}\n` : '') +
          `\nCordialement,\n${q.landlord_name}`,
      });
      await base44.entities.Quittance.update(q.id, { status: 'sent', sent_by_email: true, sent_date: new Date().toISOString().slice(0, 10) });
      queryClient.invalidateQueries({ queryKey: ['quittances'] });
      toast.success('Email envoyé (si destinataire enregistré)');
    } catch (_e) {
      await base44.entities.Quittance.update(q.id, { status: 'failed' });
      toast.error("Échec de l'envoi — destinataire sans doute non enregistré");
    }
  };

  const statusBadge = (s) => {
    if (s === 'sent') return <Badge className="bg-emerald-600">Envoyée</Badge>;
    if (s === 'failed') return <Badge variant="destructive">Échec envoi</Badge>;
    return <Badge variant="secondary">Émise</Badge>;
  };
  const kindBadge = (k) => k === 'partial'
    ? <Badge className="bg-amber-500">Reçu partiel</Badge>
    : <Badge className="bg-blue-700">Quittance</Badge>;

  const eligibilityChip = (r) => {
    const k = r.eligibility.kind;
    if (k === 'none') return <Badge variant="outline" className="text-muted-foreground gap-1"><CircleSlash className="w-3 h-3" />{r.eligibility.reason === 'no_due' ? 'Pas d\'échéance' : 'Impayé'}</Badge>;
    if (k === 'partial') return <Badge className="bg-amber-500">Partiel {formatCurrency(r.eligibility.paid)}</Badge>;
    return <Badge className="bg-emerald-600">Soldé</Badge>;
  };

  if (properties.length === 0) {
    return (
      <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quittances</h1>
          <p className="text-sm text-muted-foreground mt-1">0 logement</p>
        </div>
        <OnboardingEmptyState icon={FileText} />
      </div>
    );
  }

  // ----- Onglet détail / historique d'un locataire -----
  if (selectedLotId) {
    const row = ledgerRows.find((r) => r.lot.id === selectedLotId);
    const tenantQuittances = quittances
      .filter((q) => q.lot_id === selectedLotId || q.lease_id === row?.lease?.id)
      .sort((a, b) => (b.year - a.year) * 100 + (b.month - a.month));

    return (
      <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
        <button onClick={() => setSelectedLotId(null)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Retour aux quittances
        </button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{row?.tenantName || 'Locataire'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {row?.propertyName} — {row?.lotDesignation} · historique des quittances émises
          </p>
        </div>

        {row && (
          <Card className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Total dû</p><p className="font-semibold">{formatCurrency(row.eligibility.totalDue || 0)}</p></div>
              <div><p className="text-xs text-muted-foreground">Payé</p><p className="font-semibold text-emerald-600">{formatCurrency(row.eligibility.paid || 0)}</p></div>
              <div><p className="text-xs text-muted-foreground">Reste</p><p className="font-semibold text-amber-600">{formatCurrency(row.eligibility.balance || 0)}</p></div>
              <div><p className="text-xs text-muted-foreground">Statut</p><div>{eligibilityChip(row)}</div></div>
            </div>
          </Card>
        )}

        <div>
          <h2 className="text-sm font-semibold mb-2">Quittances émises ({tenantQuittances.length})</h2>
          {tenantQuittances.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">Aucune quittance émise pour ce lot</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground border-b border-border">
                  <tr>
                    <th className="py-2 pr-4">N°</th>
                    <th className="py-2 pr-4">Période</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Émise le</th>
                    <th className="py-2 pr-4 text-right">Dû</th>
                    <th className="py-2 pr-4 text-right">Payé</th>
                    <th className="py-2 pr-4">Statut</th>
                    <th className="py-2 pr-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tenantQuittances.map((q) => (
                    <tr key={q.id} className="border-b border-border/60">
                      <td className="py-2 pr-4 font-mono text-xs">{q.receipt_number}</td>
                      <td className="py-2 pr-4">{getMonthName(q.month)} {q.year}</td>
                      <td className="py-2 pr-4">{kindBadge(q.kind)}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">{q.issue_date || '—'}</td>
                      <td className="py-2 pr-4 text-right">{formatCurrency(q.total_due)}</td>
                      <td className="py-2 pr-4 text-right font-semibold">{formatCurrency(q.paid_amount ?? q.total)}</td>
                      <td className="py-2 pr-4">{statusBadge(q.status)}</td>
                      <td className="py-2 pr-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => downloadSingle(q)} title="Télécharger PDF"><Download className="w-4 h-4" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => resendEmail(q)} title="Renvoyer email"><Mail className="w-4 h-4" /></Button>
                        </div>
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

  // ----- Vue principale -----
  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Quittances de loyer</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pilotées par le compte locataire (échéances &amp; paiements réels). Loi n° 89-462 du 6 juillet 1989 (art. 21).
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={generating || toGenerate.length === 0} className="gap-1.5">
          <FilePlus2 className="w-4 h-4" />
          {generating ? 'Génération...' : `Générer les quittances (${toGenerate.length})`}
        </Button>
      </div>
      {generating && (
        <SlowLoadingMessage isLoading message={`Génération de ${toGenerate.length} quittance(s)…`} delay={1500} />
      )}

      <Card className="p-3 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-xs whitespace-nowrap">Période</Label>
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-44" />
        </div>
        <p className="text-xs text-muted-foreground ml-auto">
          {ledgerRows.length} bail(aux) sur la période · {toGenerate.length} à émettre · {blockedRows.length} bloqué(s) (impayé / sans échéance)
        </p>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Aucune quittance n'est émise sans paiement réel. Un <strong>solde nul =&gt; quittance intégrale</strong> ;
          un <strong>paiement partiel =&gt; reçu partiel</strong> ; <strong>aucun paiement =&gt; rien</strong>.
          L'envoi d'email n'atteint que les locataires enregistrés sur l'app.
        </span>
      </div>

      {/* Comptes locataires sur la période */}
      <div>
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Users className="w-4 h-4" /> Comptes locataires — {monthLabelStr}
        </h2>
        {ledgerRows.length === 0 ? (
          <div className="bg-card rounded-xl border border-border p-12 text-center">
            <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Aucun bail sur cette période</p>
          </div>
        ) : (
          <div className="grid gap-2">
            {ledgerRows.map((r) => {
              const issued = issuedMap.get(issuedKey(r));
              const eligible = r.eligibility.kind !== 'none';
              return (
                <div key={`${r.lot.id}-${r.lease.id}`} className="bg-card rounded-xl border border-border p-3 flex items-center gap-3">
                  <button onClick={() => setSelectedLotId(r.lot.id)} className="flex-1 flex items-center gap-2 min-w-0 text-left group">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate group-hover:underline">{r.tenantName}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.propertyName} — {r.lotDesignation}</p>
                    </div>
                  </button>
                  <div className="text-right text-sm shrink-0 hidden sm:block">
                    <p className="text-xs text-muted-foreground">Dû {formatCurrency(r.eligibility.totalDue || 0)} · payé {formatCurrency(r.eligibility.paid || 0)}</p>
                    <p className="text-xs text-muted-foreground">Reste {formatCurrency(r.eligibility.balance || 0)}</p>
                  </div>
                  <div className="w-28 text-right shrink-0">{issued ? kindBadge(issued.kind) : eligibilityChip(r)}</div>
                  <Button size="sm" variant={issued ? 'outline' : 'default'} onClick={() => setEmitRow(r)} disabled={!eligible && !issued} className="gap-1.5 shrink-0">
                    <Send className="w-3.5 h-3.5" /> {issued ? 'Réémettre' : eligible ? 'Émettre' : 'Bloqué'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Historique global */}
      <div>
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <FileText className="w-4 h-4" /> Historique des quittances émises
        </h2>
        {quittances.length === 0 ? (
          <EmptyState
            illustration={<IlloQuittances />}
            title="Aucune quittance encore"
            subtitle="Elles se génèrent automatiquement dès qu'un loyer est marqué payé dans le compte locataire."
            secondary={<Link to="/loyers?tab=compte-locataire"><Button variant="ghost" className="gap-2">Aller aux loyers</Button></Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-4">N°</th>
                  <th className="py-2 pr-4">Période</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Locataire</th>
                  <th className="py-2 pr-4">Logement</th>
                  <th className="py-2 pr-4 text-right">Dû</th>
                  <th className="py-2 pr-4 text-right">Payé</th>
                  <th className="py-2 pr-4">Statut</th>
                  <th className="py-2 pr-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {quittances.map((q) => (
                  <tr key={q.id} className="border-b border-border/60 cursor-pointer hover:bg-muted/40" onClick={() => setSelectedLotId(q.lot_id)}>
                    <td className="py-2 pr-4 font-mono text-xs">{q.receipt_number}</td>
                    <td className="py-2 pr-4">{getMonthName(q.month)} {q.year}</td>
                    <td className="py-2 pr-4">{kindBadge(q.kind)}</td>
                    <td className="py-2 pr-4">{q.tenant_name}</td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">{q.property_name} — {q.lot_designation}</td>
                    <td className="py-2 pr-4 text-right">{formatCurrency(q.total_due)}</td>
                    <td className="py-2 pr-4 text-right font-semibold">{formatCurrency(q.paid_amount ?? q.total)}</td>
                    <td className="py-2 pr-4">{statusBadge(q.status)}</td>
                    <td className="py-2 pr-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => downloadSingle(q)} title="Télécharger PDF"><Download className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => resendEmail(q)} title="Renvoyer email"><Mail className="w-4 h-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EmertreDialog open={!!emitRow} row={emitRow} onClose={() => setEmitRow(null)} onEmitted={onEmitted} />
    </div>
  );
}