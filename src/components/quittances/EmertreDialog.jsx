import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { base44 } from '@/api/base44Client';
import { buildSingleQuittance, quittanceToPdfRow, periodLabel } from '@/lib/quittanceReport';
import { formatCurrency, getMonthName } from '@/lib/formatters';
import { toast } from 'sonner';

/**
 * Émission d'une quittance/reçu pour un bail + une période, basée sur le
 * compte locataire réel (RentDue -> Payments). Délègue la décision
 * d'éligibilité + le snapshot immuable à la fonction backend generateQuittance.
 */
export default function EmertreDialog({ open, row, onClose, onEmitted }) {
  const [email, setEmail] = useState('');
  const [sendEmail, setSendEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && row) {
      setEmail(row.tenant?.email || row.tenantEmail || '');
      setSendEmail(false);
    }
  }, [open, row]);

  if (!row) return null;

  const blocked = !row.eligibility || row.eligibility.kind === 'none';
  const partial = row.eligibility?.kind === 'partial';

  const handleEmit = async () => {
    setBusy(true);
    try {
      if (blocked) {
        toast.error(row.eligibility?.reason === 'no_due'
          ? "Aucune échéance pour cette période — générez d'abord les échéances du bail."
          : 'Aucun paiement enregistré : aucune quittance possible.');
        return;
      }
      const res = await base44.functions.invoke('generateQuittance', {
        lease_id: row.lease.id, year: row.year, month: row.month,
      });
      const data = res.data;
      if (!data.ok) {
        toast.error(data.error || 'Quittance impossible');
        return;
      }
      const q = data.quittance;
      const pdfRow = quittanceToPdfRow(q);
      const pdfDoc = buildSingleQuittance(pdfRow);
      pdfDoc.save(`${q.receipt_number}.pdf`);

      let status = 'generated';
      if (sendEmail && email) {
        try {
          // Upload du PDF (pièce jointe) — le rendu HTML est fait côté serveur
          const file = new File([pdfDoc.output('blob')], `${q.receipt_number}.pdf`, { type: 'application/pdf' });
          const up = await base44.integrations.Core.UploadFile({ file });
          const r = await base44.functions.invoke('sendTransactionalEmail', {
            to: email,
            template: 'quittance',
            variables: {
              kind: partial ? 'partial' : 'full',
              tenant_name: q.tenant_name,
              property_name: q.property_name,
              lot_designation: q.lot_designation,
              period_label: `${getMonthName(row.month)} ${row.year}`,
              rent_hc: q.rent_hc,
              charges: q.charges,
              additional_amount: q.additional_amount,
              total_due: q.total_due,
              paid_amount: q.paid_amount,
              balance: q.balance,
              landlord_name: q.landlord_name,
            },
            attachments: [{ url: up.file_url, filename: `${q.receipt_number}.pdf` }],
            related_entity_type: 'quittance',
            related_entity_id: q.id,
          });
          const st = r?.data?.status;
          if (st === 'sent' || st === 'queued') {
            await base44.entities.Quittance.update(q.id, { status: 'sent', sent_by_email: true, sent_date: new Date().toISOString().slice(0, 10) });
            status = 'sent';
            toast.success(st === 'queued' ? 'Quittance émise — email mis en file d\u2019attente.' : 'Quittance émise et email envoyé');
          } else {
            await base44.entities.Quittance.update(q.id, { status: 'failed' });
            status = 'failed';
            toast.error('Quittance émise — échec email (' + (r?.data?.error || 'fournisseur indisponible') + ')');
          }
        } catch (e) {
          await base44.entities.Quittance.update(q.id, { status: 'failed' });
          status = 'failed';
          toast.error('Quittance émise — échec email (' + (e?.message || 'erreur') + ')');
        }
      } else {
        toast.success(`${partial ? 'Reçu partiel' : 'Quittance'} émis(e) (PDF téléchargé)`);
      }

      onEmitted?.(status);
      onClose();
    } catch (e) {
      toast.error('Erreur : ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Émettre la quittance</DialogTitle>
          <DialogDescription>
            {row.tenantName} — {row.propertyName} · {row.lotDesignation} · {periodLabel(row.year, row.month)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-md border border-border p-2">
              <p className="text-[11px] text-muted-foreground">Total dû</p>
              <p className="font-semibold">{formatCurrency(row.eligibility?.totalDue || 0)}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-[11px] text-muted-foreground">Payé</p>
              <p className="font-semibold text-emerald-600">{formatCurrency(row.eligibility?.paid || 0)}</p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-[11px] text-muted-foreground">Reste</p>
              <p className="font-semibold text-amber-600">{formatCurrency(row.eligibility?.balance || 0)}</p>
            </div>
          </div>

          {blocked ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {row.eligibility?.reason === 'no_due'
                ? "Aucune échéance n'existe pour cette période. Générez d'abord les échéances du bail dans le Compte locataire."
                : 'Aucun paiement enregistré pour cette période : aucune quittance ne peut être émise (règle du moteur).'}
            </div>
          ) : partial ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Le compte locataire est partiellement réglé. Un <strong>reçu pour paiement partiel</strong> sera émis (et non une quittance complète).
            </div>
          ) : (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              Solde soldé : une <strong>quittance intégrale</strong> sera émise à partir des paiements réels.
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Adresse email du locataire</Label>
            <Input type="email" placeholder="email du locataire" value={email} onChange={(e) => setEmail(e.target.value)} disabled={blocked} />
            <p className="text-[11px] text-muted-foreground">
              Le locataire n'a pas besoin de compte : tout destinataire à adresse valide reçoit l'email.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="se" className="text-sm">Envoyer par email après émission</Label>
              <p className="text-[11px] text-muted-foreground">Sinon, téléchargement du PDF seulement</p>
            </div>
            <Switch id="se" checked={sendEmail} onCheckedChange={setSendEmail} disabled={blocked} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Annuler</Button>
          <Button onClick={handleEmit} disabled={busy || blocked}>
            {busy ? 'Émission...' : partial ? 'Émettre le reçu partiel' : 'Émettre la quittance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}