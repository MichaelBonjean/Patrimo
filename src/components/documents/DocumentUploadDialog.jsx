import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { UploadCloud, Sparkles, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { labelOfType, formatDateFR, formatAmount } from '@/lib/documents';

export default function DocumentUploadDialog({ open, onOpenChange, onCreated }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const reset = () => { setFile(null); setBusy(false); setResult(null); };

  const handlePick = (e) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setResult(null); }
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const res = await base44.functions.invoke('manageDocuments', {
        op: 'extract',
        file_url, filename: file.name, mime_type: file.type,
      });
      const record = res.data?.record || res.record;
      const ai = res.data?.ai || res.ai;
      const low = res.data?.low_confidence ?? res.low_confidence ?? false;
      setResult({ record, ai, low });
      toast.success(low ? 'Document importé — vérifiez la proposition de l\'IA' : 'Document importé et catégorisé');
    } catch (err) {
      toast.error("Échec de l'import : " + (err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const close = () => { if (busy) return; reset(); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else onOpenChange(true); }}>
      <DialogContent className="sm:min-w-[420px] max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Importer un document</DialogTitle>
        </DialogHeader>

        {!result && (
          <div className="space-y-3">
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-6 cursor-pointer hover:bg-accent transition-colors">
              <UploadCloud className="w-8 h-8 text-muted-foreground" />
              <span className="text-sm">{file ? file.name : 'Choisir un fichier (PDF, image, doc…)'}</span>
              <input type="file" className="hidden" onChange={handlePick} accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt,.csv,.xlsx" />
            </label>
            <p className="text-xs text-muted-foreground">
              L'IA analyse le document et propose type, bien, lot, montant, date et fournisseur.
              { } Si la confiance est faible, le document reste <b>à valider</b> manuellement.
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 font-medium">
              {result.low ? <AlertTriangle className="w-4 h-4 text-amber-600" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              {result.low ? 'Confiance faible — validation requise' : 'Catégorisation automatique acceptée'}
            </div>
            {result.ai && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
                <Row label="Type" value={labelOfType(result.ai.type)} />
                <Row label="Bien" value={result.ai.property_id ? 'Identifié' : '—'} />
                <Row label="Lot" value={result.ai.lot_id ? 'Identifié' : '—'} />
                <Row label="Date" value={formatDateFR(result.ai.document_date)} />
                <Row label="Expiration" value={formatDateFR(result.ai.expiration_date)} />
                <Row label="Fournisseur" value={result.ai.supplier || '—'} />
                {result.ai.amount != null && <Row label="Montant" value={formatAmount(result.ai.amount)} />}
                {result.ai.rationale && <Row label="Justification" value={result.ai.rationale} />}
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex-1 h-1.5 rounded bg-muted overflow-hidden">
                    <div className={`h-full ${result.ai.confidence >= 0.7 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${Math.round((result.ai.confidence || 0) * 100)}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{Math.round((result.ai.confidence || 0) * 100)}%</span>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button variant="outline" onClick={reset}>Importer un autre</Button>
              <Button onClick={() => { const r = result.record; reset(); onOpenChange(false); onCreated(r); }}>Voir / corriger</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={close} disabled={busy}>Annuler</Button>
              <Button onClick={run} disabled={!file || busy}>
                {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analyse…</> : 'Analyser & importer'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right truncate">{value || '—'}</span>
    </div>
  );
}