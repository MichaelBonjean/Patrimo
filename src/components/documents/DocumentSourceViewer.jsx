import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eye, FileText, Highlighter, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { CLASS_LABELS } from '@/lib/documentsSourceLabels';

/**
 * Champs sensibles prioritaires pour l'expérience « Voir la source ».
 * (prix, prêt, loyer, date, quote-part, fiscalité, identité, etc.)
 */
export const SENSITIVE_SOURCE_FIELDS = new Set([
  'purchase_price', 'loan_amount', 'loan_rate', 'duration_years', 'loan_duration_years',
  'monthly_payment', 'rent_excluding_charges', 'charges', 'deposit', 'date_start',
  'date_end', 'share_percent', 'tax_regime', 'index_value_initial', 'owner_name',
  'holder_name', 'surface', 'capital', 'iban', 'amount',
]);

const MIME_PDF = /pdf/i;
const MIME_IMG = /^image\//i;

function isPdf(mime) { return MIME_PDF.test(mime || ''); }
function isImage(mime) { return MIME_IMG.test(mime || ''); }

/** Preuve d'extraction disponible pour ce champ ? */
export function hasSource(record, field) {
  if (!record?.file_url) return false;
  const prov = record?.extracted_data_provenance?.[field] || record?.provenance?.[field];
  if (prov && (prov.source_page != null || prov.source_text)) return true;
  // Sans preuve par champ, on accepte le fallback OCR global sur les champs sensibles.
  if (record?.ocr_text && SENSITIVE_SOURCE_FIELDS.has(field)) return true;
  return false;
}

function collapse(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

/**
 * Localise le fragment source dans le texte OCR complet (collapsé) et renvoie
 * le contexte + correspondance, pour mise en évidence.
 */
function locateFragment(fullText, fragment) {
  const text = collapse(fullText);
  const f = collapse(fragment);
  if (!f) return null;
  const idx = text.toLowerCase().indexOf(f.toLowerCase());
  if (idx === -1) {
    // Repli : 40 premiers caractères du fragment (OCR bruité).
    const head = f.slice(0, 40);
    const h = text.toLowerCase().indexOf(head.toLowerCase());
    return h >= 0 ? { text, start: h, end: h + head.length, partial: true } : null;
  }
  return { text, start: idx, end: idx + f.length, partial: false };
}

/**
 * Expérience « Voir la source ». Bouton inline + fenêtre :
 *  - ouvre le document PDF/image à la bonne page (iframe viewer / image) ;
 *  - met en évidence le passage exact (source_text) dans le texte OCR ;
 *  - superpose une bounding box si l'OCR a fourni des coordonnées normalisées.
 *
 * Conserve / exploite : source_document_id, source_page, source_text, bounding_box.
 *
 * Adapté desktop (deux colonnes) et mobile (plein écran empilé).
 *
 * Props :
 *  - record : DocumentImport (file_url, file_name, mime_type, pages_count, ocr_text,
 *           extracted_data_provenance?, classification)
 *  - field  : clé du champ extrait
 *  - value  : valeur extraite (affichée dans l'en-tête)
 *  - label  : libellé métier du champ
 *  - compact: bouton compact (ligne de tableau) — défaut true
 */
export default function DocumentSourceViewer({ record, field, value, label, compact = true }) {
  const [open, setOpen] = useState(false);

  const prov = record?.extracted_data_provenance?.[field] || record?.provenance?.[field] || {};
  const sourcePage = prov.source_page != null ? prov.source_page : null;
  const sourceText = prov.source_text || '';
  const bbox = prov.bounding_box || null;
  const fileName = record?.file_name;
  const fileUrl = record?.file_url;
  const mime = record?.mime_type || '';
  const ocrText = record?.ocr_text || '';
  const docType = CLASS_LABELS[record?.classification] || record?.classification;

  const located = useMemo(
    () => (open ? locateFragment(ocrText, sourceText) : null),
    [open, ocrText, sourceText],
  );

  if (!hasSource(record, field)) return null;

  const pdf = isPdf(mime) || /\.pdf$/i.test(fileName || '');
  const img = isImage(mime) || /\.(png|jpe?g|webp|gif)$/i.test(fileName || '');
  const pageHref = sourcePage != null ? `${fileUrl}#page=${sourcePage + 1}` : fileUrl;

  const trigger = compact ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-1 rounded text-primary hover:bg-primary/10 transition-colors shrink-0"
      title={`Voir dans le document${sourcePage != null ? ` — page ${sourcePage + 1}` : ''}`}
    >
      <Eye className="w-3 h-3" />
      <span>Voir la source</span>
    </button>
  ) : (
    <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
      <Eye className="w-3.5 h-3.5" />
      Voir la source
      {sourcePage != null && <span className="text-muted-foreground">· p.{sourcePage + 1}</span>}
    </Button>
  );

  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 gap-0 left-0 top-0 translate-x-0 translate-y-0 w-screen h-screen max-w-none rounded-none flex flex-col overflow-hidden
          sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-auto sm:h-auto sm:max-w-4xl sm:max-h-[88vh] sm:rounded-xl sm:border">
          {/* En-tête */}
          <DialogHeader className="p-4 sm:p-5 border-b shrink-0 space-y-1">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary shrink-0" />
              <DialogTitle className="text-base truncate">{label || field}</DialogTitle>
              {sourcePage != null && (
                <Badge variant="secondary" className="text-[10px]">page {sourcePage + 1}</Badge>
              )}
            </div>
            <DialogDescription className="flex items-center gap-2 flex-wrap text-xs">
              <span className="font-medium text-foreground/80">{value ?? '—'}</span>
              <span className="text-muted-foreground">— extrait de</span>
              <span className="flex items-center gap-1 truncate max-w-[55vw]">
                <span className="truncate">{fileName}</span>
              </span>
              {docType && <Badge variant="outline" className="text-[10px]">{docType}</Badge>}
            </DialogDescription>
          </DialogHeader>

          {/* Corps : desktop = deux colonnes, mobile = empilé défilant */}
          <div className="flex-1 overflow-y-auto flex flex-col sm:grid sm:grid-cols-2 gap-0 sm:gap-3 sm:p-3 min-h-0">
            {/* Colonne gauche : aperçu du document */}
            <div className="relative bg-muted/40 min-h-[40vh] sm:min-h-0 sm:rounded-md overflow-hidden border-b sm:border">
              {pdf ? (
                <iframe
                  title="Aperçu du document"
                  src={pageHref}
                  className="w-full h-full min-h-[40vh] sm:min-h-[400px] sm:aspect-[3/4] sm:object-contain"
                />
              ) : img ? (
                <div className="relative w-full h-full flex items-center justify-center p-2">
                  <div className="relative inline-block">
                    <img src={fileUrl} alt={fileName || 'aperçu'} className="max-h-[55vh] sm:max-h-[70vh] max-w-full object-contain" />
                    {bbox && (
                      <div
                        className="absolute border-2 border-amber-400 bg-amber-300/25 rounded-sm pointer-events-none"
                        style={{
                          left: `${(bbox.x ?? 0) * 100}%`,
                          top: `${(bbox.y ?? 0) * 100}%`,
                          width: `${(bbox.width ?? 0) * 100}%`,
                          height: `${(bbox.height ?? 0) * 100}%`,
                        }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm h-full p-6 text-center">
                  <AlertCircle className="w-6 h-6" />
                  <span>Aperçu indisponible pour ce format.</span>
                  <span className="text-xs">Consultez le passage extrait à droite.</span>
                </div>
              )}
            </div>

            {/* Colonne droite : passage source mis en évidence */}
            <div className="p-4 sm:p-2 sm:pr-3 space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground/80">
                <Highlighter className="w-4 h-4 text-amber-500" />
                <span className="truncate">→ {fileName}{sourcePage != null ? ` — page ${sourcePage + 1}` : ''}</span>
              </div>

              {sourceText ? (
                located ? (
                  <div className="text-xs leading-relaxed text-muted-foreground bg-muted/40 rounded-md p-3 max-h-[55vh] overflow-y-auto">
                    <span>{located.text.slice(Math.max(0, located.start - 160), located.start)}</span>
                    <mark className="bg-amber-200 text-foreground px-0.5 rounded-sm not-italic">
                      {located.text.slice(located.start, located.end)}
                    </mark>
                    <span>{located.text.slice(located.end, located.end + 220)}</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs leading-relaxed text-foreground bg-amber-50 border border-amber-200 rounded-md p-3">
                      <p className="font-medium text-amber-900 mb-1 flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5" /> Passage extrait
                      </p>
                      <p className="whitespace-pre-wrap">{sourceText}</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground/70 italic">
                      Localisation exacte non retrouvée dans l'OCR (extrait fourni tel quel).
                    </p>
                  </div>
                )
              ) : ocrText ? (
                <div className="text-xs leading-relaxed text-muted-foreground bg-muted/40 rounded-md p-3 max-h-[55vh] overflow-y-auto whitespace-pre-wrap">
                  {ocrText}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Aucun passage source enregistré pour ce champ.
                </p>
              )}

              {bbox && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 border-2 border-amber-400 rounded-sm" />
                  Zone repérée par l'OCR (cadre orange sur l'aperçu).
                </p>
              )}
            </div>
          </div>

          {/* Pied : ouvrir dans un onglet */}
          <div className="p-3 border-t shrink-0 flex justify-end">
            <a href={fileUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
              Ouvrir le document original <FileText className="w-3.5 h-3.5" />
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}