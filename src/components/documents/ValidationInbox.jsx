import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Pencil, ArrowRight, ShieldAlert, Sparkles, Eye, Loader2, Check } from 'lucide-react';
import { formatAmount, formatDateFR } from '@/lib/documents';
import { CLASS_LABELS } from '@/lib/documentsSourceLabels';
import DocumentSourceViewer, { hasSource, SENSITIVE_SOURCE_FIELDS } from '@/components/documents/DocumentSourceViewer';

const HIGH = 0.85;

const ENTITY_LABEL = {
  Property: 'Bien', Lot: 'Lot', Lease: 'Bail', Holder: 'Détenteur',
  Transaction: 'Transaction', Document: 'Document',
};

// Champs présentés dans l'Inbox (clé -> libellé métier lisible).
const PREVIEW_FIELDS = {
  Property: [['name', 'Nom'], ['address', 'Adresse'], ['city', 'Ville'], ['purchase_price', 'Prix d’achat'], ['loan_amount', 'Montant prêt'], ['loan_rate', 'Taux']],
  Lot: [['designation', 'Désignation'], ['surface', 'Surface'], ['typology', 'Typologie'], ['dpe_class', 'DPE'], ['ges_class', 'GES']],
  Lease: [['date_start', 'Effet du bail'], ['date_end', 'Fin'], ['lease_type', 'Type'], ['rent_excluding_charges', 'Loyer mensuel'], ['charges', 'Charges'], ['deposit', 'Caution']],
  Holder: [['name', 'Nom'], ['siret', 'SIRET'], ['capital', 'Capital'], ['type', 'Type']],
  Transaction: [['category', 'Catégorie'], ['amount', 'Montant'], ['year', 'Année']],
  Document: [['title', 'Titre'], ['document_date', 'Date'], ['amount', 'Montant']],
};

function displayValue(key, v) {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return v.length + ' élément(s)';
  if (/date|_at|_start|_end/i.test(key) && typeof v === 'string') return formatDateFR(v);
  if (/amount|price|rent|charges|deposit|capital|surface/i.test(key) && typeof v === 'number') return formatAmount(v) || v;
  return String(v);
}

function rawValue(v) {
  if (v == null) return '';
  return String(v);
}

function isDateKey(k) { return /date|_at|_start|_end/i.test(k); }
function isNumKey(k) { return /amount|price|rent|charges|deposit|capital|surface|rate|percent/i.test(k); }

function confColor(c) {
  if (c >= 0.85) return 'bg-emerald-500';
  if (c >= 0.6) return 'bg-amber-500';
  return 'bg-rose-500';
}

/** Aplatit le plan en items champ par champ, avec confiance + sensibilité + source. */
function buildItems(plan, record) {
  const targets = plan?.targets || [];
  const confMap = record?.confidence_per_field || {};
  const items = [];
  targets.forEach((t, tIndex) => {
    const fields = PREVIEW_FIELDS[t.entity] || [];
    for (const [key, label] of fields) {
      const val = t.data?.[key];
      const disp = displayValue(key, val);
      if (disp == null) continue;
      const fieldConf = confMap[key] != null ? Number(confMap[key]) : (t.confidence ?? 0.5);
      const sensitive = SENSITIVE_SOURCE_FIELDS.has(key);
      const needsAttention = !!t.needs_review || fieldConf < HIGH || sensitive;
      items.push({
        key: `${t.entity}|${t.action}|${tIndex}|${key}`,
        entity: t.entity,
        entityLabel: ENTITY_LABEL[t.entity] || t.entity,
        action: t.action,
        field: key,
        label,
        value: val,
        display: disp,
        confidence: Math.max(0, Math.min(1, fieldConf)),
        sensitive,
        needsAttention,
        reason: t.reason || '',
        record,
      });
    }
  });
  return items;
}

function sourceLabel(record, field) {
  const prov = record?.extracted_data_provenance?.[field] || record?.provenance?.[field] || {};
  const page = prov.source_page;
  const docLabel = CLASS_LABELS[record?.classification] || record?.classification || 'Document';
  return page != null ? `${docLabel} — page ${page + 1}` : docLabel;
}

export default function ValidationInbox({ plan, record, onCommit, commitPending }) {
  const items = useMemo(() => buildItems(plan, record), [plan, record]);
  const attention = useMemo(() => items.filter((i) => i.needsAttention), [items]);
  const auto = useMemo(() => items.filter((i) => !i.needsAttention), [items]);

  const [phase, setPhase] = useState('intro'); // intro | review | done
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [corrections, setCorrections] = useState({}); // itemKey -> { field, old, new, entity }

  // Réinitialise l'état quand le plan change (nouveau document).
  // (useMemo sur plan/id suffit ; pas d'effet de bord.)
  const reset = () => { setPhase('intro'); setCursor(0); setEditing(false); setDraft(''); setCorrections({}); };
  const planId = record?.id;
  const lastPlanIdRef = React.useRef(planId);
  if (lastPlanIdRef.current !== planId) { lastPlanIdRef.current = planId; reset(); }

  const startReview = () => {
    if (attention.length === 0) { setPhase('done'); return; }
    setCursor(0); setPhase('review');
  };

  const advance = () => {
    setEditing(false);
    setDraft('');
    if (cursor + 1 >= attention.length) setPhase('done');
    else setCursor(cursor + 1);
  };

  const confirmCurrent = () => advance();

  const startEdit = (item) => {
    setEditing(true);
    setDraft(rawValue(item.value));
  };

  const saveEdit = (item) => {
    const old = item.value;
    const newRaw = draft;
    const parsed = isDateKey(item.field) ? newRaw
      : isNumKey(item.field) ? (newRaw === '' ? '' : Number(newRaw.replace(',', '.')))
      : newRaw;
    setCorrections((c) => ({
      ...c,
      [item.key]: { field: item.field, entity: item.entity, old, new: parsed },
    }));
    toastCorrectionSaved(item.label);
    advance();
  };

  // --- Done : prépare le payload de commit ---
  const commit = () => {
    const cList = Object.values(corrections);
    onCommit({ corrections: cList, autoCount: auto.length });
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
        <p className="text-sm font-medium">Tout est prêt ✓</p>
        <p className="text-xs text-muted-foreground mt-1">Aucune donnée extraite à valider — fiche justificative seule.</p>
        <Button className="mt-4" onClick={commit} disabled={commitPending}>
          {commitPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
          Valider l’import
        </Button>
      </div>
    );
  }

  if (phase === 'intro') {
    const canBulkConfirm = attention.length === 0;
    return (
      <div className="space-y-5">
        <div className="text-center space-y-1 pt-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-1">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <p className="text-lg font-display">Nous avons presque terminé.</p>
          <p className="text-sm text-muted-foreground">
            {attention.length > 0
              ? `${attention.length} information${attention.length > 1 ? 's' : ''} nécessite${attention.length > 1 ? 'nt' : ''} votre confirmation.`
              : 'Toutes les informations sont fiables et non sensibles.'}
          </p>
          {auto.length > 0 && (
            <p className="text-xs text-muted-foreground/80">
              {auto.length} donnée{auto.length > 1 ? 's' : ''} fiable{auto.length > 1 ? 's' : ''} validée{auto.length > 1 ? 's' : ''} automatiquement.
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 justify-center pt-1">
          {attention.length > 0 && (
            <Button onClick={startReview}>
              Vérifier les {attention.length} information{attention.length > 1 ? 's' : ''}
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          )}
          <Button
            variant={attention.length > 0 ? 'outline' : 'default'}
            onClick={startReview}
            disabled={!canBulkConfirm && attention.length > 0}
            title={canBulkConfirm ? 'Tout confirmer (donnees fiables)' : 'Des informations sensibles nécessitent votre vérification'}
          >
            <Check className="w-4 h-4 mr-1" />
            Tout confirmer
          </Button>
        </div>
        {attention.length > 0 && (
          <p className="text-[11px] text-center text-muted-foreground/70">
            « Tout confirmer » reste disponible uniquement pour les données non sensibles et fortement fiables.
          </p>
        )}
      </div>
    );
  }

  if (phase === 'review') {
    const item = attention[cursor];
    if (!item) { setPhase('done'); return null; }
    const corrected = corrections[item.key];
    const shown = corrected ? corrected.new : item.value;
    const shownDisplay = displayValue(item.field, shown);
    const srcLbl = sourceLabel(record, item.field);
    const canView = hasSource(record, item.field);

    return (
      <div className="space-y-4">
        {/* Progression */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Information {cursor + 1} / {attention.length}</span>
          <div className="flex items-center gap-1.5">
            <span className="flex h-1.5 w-20 rounded bg-muted overflow-hidden">
              <span className={`h-full ${confColor(item.confidence)}`} style={{ width: `${Math.round(item.confidence * 100)}%` }} />
            </span>
            {Math.round(item.confidence * 100)}%
          </div>
        </div>

        {/* Carte de la donnée */}
        <div className="rounded-lg border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">{item.entityLabel}</Badge>
            {item.sensitive && (
              <Badge className="bg-amber-500 border-amber-500 text-[10px]"><ShieldAlert className="w-3 h-3 mr-1" />Sensible</Badge>
            )}
          </div>

          <div>
            <p className="text-xs text-muted-foreground">{item.label}</p>
            {editing ? (
              <div className="mt-1 space-y-2">
                <Input
                  type={isDateKey(item.field) ? 'date' : isNumKey(item.field) ? 'number' : 'text'}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoFocus
                  step={isNumKey(item.field) ? '0.01' : undefined}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveEdit(item)} disabled={draft === rawValue(item.value)}>
                    <Check className="w-3.5 h-3.5 mr-1" /> Enregistrer
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(''); }}>
                    Annuler
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-display">{shownDisplay ?? '—'}</span>
                {corrected && <Badge variant="outline" className="text-[10px]">Modifié</Badge>}
              </div>
            )}
          </div>

          {/* Source */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-2">
            <span className="shrink-0">Source :</span>
            <span className="truncate">{srcLbl}</span>
            {canView && (
              <DocumentSourceViewer record={record} field={item.field} value={shownDisplay} label={item.label} compact />
            )}
          </div>

          {item.reason && !editing && (
            <p className="text-[11px] text-muted-foreground/80 flex items-start gap-1 border-t pt-2">
              <ArrowRight className="w-3 h-3 mt-0.5 shrink-0" />{item.reason}
            </p>
          )}
        </div>

        {/* Actions */}
        {!editing && (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={confirmCurrent}>
              <CheckCircle2 className="w-4 h-4 mr-2" /> Correct
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => startEdit(item)}>
              <Pencil className="w-4 h-4 mr-2" /> Modifier
            </Button>
          </div>
        )}
      </div>
    );
  }

  // phase === 'done'
  const nbCorr = Object.keys(corrections).length;
  return (
    <div className="flex flex-col items-center justify-center py-6 text-center space-y-3">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100">
        <CheckCircle2 className="w-8 h-8 text-emerald-600" />
      </div>
      <p className="text-xl font-display">Tout est prêt ✓</p>
      <p className="text-sm text-muted-foreground">
        {attention.length + auto.length} information{(attention.length + auto.length) > 1 ? 's' : ''} traitée{(attention.length + auto.length) > 1 ? 's' : ''}
        {nbCorr > 0 && ` · ${nbCorr} corrigée${nbCorr > 1 ? 's' : ''}`}.
      </p>
      <Button className="mt-2" onClick={commit} disabled={commitPending}>
        {commitPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
        Valider l’import
      </Button>
    </div>
  );
}

function toastCorrectionSaved(label) {
  // Feedback léger côté console ; le toast global est géré au commit par le parent.
  // (garde la signature stable si on active sonner plus tard)
  try { console.info(`[ValidationInbox] correction enregistrée : ${label}`); } catch (_) { /* noop */ }
}