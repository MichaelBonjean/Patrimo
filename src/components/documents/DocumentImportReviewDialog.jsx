import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Sparkles, FileText, ShieldAlert, CheckCircle2, Loader2, ArrowRight, Home, DoorOpen, UserSquare2, Landmark, X, RotateCcw, HelpCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { labelOfType, formatDateFR, formatAmount } from '@/lib/documents';
import { needsClassificationConfirm } from '@/lib/importerPipeline';
import DocumentSourceViewer, { hasSource, SENSITIVE_SOURCE_FIELDS } from '@/components/documents/DocumentSourceViewer';
import ValidationInbox from '@/components/documents/ValidationInbox';

const CLASS_LABELS = {
  bail_alur: 'Bail (ALUR)',
  acte_vente_notarie: 'Acte de vente notarié',
  compromis: 'Compromis de vente',
  offre_pret_bancaire: 'Offre de prêt bancaire',
  tableau_amortissement: "Tableau d'amortissement",
  releve_bancaire: 'Relevé bancaire',
  releve_caf: 'Relevé CAF / APL',
  taxe_fonciere: 'Taxe foncière',
  diagnostic_technique: 'Diagnostic technique (DPE)',
  assurance_pno: 'Assurance PNO',
  appel_charges: 'Appel de charges',
  facture: 'Facture',
  sci_statuts_kbis: 'Statuts / K-bis (SCI)',
  etat_des_lieux: 'État des lieux',
  quittance_loyer: 'Quittance de loyer',
  autre: 'Autre',
  unknown: 'Non classé',
};

const ENTITY_ICON = {
  Property: Home,
  Lot: DoorOpen,
  Lease: UserSquare2,
  Holder: Landmark,
  Transaction: FileText,
  Document: FileText,
};
const ENTITY_LABEL = {
  Property: 'Bien',
  Lot: 'Lot',
  Lease: 'Bail',
  Holder: 'Détenteur',
  Transaction: 'Transaction',
  Document: 'Document',
};

// Champs affichés en résumé pour chaque entité cible (clé -> libellé).
const PREVIEW_FIELDS = {
  Property: [['name', 'Nom'], ['address', 'Adresse'], ['city', 'Ville'], ['purchase_price', 'Prix d’achat'], ['loan_amount', 'Montant prêt'], ['loan_rate', 'Taux']],
  Lot: [['designation', 'Désignation'], ['surface', 'Surface'], ['typology', 'Typologie'], ['dpe_class', 'DPE'], ['ges_class', 'GES']],
  Lease: [['date_start', 'Effet'], ['date_end', 'Fin'], ['lease_type', 'Type'], ['rent_excluding_charges', 'Loyer HC'], ['charges', 'Charges'], ['deposit', 'Caution']],
  Holder: [['name', 'Nom'], ['siret', 'SIRET'], ['capital', 'Capital'], ['type', 'Type']],
  Transaction: [['category', 'Catégorie'], ['amount', 'Montant'], ['year', 'Année']],
  Document: [['title', 'Titre'], ['document_date', 'Date'], ['amount', 'Montant']],
};

function valuePreview(key, v) {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return v.length + ' élément(s)';
  if (/date|_at|_start|_end/i.test(key) && typeof v === 'string') return formatDateFR(v);
  if (/amount|price|rent|charges|deposit|capital|surface/i.test(key) && typeof v === 'number') return formatAmount(v) || v;
  return String(v);
}

function confColor(c) {
  if (c >= 0.85) return 'bg-emerald-500';
  if (c >= 0.6) return 'bg-amber-500';
  return 'bg-rose-500';
}

export default function DocumentImportReviewDialog({ open, onOpenChange, documentImport, onCommitted, onRejected }) {
  const id = documentImport?.id;
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [chosenType, setChosenType] = useState('');
  useEffect(() => { setConfirmed(false); setPicking(false); setChosenType(''); }, [id]);

  const reclassifyMut = useMutation({
    mutationFn: async (newType) => base44.entities.DocumentImport.update(id, {
      classification: newType,
      classification_confidence: 1,
      classification_explanation: 'Type confirmé par le bailleur',
      classification_alternatives: [],
    }),
    onSuccess: () => {
      toast.success('Type mis à jour');
      setConfirmed(true);
      setPicking(false);
      qc.invalidateQueries({ queryKey: ['proposeDocumentCommit', id] });
    },
    onError: (e) => toast.error('Échec du changement de type : ' + (e.message || e)),
  });

  const planQ = useQuery({
    enabled: open && !!id,
    queryKey: ['proposeDocumentCommit', id],
    queryFn: async () => {
      const res = await base44.functions.invoke('proposeDocumentCommit', { document_import_id: id });
      return res.data || res;
    },
  });

  const commitMut = useMutation({
    mutationFn: async (payload = {}) => base44.functions.invoke('commitDocumentImport', {
      document_import_id: id,
      auto_propose: true,
      confirm_reviewed: true,
      validated_data: payload.validated_data,
      field_corrections: payload.field_corrections,
    }),
    onSuccess: (res) => {
      const data = res.data || res;
      const nc = (data.entities_created || []).length;
      const nu = (data.entities_updated || []).length;
      toast.success(`Import validé — ${nc} création(s), ${nu} mise(s) à jour`);
      onCommitted?.(documentImport);
    },
    onError: (e) => toast.error('Échec de la validation : ' + (e.message || e)),
  });

  const rejectMut = useMutation({
    mutationFn: async () => base44.functions.invoke('rejectDocumentImport', { document_import_id: id }),
    onSuccess: () => { toast.success('Import rejeté — fichier conservé 30 j (RGPD)'); onRejected?.(documentImport); },
    onError: (e) => toast.error('Échec du rejet : ' + (e.message || e)),
  });

  // L'Inbox remonte les corrections champ par champ (ancienne → nouvelle valeur).
  // On les ré-injecte dans `validated_data` (le moteur documentCommit reconstruit
  // le plan avec les valeurs corrigées) et on les trace dans l'audit (field_corrections).
  const handleInboxCommit = ({ corrections }) => {
    const src = planQ.data?.record?.extracted_data || documentImport?.extracted_data || {};
    const validated = { ...src };
    for (const c of corrections || []) {
      if (c && c.field) validated[c.field] = c.new;
    }
    commitMut.mutate({ validated_data: validated, field_corrections: corrections || [] });
  };

  const plan = planQ.data?.plan;
  const record = planQ.data?.record || documentImport;
  const targets = plan?.targets || [];
  const meta = plan?.document_meta || {};
  const riskNotes = plan?.risk_notes || [];
  const busy = planQ.isLoading || commitMut.isPending || rejectMut.isPending;

  const close = () => { if (busy) return; onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else onOpenChange(true); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Validation IA — plan d’import</DialogTitle>
          <DialogDescription>Confirmez la création / mise à jour proposée par l’IA avant écriture dans votre patrimoine.</DialogDescription>
        </DialogHeader>

        {planQ.isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : planQ.isError ? (
          <div className="text-sm text-destructive">Impossible de calculer le plan : {(planQ.error?.message) || 'erreur'}</div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {/* En-tête document */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
              <div className="flex items-center gap-2 font-medium text-sm">
                <FileText className="w-4 h-4" />
                <span className="truncate">{record?.file_name}</span>
                <Badge variant="secondary" className="ml-auto">{CLASS_LABELS[record?.classification] || record?.classification || '—'}</Badge>
              </div>
              <Row label="Confiance classification" value={
                <span className="flex items-center gap-2">
                  <span className="flex-1 h-1.5 rounded bg-muted overflow-hidden w-24">
                    <span className={`h-full ${confColor(record?.classification_confidence || 0)}`} style={{ width: `${Math.round((record?.classification_confidence || 0) * 100)}%` }} />
                  </span>
                  <span>{Math.round((record?.classification_confidence || 0) * 100)}%</span>
                </span>
              } />
              {meta.document_date && <Row label="Date document" value={formatDateFR(meta.document_date)} />}
              {meta.supplier && <Row label="Émetteur" value={meta.supplier} />}
              {meta.amount != null && <Row label="Montant" value={formatAmount(meta.amount)} />}
            </div>

            {/* Classification peu fiable : confirmation non bloquante */}
            {needsClassificationConfirm(record) && !confirmed && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
                <div className="flex items-start gap-2 text-xs text-amber-800">
                  <HelpCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Classification peu fiable ({Math.round((record?.classification_confidence || 0) * 100)}%)</p>
                    <p>L'IA propose : <b>{CLASS_LABELS[record?.classification] || record?.classification}</b>. Vérifiez ou corrigez avant de valider.</p>
                    {record?.classification_explanation && (
                      <p className="mt-0.5 text-amber-700">{record.classification_explanation}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => setConfirmed(true)}>
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />Confirmer ce type
                  </Button>
                  {!picking ? (
                    <Button size="sm" variant="outline" onClick={() => { setPicking(true); setChosenType(record?.classification || ''); }}>
                      Choisir un autre type
                    </Button>
                  ) : (
                    <>
                      <Select value={chosenType} onValueChange={setChosenType}>
                        <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Choisir…" /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(CLASS_LABELS).filter(([k]) => k !== 'unknown' && k !== 'autre').map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" onClick={() => chosenType && reclassifyMut.mutate(chosenType)} disabled={reclassifyMut.isPending || !chosenType}>
                        {reclassifyMut.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                        Valider
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Risques / notes */}
            {riskNotes.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1">
                {riskNotes.map((n, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-800">
                    <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{n}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Validation Inbox — revue orientée exceptions, une donnée à la fois */}
            <ValidationInbox plan={plan} record={record} onCommit={handleInboxCommit} commitPending={commitMut.isPending} />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={rejectMut.mutate} disabled={busy} className="mr-auto text-destructive">
            {rejectMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <X className="w-4 h-4 mr-1" />}
            Rejeter
          </Button>
          <Button variant="outline" onClick={close} disabled={busy}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TargetCard({ t, record }) {
  const Icon = ENTITY_ICON[t.entity] || FileText;
  const fields = PREVIEW_FIELDS[t.entity] || [];
  const preview = fields
    .map(([k, lbl]) => [k, lbl, valuePreview(k, t.data?.[k])])
    .filter(([, , v]) => v != null);
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="w-4 h-4 text-muted-foreground" />
          {ENTITY_LABEL[t.entity] || t.entity}
        </span>
        <Badge variant={t.action === 'update' ? 'secondary' : 'default'} className="text-[10px]">
          {t.action === 'update' ? <><RotateCcw className="w-3 h-3 mr-1" />Mise à jour</> : 'Création'}
        </Badge>
        {t.needs_review && <Badge className="bg-amber-500 border-amber-500 text-[10px]"><ShieldAlert className="w-3 h-3 mr-1" />À valider</Badge>}
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="flex h-1.5 w-16 rounded bg-muted overflow-hidden">
            <span className={`h-full ${confColor(t.confidence || 0)}`} style={{ width: `${Math.round((t.confidence || 0) * 100)}%` }} />
          </span>
          {Math.round((t.confidence || 0) * 100)}%
        </span>
      </div>
      {t.reason && <p className="text-xs text-muted-foreground flex items-center gap-1"><ArrowRight className="w-3 h-3" />{t.reason}</p>}
      {preview.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-xs pt-1 border-t">
          {preview.map(([k, lbl, v]) => (
            <div key={lbl} className="flex justify-between gap-2 items-center">
              <span className="text-muted-foreground shrink-0">{lbl}</span>
              <span className="text-right truncate flex items-center gap-1 justify-end min-w-0">
                <span className="truncate">{v}</span>
                {(SENSITIVE_SOURCE_FIELDS.has(k) || record?.ocr_text) && hasSource(record, k) && (
                  <DocumentSourceViewer record={record} field={k} value={v} label={lbl} />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right truncate">{value || '—'}</span>
    </div>
  );
}