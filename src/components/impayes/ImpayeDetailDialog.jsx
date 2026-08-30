import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  FileText, FileDown, Scale, CheckCircle2, Ban, AlertTriangle, Send, Gavel, ChevronRight,
} from 'lucide-react';
import {
  STAGES, buildContext, buildDocumentFor, DISCLAIMER_PROFESSIONNEL,
  stageOf, periodLabel, formatEuro, fmtDate,
} from '@/lib/recouvrementTemplates';
import { generateCourrierPDF, generateDossierPDF, buildCourrierDoc } from '@/lib/recouvrementReport';
import { triggerMilestone } from '@/lib/celebrations';
import StageStepper from './StageStepper';
import RecouvrementTimeline from './RecouvrementTimeline';

const ACTOR_BADGE = {
  bailleur: { label: 'Document bailleur', cls: 'bg-primary/10 text-primary border-primary/30' },
  professionnel: { label: 'Intervention d\'un professionnel', cls: 'bg-purple-100 text-purple-700 border-purple-300' },
};

const STAGE_TEMPLATE = {
  rappel_amiable: 'rent_reminder',
  deuxieme_relance: 'rent_reminder',
  mise_en_demeure_amiable: 'mise_en_demeure',
};

function CourrierRow({ stage, ctx, impaye, onDone, busy }) {
  const label = stageOf(stage).label;
  const [emailBusy, setEmailBusy] = useState(false);

  const onGenerate = async () => {
    if (busy) return;
    try {
      const model = buildDocumentFor(stage, ctx);
      if (!model) return;
      const fn = `recouvrement_${stage}_${(ctx.tenantName || 'locataire').replace(/\s+/g, '_')}.pdf`;
      generateCourrierPDF(model, ctx, fn);
      const me = await base44.auth.me();
      const res = await base44.functions.invoke('recordRecouvrement', {
        impaye_id: impaye.id, stage, method: 'generé',
        note: `Courrier généré par ${me?.full_name || 'le bailleur'} (PDF téléchargé).`,
      });
      if (res?.data?.ok === false) throw new Error(res?.data?.error || 'échec');
      toast.success(`${label} généré et enregistré.`);
      onDone();
    } catch (e) {
      toast.error("Génération impossible : " + (e?.message || 'erreur'));
    }
  };

  const onEmail = async () => {
    if (busy || emailBusy) return;
    const to = ctx.tenantEmail;
    if (!to) { toast.error('Email du locataire introuvable — renseignez-le sur le bail/lot.'); return; }
    setEmailBusy(true);
    try {
      const model = buildDocumentFor(stage, ctx);
      if (!model) return;
      const fn = `recouvrement_${stage}_${(ctx.tenantName || 'locataire').replace(/\s+/g, '_')}.pdf`;
      const doc = buildCourrierDoc(model, ctx);
      const file = new File([doc.output('blob')], fn, { type: 'application/pdf' });
      const up = await base44.integrations.Core.UploadFile({ file });
      const variables = {
        tenant_name: ctx.tenantName, property_name: ctx.propertyName, lot_designation: ctx.lotDesignation,
        period_label: ctx.periodLabel, due_date: fmtDate(ctx.dueDate),
        amount_due: ctx.totalDue, outstanding: ctx.outstanding,
        landlord_name: ctx.landlordName,
        relance_number: stage === 'deuxieme_relance' ? 2 : 1,
      };
      const r = await base44.functions.invoke('sendTransactionalEmail', {
        to, template: STAGE_TEMPLATE[stage] || 'rent_reminder', variables,
        attachments: [{ url: up.file_url, filename: fn }],
        related_entity_type: 'impaye', related_entity_id: impaye.id,
      });
      const status = r?.data?.status;
      const ok = status === 'sent' || status === 'queued';
      const recNote = ok
        ? `Courrier envoyé par email à ${to}${status === 'queued' ? ' (en attente)' : ''}.`
        : `Échec envoi email : ${r?.data?.error || 'fournisseur indisponible'}.`;
      const rec = await base44.functions.invoke('recordRecouvrement', {
        impaye_id: impaye.id, stage, method: 'email', note: recNote,
      });
      if (rec?.data?.ok === false) throw new Error(rec?.data?.error || 'échec enregistrement');
      if (ok) toast.success(`${label} envoyé par email.`);
      else toast.error(`Échec envoi email : ${r?.data?.error || 'fournisseur indisponible'}. Le PDF reste disponible via « Générer ».`);
      onDone();
    } catch (e) {
      toast.error('Envoi impossible : ' + (e?.message || 'erreur'));
    } finally {
      setEmailBusy(false);
    }
  };

  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{label}</span>
          <Badge variant="outline" className={ACTOR_BADGE.bailleur.cls + ' text-[10px]'}>
            {ACTOR_BADGE.bailleur.label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{stageOf(stage).help}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button size="sm" variant="outline" onClick={onGenerate} disabled={busy || emailBusy}>
          <FileText className="w-3.5 h-3.5" /><span className="hidden sm:inline">Générer</span><ChevronRight className="w-3.5 h-3.5" />
        </Button>
        <Button size="sm" variant="secondary" onClick={onEmail} disabled={busy || emailBusy}>
          {emailBusy ? <span className="text-[11px]">Envoi…</span> : <><Send className="w-3.5 h-3.5" /><span className="hidden sm:inline">Email</span></>}
        </Button>
      </div>
    </div>
  );
}

export default function ImpayeDetailDialog({ impaye, lease, property, lot, landlord, open, onOpenChange, onRefresh }) {
  const [busy, setBusy] = useState(false);

  const ctx = useMemo(
    () => buildContext({
      impaye, lease, property, lot,
      landlordName: landlord?.name, landlordEmail: landlord?.email, landlordAddress: landlord?.address,
    }),
    [impaye, lease, property, lot, landlord]
  );

  if (!impaye) return null;
  const next = (() => {
    const idx = STAGES.findIndex((s) => s.key === impaye.status);
    if (idx < 0) return STAGES[0].key;
    return idx + 1 < STAGES.length ? STAGES[idx + 1].key : null;
  })();

  const recordAction = (payload) =>
    base44.functions.invoke('recordRecouvrement', { impaye_id: impaye.id, ...payload });

  const transmitDossier = async () => {
    setBusy(true);
    try {
      const dues = await base44.entities.RentDue.filter({ lease_id: impaye.lease_id });
      const payments = await base44.entities.Payment.filter({ lease_id: impaye.lease_id });
      const solde = (dues || []).reduce((s, d) => s + Math.max(0, Number(d.balance) || 0), 0);
      const actions = (impaye.action_history || []).length
        ? impaye.action_history
        : (impaye.relance_history || []).map((r) => ({ date: r.date, label: r.type, method: r.method, note: r.note, actor: 'bailleur' }));
      const fn = `dossier_transmission_${(ctx.tenantName || 'locataire').replace(/\s+/g, '_')}.pdf`;
      generateDossierPDF({ ctx, lease, property, lot, dues, payments, actions, solde }, fn);
      await recordAction({ stage: 'dossier_professionnel', method: 'transmission', note: 'Dossier de transmission généré pour remise à un commissaire de justice / avocat.' });
      toast.success('Dossier de transmission généré.');
      onRefresh();
    } catch (e) {
      toast.error('Génération du dossier impossible : ' + (e?.message || 'erreur'));
    } finally {
      setBusy(false);
    }
  };

  const exportDossier = async () => {
    setBusy(true);
    try {
      const dues = await base44.entities.RentDue.filter({ lease_id: impaye.lease_id });
      const payments = await base44.entities.Payment.filter({ lease_id: impaye.lease_id });
      const solde = (dues || []).reduce((s, d) => s + Math.max(0, Number(d.balance) || 0), 0);
      const actions = (impaye.action_history || []).length
        ? impaye.action_history
        : (impaye.relance_history || []).map((r) => ({ date: r.date, label: r.type, method: r.method, note: r.note, actor: 'bailleur' }));
      const fn = `dossier_dette_locative_${(ctx.tenantName || 'locataire').replace(/\s+/g, '_')}.pdf`;
      generateDossierPDF({ ctx, lease, property, lot, dues, payments, actions, solde }, fn);
      await recordAction({ action_type: 'note', method: 'telechargement', note: 'Dossier complet exporté (PDF).' });
      toast.success('Dossier complet exporté.');
      onRefresh();
    } catch (e) {
      toast.error('Export impossible : ' + (e?.message || 'erreur'));
    } finally {
      setBusy(false);
    }
  };

  const finalize = async (stage) => {
    setBusy(true);
    try {
      await recordAction({
        stage,
        method: 'manuel',
        note: stage === 'régularisé' ? 'Dette locative soldée.' : 'Dette locative abandonnée.',
      });
      toast.success(stage === 'régularisé' ? 'Dette régularisée.' : 'Dette marquée abandonnée.');
      if (stage === 'régularisé') { try { await triggerMilestone('first_impaye_resolved'); } catch { /* noop */ } }
      onRefresh();
    } catch (e) {
      toast.error('Mise à jour impossible : ' + (e?.message || 'erreur'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Dette locative — {ctx.tenantName}
          </DialogTitle>
          <DialogDescription>
            {ctx.propertyName}{ctx.lotDesignation ? ` — ${ctx.lotDesignation}` : ''} · échéance {periodLabel(impaye.period)} ({fmtDate(impaye.due_date)})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <StageStepper status={impaye.status} />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <div className="bg-muted/40 rounded-lg p-2">
              <p className="text-xs text-muted-foreground">Échéance</p>
              <p className="font-semibold">{formatEuro(impaye.expected_amount)}</p>
            </div>
            <div className="bg-muted/40 rounded-lg p-2">
              <p className="text-xs text-muted-foreground">Réglé</p>
              <p className="font-semibold">{formatEuro(impaye.paid_amount)}</p>
            </div>
            <div className="bg-red-50 rounded-lg p-2">
              <p className="text-xs text-red-600">Reste à régler</p>
              <p className="font-semibold text-red-700">{formatEuro(impaye.outstanding_amount ?? impaye.missing_amount)}</p>
            </div>
            <div className="bg-muted/40 rounded-lg p-2">
              <p className="text-xs text-muted-foreground">Retard</p>
              <p className="font-semibold">{impaye.late_days || 0} j</p>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Courriers à générer (par le bailleur)</CardTitle>
              <CardDescription className="text-xs">
                Documents rédigés par vous-même. Ils ne sont pas des actes de procédure.
              </CardDescription>
            </CardHeader>
            <CardContent className="py-0">
              {['rappel_amiable', 'deuxieme_relance', 'mise_en_demeure_amiable'].map((st) => (
                <CourrierRow key={st} stage={st} ctx={ctx} impaye={impaye} busy={busy} onDone={onRefresh} />
              ))}
            </CardContent>
          </Card>

          <Card className="border-purple-200 bg-purple-50/30">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Scale className="w-4 h-4 text-purple-600" /> Dossier à transmettre à un professionnel
                </CardTitle>
                <Badge variant="outline" className={ACTOR_BADGE.professionnel.cls + ' text-[10px]'}>
                  {ACTOR_BADGE.professionnel.label}
                </Badge>
              </div>
              <CardDescription className="text-xs text-purple-800/80">
                Commissaire de justice ou avocat.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-[11px] leading-relaxed text-purple-900 bg-purple-100/60 border border-purple-200 rounded p-2">
                ⚠ {DISCLAIMER_PROFESSIONNEL}
              </p>
              <Button size="sm" variant="outline" className="border-purple-300 text-purple-700 hover:bg-purple-100" onClick={transmitDossier} disabled={busy}>
                <Gavel className="w-3.5 h-3.5" /> Générer le dossier de transmission
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><FileDown className="w-4 h-4" /> Export & finalisation</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={exportDossier} disabled={busy}>
                <FileDown className="w-3.5 h-3.5" /> Exporter le dossier complet
              </Button>
              <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-300 hover:bg-emerald-50" onClick={() => finalize('régularisé')} disabled={busy}>
                <CheckCircle2 className="w-3.5 h-3.5" /> Marquer régularisé
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => finalize('abandonné')} disabled={busy}>
                <Ban className="w-3.5 h-3.5" /> Abandonner
              </Button>
            </CardContent>
          </Card>

          <div>
            <h4 className="text-sm font-semibold mb-1">Historique horodaté des actions</h4>
            <RecouvrementTimeline impaye={impaye} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}