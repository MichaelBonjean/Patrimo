import React, { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Upload, Check, X, Loader2, Sparkles, AlertCircle, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { formatCurrency, formatDateFR } from '@/lib/formatters';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TRANSACTION_CATEGORIES, INCOME_CATEGORIES as INCOME_CATS_LIST, getCategoryType } from '@/constants/categories';
import { labelOf, resolveKey } from '@/lib/financeCategories';
// Parseur CSV canonique (RFC 4180) + validateurs stricts — source unique (csvUtils).
import { parseCsv, parseFrenchNumber, parseDate, isCafText } from '@/lib/import/csvUtils';

const ALL_CATEGORIES = TRANSACTION_CATEGORIES.map(c => c.value);
const ALL_LABELS = TRANSACTION_CATEGORIES.map(c => c.label);
const INCOME_CATEGORIES_SET = new Set(INCOME_CATS_LIST);

function getType(category, fallbackType) {
  const type = getCategoryType(category);
  if (type) return type;
  return fallbackType;
}

// Extraction d'un champ par mot-clé (insensible à la casse) dans une ligne objet.
function findInRow(row, headers, keywords) {
  const idx = headers.findIndex(h => keywords.some(k => h.toLowerCase().includes(k)));
  return idx >= 0 ? (row[headers[idx]] ?? '') : '';
}

function recordsFromCsv(text, { incomeOnly }) {
  const { headers, rows, meta } = parseCsv(text);
  const out = [];
  rows.forEach((row) => {
    const amountStr = findInRow(row, headers, ['montant', 'amount', 'débit', 'crédit', 'valeur']);
    const parsed = parseFrenchNumber(amountStr);
    if (!parsed.ok) return; // montant invalide : ligne écartée (pas de 0 silencieux)
    const amount = parsed.value;
    if (incomeOnly ? amount <= 0 : amount === 0) return;
    out.push({
      raw_date: findInRow(row, headers, ['date']),
      description: findInRow(row, headers, ['description', 'libellé', 'libelle', 'opération', 'operation', 'intitulé']),
      bank_category: findInRow(row, headers, ['catégorie', 'categorie', 'type']),
      amount,
      account: findInRow(row, headers, ['compte', 'account']),
    });
  });
  // Les lignes rejetées du parser (guillemets non fermés, etc.) sont visibles dans meta.
  if (meta.rejected > 0 && out.length === 0) return [];
  return out;
}

function parseBankCSV(text) { return recordsFromCsv(text, { incomeOnly: false }); }
function parseCAFCSV(text) {
  return recordsFromCsv(text, { incomeOnly: true }).map((r) => ({ ...r, bank_category: 'CAF', account: '' }));
}
const isCAFFile = isCafText;

const MAX_FILES = 10;

// Helper: find existing transaction matching property+lot+category+month+year
function findExistingTx(transactions, edit, type) {
  if (!edit?.property_id || !edit?.category || !edit?.month || !edit?.year) return null;
  const ek = resolveKey(edit.category);
  return transactions.find(t =>
    t.property_id === edit.property_id &&
    resolveKey(t.category) === ek &&
    t.month === parseInt(edit.month) &&
    t.year === parseInt(edit.year) &&
    t.type === type &&
    (edit.lot_id ? t.lot_id === edit.lot_id : !t.lot_id)
  ) || null;
}

export default function BankStatementAnalyzer({ properties, lots, transactions = [], onClose }) {
  const [step, setStep] = useState('upload'); // upload | analyzing | review | done
  const [pendingFiles, setPendingFiles] = useState([]); // files queued before analysis
  const [analyzeProgress, setAnalyzeProgress] = useState({ done: 0, total: 0 });
  const [tooManyFiles, setTooManyFiles] = useState(false);
  const [proposals, setProposals] = useState([]); // analyzed items
  const [validations, setValidations] = useState({}); // id -> 'accept' | 'reject'
  const [edits, setEdits] = useState({}); // id -> { category, property_id, lot_id, amount, month, year }
  const [showRejected, setShowRejected] = useState(false);
  const fileRef = useRef(null);
  const queryClient = useQueryClient();

  const createTx = useMutation({
    mutationFn: (data) => base44.entities.Transaction.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions'] }),
  });

  const handleFileDrop = (files) => {
    if (files.length > MAX_FILES) { setTooManyFiles(true); return; }
    setPendingFiles(Array.from(files));
  };

  const analyzeFile = async (file, globalIdOffset) => {
    const isPDF = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    const propsList = properties.map(p => `${p.id}:${p.name}`).join(', ');
    const lotsList = lots.map(l => {
      const tenants = [...(l.tenants || []).map(t => t.name), l.tenant_name].filter(Boolean);
      const tenantStr = tenants.length > 0 ? ` [locataires: ${tenants.join(', ')}]` : '';
      return `${l.id}:${l.designation}(bien:${l.property_id})${tenantStr}`;
    }).join(' | ');

    const responseSchema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              description: { type: 'string' },
              raw_date: { type: 'string' },
              amount: { type: 'number' },
              suggested_category: { type: 'string' },
              suggested_property_id: { type: 'string' },
              suggested_lot_id: { type: 'string' },
              type: { type: 'string' },
              confidence: { type: 'string' },
              reason: { type: 'string' },
            }
          }
        }
      }
    };

    let result;

    if (isPDF) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const prompt = `Tu es un expert comptable immobilier français. Voici un relevé bancaire ou CAF en PDF. Extrais TOUTES les transactions et pour chacune, propose une catégorisation pour un logiciel de gestion locative.

Biens disponibles: ${propsList || 'aucun'}
Lots disponibles (avec locataires associés): ${lotsList || 'aucun'}
Catégories disponibles: ${ALL_LABELS.join(', ')}

IMPORTANT pour suggested_lot_id: si le libellé contient le nom d'un locataire, associe OBLIGATOIREMENT au lot correspondant.
IMPORTANT pour suggested_property_id: déduis-le depuis le lot identifié.

Pour chaque transaction: id (0,1,2...), description, raw_date (JJ/MM/AAAA), amount (positif=entrée, négatif=sortie), suggested_category (utilise OBLIGATOIREMENT un libellé exact de la liste ci-dessus), suggested_property_id, suggested_lot_id, type ("income"/"expense"), confidence ("high"/"medium"/"low"), reason (max 10 mots).`;

      result = await base44.integrations.Core.InvokeLLM({ prompt, file_urls: [file_url], response_json_schema: responseSchema });
    } else {
      const text = await file.text();
      const isCaf = isCAFFile(text);
      const raw = isCaf ? parseCAFCSV(text) : parseBankCSV(text);
      if (raw.length === 0) return [];

      const sample = raw.slice(0, 80);
      const prompt = `Tu es un expert comptable immobilier français. Analyse ce relevé ${isCaf ? 'CAF' : 'bancaire'} et pour chaque ligne, propose une catégorisation pour un logiciel de gestion locative.

Biens disponibles: ${propsList || 'aucun'}
Lots disponibles (avec locataires associés): ${lotsList || 'aucun'}
Catégories disponibles: ${ALL_LABELS.join(', ')}

IMPORTANT pour suggested_lot_id: si le libellé contient le nom d'un locataire, associe OBLIGATOIREMENT au lot correspondant.
IMPORTANT pour suggested_property_id: déduis-le depuis le lot identifié.
IMPORTANT pour suggested_category: utilise OBLIGATOIREMENT un libellé exact de la liste ci-dessus.

Lignes (JSON): ${JSON.stringify(sample, null, 2)}

Pour chaque ligne: id, description, raw_date, amount, suggested_category, suggested_property_id, suggested_lot_id, type, confidence, reason.`;

      result = await base44.integrations.Core.InvokeLLM({ prompt, response_json_schema: responseSchema });

      result = {
        items: (result?.items || []).map((item, i) => ({
          ...item,
          amount: raw[i]?.amount ?? item.amount,
          raw_date: raw[i]?.raw_date ?? item.raw_date,
          description: raw[i]?.description ?? item.description,
        }))
      };
    }

    return (result?.items || []).map((item, i) => ({ ...item, id: globalIdOffset + i }));
  };

  const analyzeAll = async () => {
    if (pendingFiles.length === 0) return;
    setStep('analyzing');
    setAnalyzeProgress({ done: 0, total: pendingFiles.length });

    let idOffset = 0;
    const results = await Promise.allSettled(
      pendingFiles.map(async (file) => {
        const items = await analyzeFile(file, idOffset);
        idOffset += items.length;
        setAnalyzeProgress(prev => ({ ...prev, done: prev.done + 1 }));
        return items;
      })
    );

    // Flatten all items, re-assign sequential IDs
    const allItems = results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value)
      .map((item, i) => ({ ...item, id: i }));

    if (allItems.length === 0) {
      toast.error('Aucune transaction trouvée dans les fichiers');
      setStep('upload');
      return;
    }

    const initValidations = {};
    const initEdits = {};
    allItems.forEach(item => {
      initValidations[item.id] = item.confidence === 'high' ? 'accept' : 'pending';
      const parsed = parseDate(item.raw_date);
      initEdits[item.id] = {
        category: resolveKey(item.suggested_category) || '',
        property_id: item.suggested_property_id || '',
        lot_id: item.suggested_lot_id || '',
        amount: Math.abs(item.amount),
        month: parsed?.month || new Date().getMonth() + 1,
        year: parsed?.year || new Date().getFullYear(),
      };
    });

    setProposals(allItems);
    setValidations(initValidations);
    setEdits(initEdits);
    setStep('review');
  };

  const accept = (id) => setValidations(v => ({ ...v, [id]: 'accept' }));
  const reject = (id) => setValidations(v => ({ ...v, [id]: 'reject' }));
  const acceptAll = () => {
    const next = {};
    proposals.forEach(p => { next[p.id] = validations[p.id] === 'reject' ? 'reject' : 'accept'; });
    setValidations(next);
  };

  const updateTx = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Transaction.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['transactions'] }),
  });

  const handleConfirm = async () => {
    const toCreate = proposals.filter(p => validations[p.id] === 'accept');
    if (toCreate.length === 0) {
      toast.error('Aucune transaction acceptée');
      return;
    }
    setStep('done');
    let created = 0, updated = 0;
    for (const item of toCreate) {
      const edit = edits[item.id];
      if (!edit.property_id || !edit.category) continue;
      const existing = findExistingTx(transactions, edit, item.type);
      if (existing) {
        await updateTx.mutateAsync({ id: existing.id, data: { amount: existing.amount + edit.amount } });
        updated++;
      } else {
        await createTx.mutateAsync({
          property_id: edit.property_id,
          lot_id: edit.lot_id || undefined,
          year: edit.year,
          month: edit.month,
          category: edit.category,
          category_label: labelOf(edit.category),
          amount: edit.amount,
          type: item.type,
          note: item.description,
        });
        created++;
      }
    }
    const parts = [];
    if (created > 0) parts.push(`${created} créée${created > 1 ? 's' : ''}`);
    if (updated > 0) parts.push(`${updated} mise${updated > 1 ? 's' : ''} à jour`);
    toast.success(`Cashflow : ${parts.join(', ')}`);
    onClose();
  };

  const pending = proposals.filter(p => validations[p.id] === 'pending');
  const accepted = proposals.filter(p => validations[p.id] === 'accept');
  const rejected = proposals.filter(p => validations[p.id] === 'reject');

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Analyse IA de relevé</p>
            <p className="text-xs text-muted-foreground">Bancaire ou CAF → Cashflow avec validation</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X className="w-4 h-4" /></Button>
      </div>

      {/* Too many files popup */}
      {tooManyFiles && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl space-y-4">
            <p className="text-sm font-semibold text-destructive">Limite dépassée</p>
            <p className="text-sm text-muted-foreground">Veuillez charger <strong>10 documents au maximum</strong> à la fois.</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setTooManyFiles(false)}>Compris</Button>
            </div>
          </div>
        </div>
      )}

      <div className="p-5 space-y-5">
        {/* STEP: upload */}
        {step === 'upload' && (
          <>
            {pendingFiles.length === 0 ? (
              <div
                className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFileDrop(e.dataTransfer.files); }}
              >
                <input ref={fileRef} type="file" accept=".csv,.txt,.pdf" className="hidden" multiple
                  onChange={e => handleFileDrop(e.target.files)} />
                <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="font-medium text-sm">Déposez ou sélectionnez vos relevés</p>
                <p className="text-xs text-muted-foreground mt-1">CSV bancaire, export CAF ou relevé PDF — jusqu'à 10 fichiers</p>
              </div>
            ) : (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-blue-800 font-medium">{pendingFiles.length} fichier{pendingFiles.length > 1 ? 's' : ''} prêt{pendingFiles.length > 1 ? 's' : ''} à analyser en parallèle</p>
                  <div className="flex flex-wrap gap-1.5">
                    {pendingFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-white border border-blue-200">
                        <FileText className="w-3 h-3 text-blue-400" />
                        <span>{f.name.length > 20 ? f.name.slice(0, 18) + '…' : f.name}</span>
                        <button onClick={() => setPendingFiles(p => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive ml-1">×</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPendingFiles([])}>Recommencer</Button>
                  <Button size="sm" onClick={analyzeAll}>
                    <Sparkles className="w-3.5 h-3.5 mr-1" />
                    Analyser {pendingFiles.length > 1 ? `les ${pendingFiles.length} fichiers` : 'le fichier'}
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {/* STEP: analyzing */}
        {step === 'analyzing' && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Sparkles className="w-10 h-10 text-primary animate-pulse" />
            <p className="font-medium text-sm">Analyse IA en cours…</p>
            <p className="text-xs text-muted-foreground">{analyzeProgress.done} / {analyzeProgress.total} fichier{analyzeProgress.total > 1 ? 's' : ''} traité{analyzeProgress.total > 1 ? 's' : ''}</p>
            <div className="w-full max-w-xs bg-muted rounded-full h-2">
              <div className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: analyzeProgress.total ? `${(analyzeProgress.done / analyzeProgress.total) * 100}%` : '0%' }} />
            </div>
          </div>
        )}

        {/* STEP: review */}
        {step === 'review' && proposals.length > 0 && (
          <>
            {/* Summary bar */}
            <div className="flex flex-wrap items-center gap-3">
              <Badge className="bg-amber-100 text-amber-800 border-0">
                {pending.length} à valider
              </Badge>
              <Badge className="bg-emerald-100 text-emerald-700 border-0">
                <Check className="w-3 h-3 mr-1" />{accepted.length} acceptée{accepted.length > 1 ? 's' : ''}
              </Badge>
              <Badge className="bg-red-100 text-red-700 border-0">
                <X className="w-3 h-3 mr-1" />{rejected.length} rejetée{rejected.length > 1 ? 's' : ''}
              </Badge>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={acceptAll}>
                  Tout accepter
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={accepted.length === 0}
                  onClick={handleConfirm}
                >
                  Confirmer {accepted.length} transaction{accepted.length > 1 ? 's' : ''}
                </Button>
              </div>
            </div>

            {properties.length === 0 && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Aucun bien trouvé. Créez d'abord un bien pour affecter les transactions.
              </div>
            )}

            {/* Pending transactions */}
            {pending.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">À valider ({pending.length})</p>
                {pending.map(item => (
                  <TransactionRow
                    key={item.id}
                    item={item}
                    edit={edits[item.id]}
                    properties={properties}
                    lots={lots}
                    transactions={transactions}
                    onEdit={(field, val) => setEdits(prev => ({ ...prev, [item.id]: { ...prev[item.id], [field]: val } }))}
                    onAccept={() => accept(item.id)}
                    onReject={() => reject(item.id)}
                    status="pending"
                  />
                ))}
              </div>
            )}

            {/* Accepted */}
            {accepted.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Acceptées ({accepted.length})</p>
                {accepted.map(item => (
                  <TransactionRow
                    key={item.id}
                    item={item}
                    edit={edits[item.id]}
                    properties={properties}
                    lots={lots}
                    transactions={transactions}
                    onEdit={(field, val) => setEdits(prev => ({ ...prev, [item.id]: { ...prev[item.id], [field]: val } }))}
                    onAccept={() => accept(item.id)}
                    onReject={() => reject(item.id)}
                    status="accept"
                  />
                ))}
              </div>
            )}

            {/* Rejected toggle */}
            {rejected.length > 0 && (
              <div>
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowRejected(v => !v)}
                >
                  {showRejected ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {rejected.length} rejetée{rejected.length > 1 ? 's' : ''} (afficher)
                </button>
                {showRejected && (
                  <div className="mt-2 space-y-2">
                    {rejected.map(item => (
                      <TransactionRow
                        key={item.id}
                        item={item}
                        edit={edits[item.id]}
                        properties={properties}
                        lots={lots}
                        transactions={transactions}
                        onEdit={(field, val) => setEdits(prev => ({ ...prev, [item.id]: { ...prev[item.id], [field]: val } }))}
                        onAccept={() => accept(item.id)}
                        onReject={() => reject(item.id)}
                        status="reject"
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Summary table by month/category for accepted transactions */}
            {accepted.length > 0 && <AcceptedSummaryTable accepted={accepted} edits={edits} properties={properties} lots={lots} />}

            {/* Bottom confirm */}
            <div className="flex justify-end pt-2 border-t border-border">
              <Button
                disabled={accepted.length === 0}
                onClick={handleConfirm}
              >
                <Check className="w-4 h-4 mr-1" />
                Valider et injecter dans le cashflow ({accepted.length})
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const MONTH_NAMES = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

function AcceptedSummaryTable({ accepted, edits, properties, lots }) {
  // Build pivot: category -> month -> amount, and collect all months present
  const incomeRows = {};
  const expenseRows = {};
  const months = new Set();

  accepted.forEach(item => {
    const edit = edits[item.id];
    if (!edit?.category || !edit?.month) return;
    const month = parseInt(edit.month);
    if (isNaN(month)) return;
    const amount = Math.abs(parseFloat(edit.amount) || 0);
    if (amount === 0) return;
    months.add(month);
    // Derive type from category (more reliable than IA-assigned type)
    const isIncome = getCategoryType(edit.category) === 'income' || (getCategoryType(edit.category) === undefined && item.type === 'income');
    if (isIncome) {
      if (!incomeRows[edit.category]) incomeRows[edit.category] = {};
      incomeRows[edit.category][month] = (incomeRows[edit.category][month] || 0) + amount;
    } else {
      if (!expenseRows[edit.category]) expenseRows[edit.category] = {};
      expenseRows[edit.category][month] = (expenseRows[edit.category][month] || 0) + amount;
    }
  });

  const sortedMonths = [...months].sort((a, b) => a - b);

  // Transactions with missing/invalid month — show them separately so nothing is hidden
  const orphans = accepted.filter(item => {
    const m = parseInt(edits[item.id]?.month);
    return isNaN(m) || !edits[item.id]?.category;
  });

  if (sortedMonths.length === 0 && orphans.length === 0) return null;

  const rowTotal = (rowData) => sortedMonths.reduce((s, m) => s + (rowData[m] || 0), 0);
  const colTotal = (type, month) => {
    const rows = type === 'income' ? incomeRows : expenseRows;
    return Object.values(rows).reduce((s, r) => s + (r[month] || 0), 0);
  };

  const hasIncome = Object.keys(incomeRows).length > 0;
  const hasExpense = Object.keys(expenseRows).length > 0;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 bg-muted/40 border-b border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Aperçu cashflow — transactions acceptées</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[140px]">Catégorie</th>
              {sortedMonths.map(m => (
                <th key={m} className="text-center px-2 py-2 font-medium text-muted-foreground min-w-[70px]">{MONTH_NAMES[m - 1]}</th>
              ))}
              <th className="text-center px-3 py-2 font-semibold text-muted-foreground min-w-[80px] bg-muted/50">Total</th>
            </tr>
          </thead>
          <tbody>
            {hasIncome && (
              <>
                <tr className="bg-emerald-50/60">
                  <td colSpan={sortedMonths.length + 2} className="px-3 py-1 font-semibold text-emerald-700 text-[10px] uppercase tracking-wider">Entrées</td>
                </tr>
                {Object.entries(incomeRows).map(([cat, data]) => (
                  <tr key={cat} className="border-b border-border/40 hover:bg-emerald-50/20">
                    <td className="px-3 py-1.5 font-medium text-muted-foreground">{labelOf(cat)}</td>
                    {sortedMonths.map(m => (
                      <td key={m} className="text-center px-2 py-1.5 number-fr text-emerald-600">
                        {data[m] ? formatCurrency(data[m]) : ''}
                      </td>
                    ))}
                    <td className="text-center px-3 py-1.5 number-fr font-semibold text-emerald-700 bg-emerald-50/40">
                      {formatCurrency(rowTotal(data))}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-emerald-200 bg-emerald-50/40 font-semibold">
                  <td className="px-3 py-1.5 text-emerald-700">Total entrées</td>
                  {sortedMonths.map(m => (
                    <td key={m} className="text-center px-2 py-1.5 number-fr text-emerald-700">
                      {colTotal('income', m) > 0 ? formatCurrency(colTotal('income', m)) : ''}
                    </td>
                  ))}
                  <td className="text-center px-3 py-1.5 number-fr text-emerald-700 bg-emerald-100/50">
                    {formatCurrency(sortedMonths.reduce((s, m) => s + colTotal('income', m), 0))}
                  </td>
                </tr>
              </>
            )}
            {hasExpense && (
              <>
                <tr className="bg-red-50/60">
                  <td colSpan={sortedMonths.length + 2} className="px-3 py-1 font-semibold text-red-700 text-[10px] uppercase tracking-wider">Sorties</td>
                </tr>
                {Object.entries(expenseRows).map(([cat, data]) => (
                  <tr key={cat} className="border-b border-border/40 hover:bg-red-50/20">
                    <td className="px-3 py-1.5 font-medium text-muted-foreground">{labelOf(cat)}</td>
                    {sortedMonths.map(m => (
                      <td key={m} className="text-center px-2 py-1.5 number-fr text-red-500">
                        {data[m] ? formatCurrency(data[m]) : ''}
                      </td>
                    ))}
                    <td className="text-center px-3 py-1.5 number-fr font-semibold text-red-600 bg-red-50/40">
                      {formatCurrency(rowTotal(data))}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-red-200 bg-red-50/40 font-semibold">
                  <td className="px-3 py-1.5 text-red-700">Total sorties</td>
                  {sortedMonths.map(m => (
                    <td key={m} className="text-center px-2 py-1.5 number-fr text-red-700">
                      {colTotal('expense', m) > 0 ? formatCurrency(colTotal('expense', m)) : ''}
                    </td>
                  ))}
                  <td className="text-center px-3 py-1.5 number-fr text-red-700 bg-red-100/50">
                    {formatCurrency(sortedMonths.reduce((s, m) => s + colTotal('expense', m), 0))}
                  </td>
                </tr>
              </>
            )}
          {/* Orphan transactions with no valid month */}
          {orphans.length > 0 && (
            <tr>
              <td colSpan={sortedMonths.length + 2} className="px-3 py-2 bg-amber-50/60 text-amber-700 text-[11px]">
                ⚠ {orphans.length} transaction{orphans.length > 1 ? 's' : ''} sans mois valide (à corriger ci-dessus) :&nbsp;
                {orphans.map(item => {
                  const edit = edits[item.id];
                  return <span key={item.id} className="mr-2 font-medium">{item.description} ({formatCurrency(Math.abs(edit?.amount || 0))})</span>;
                })}
              </td>
            </tr>
          )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransactionRow({ item, edit, properties, lots, transactions, onEdit, onAccept, onReject, status }) {
  const [open, setOpen] = useState(false);
  const filteredLots = lots.filter(l => l.property_id === edit?.property_id);
  const confidenceColor = item.confidence === 'high' ? 'text-emerald-600' : item.confidence === 'medium' ? 'text-amber-600' : 'text-red-500';
  const existingTx = findExistingTx(transactions, edit, item.type);

  return (
    <div className={cn(
      'rounded-lg border transition-colors',
      status === 'accept' && 'border-emerald-200 bg-emerald-50/40',
      status === 'reject' && 'border-red-100 bg-red-50/30 opacity-60',
      status === 'pending' && 'border-amber-200 bg-amber-50/30',
    )}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Accept/Reject */}
        <div className="flex gap-1 shrink-0">
          <button
            className={cn('w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors',
              status === 'accept' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-border hover:border-emerald-400')}
            onClick={onAccept}
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            className={cn('w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors',
              status === 'reject' ? 'border-red-500 bg-red-500 text-white' : 'border-border hover:border-red-400')}
            onClick={onReject}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Date + description */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">{item.raw_date}</span>
            <span className="text-xs font-medium truncate">{item.description}</span>
            <span className={cn('text-[10px] shrink-0', confidenceColor)}>● {item.confidence}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{labelOf(edit?.category) || '?'}</Badge>
            {edit?.property_id && <span className="text-[10px] text-muted-foreground">{properties.find(p => p.id === edit.property_id)?.name || ''}</span>}
            {item.reason && <span className="text-[10px] text-muted-foreground italic">{item.reason}</span>}
          </div>
        </div>

        {/* Amount + existing indicator */}
        <div className="flex flex-col items-end shrink-0">
          <span className={cn('text-sm font-semibold number-fr', item.type === 'income' ? 'text-emerald-600' : 'text-red-500')}>
            {item.type === 'expense' ? '-' : '+'}{formatCurrency(Math.abs(edit?.amount ?? item.amount))}
          </span>
          {existingTx && (
            <span className="text-[10px] text-amber-600 number-fr" title="Montant déjà dans le cashflow — sera additionné">
              déjà {formatCurrency(existingTx.amount)} → {formatCurrency(existingTx.amount + (edit?.amount ?? 0))}
            </span>
          )}
        </div>

        {/* Expand edit */}
        <button className="text-muted-foreground hover:text-foreground shrink-0" onClick={() => setOpen(v => !v)}>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded edit */}
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50 grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Catégorie</p>
            <Select value={edit?.category || ''} onValueChange={v => onEdit('category', v)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{ALL_CATEGORIES.map(c => <SelectItem key={c} value={c}>{labelOf(c)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Bien</p>
            <Select value={edit?.property_id || ''} onValueChange={v => onEdit('property_id', v)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="— bien —" /></SelectTrigger>
              <SelectContent>{properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Lot (optionnel)</p>
            <Select value={edit?.lot_id || ''} onValueChange={v => onEdit('lot_id', v)} disabled={!edit?.property_id}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="— lot —" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Aucun lot</SelectItem>
                {filteredLots.map(l => <SelectItem key={l.id} value={l.id}>{l.designation}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Montant €</p>
            <Input
              type="number"
              className="h-7 text-xs"
              value={edit?.amount ?? ''}
              onChange={e => onEdit('amount', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Mois</p>
            <Select value={String(edit?.month || '')} onValueChange={v => onEdit('month', parseInt(v))}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <SelectItem key={m} value={String(m)}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground mb-1">Année</p>
            <Input
              type="number"
              className="h-7 text-xs"
              value={edit?.year ?? ''}
              onChange={e => onEdit('year', parseInt(e.target.value) || new Date().getFullYear())}
            />
          </div>
        </div>
      )}
    </div>
  );
}