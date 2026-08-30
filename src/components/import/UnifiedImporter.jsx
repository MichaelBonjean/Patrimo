import React, { useState, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, X, Landmark, HeartPulse, FileSpreadsheet, FileText, PencilLine, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { runPipeline, rowsToTransactions } from '@/lib/import/pipeline';
import { aiCategorize } from '@/lib/import/aiCategorize';
import { commitTransactions } from '@/lib/import/commit';
import { TRANSACTION_CATEGORIES, labelOf } from '@/lib/financeCategories';
import PreviewTable from '@/components/import/PreviewTable';
import DocumentImporter from '@/components/import/DocumentImporter';
import SlowLoadingMessage from '@/components/ui/SlowLoadingMessage';

const TYPES = [
  { id: 'bank', label: 'Relevé bancaire', desc: 'CSV bancaire ou PDF', icon: Landmark, accept: '.csv,.txt,.pdf', multiple: true },
  { id: 'caf', label: 'CAF', desc: 'Export allocations CSV', icon: HeartPulse, accept: '.csv,.txt', multiple: true },
  { id: 'excel', label: 'Excel existant', desc: 'Tableau financier .xlsx', icon: FileSpreadsheet, accept: '.xlsx,.xls', multiple: true },
  { id: 'document', label: 'Document', desc: 'Bail, DPE, prêt, facture…', icon: FileText },
  { id: 'manual', label: 'Saisie manuelle', desc: 'Une opération', icon: PencilLine },
];

const CATEGORIES = TRANSACTION_CATEGORIES.map((c) => c.value);

function ManualForm({ onSubmit, properties, lots }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ date: today, description: '', amount: '', type: 'income', property_id: '', lot_id: '', category: '' });
  const propLots = lots.filter((l) => l.property_id === form.property_id);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const valid = form.property_id && form.category && Number(form.amount) > 0 && form.date;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <div><Label className="text-xs text-muted-foreground">Date *</Label><Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className="h-8 text-sm" /></div>
      <div><Label className="text-xs text-muted-foreground">Type</Label>
        <Select value={form.type} onValueChange={(v) => set('type', v)}><SelectTrigger className="h-8"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="income">Entrée (+)</SelectItem><SelectItem value="expense">Sortie (-)</SelectItem></SelectContent></Select>
      </div>
      <div><Label className="text-xs text-muted-foreground">Montant * (€)</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" className="h-8 text-sm number-fr" /></div>
      <div><Label className="text-xs text-muted-foreground">Bien *</Label>
        <Select value={form.property_id} onValueChange={(v) => { set('property_id', v); set('lot_id', ''); }}><SelectTrigger className="h-8"><SelectValue placeholder="Choisir..." /></SelectTrigger><SelectContent>{properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select>
      </div>
      <div><Label className="text-xs text-muted-foreground">Lot</Label>
        <Select value={form.lot_id || 'none'} onValueChange={(v) => set('lot_id', v === 'none' ? '' : v)} disabled={!form.property_id}><SelectTrigger className="h-8"><SelectValue placeholder="Tous les lots" /></SelectTrigger><SelectContent><SelectItem value="none">Tous les lots</SelectItem>{propLots.map((l) => <SelectItem key={l.id} value={l.id}>{l.designation}</SelectItem>)}</SelectContent></Select>
      </div>
      <div><Label className="text-xs text-muted-foreground">Catégorie *</Label>
        <Select value={form.category} onValueChange={(v) => set('category', v)}><SelectTrigger className="h-8"><SelectValue placeholder="Catégorie..." /></SelectTrigger><SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{labelOf(c)}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="col-span-2 md:col-span-3"><Label className="text-xs text-muted-foreground">Description</Label><Input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Ex: Loyer janvier 2025 – M. Dupont" className="h-8 text-sm" /></div>
      <div className="col-span-2 md:col-span-3 flex justify-end">
        <Button size="sm" disabled={!valid} onClick={() => onSubmit(form)}><Check className="w-3.5 h-3.5 mr-1" />Ajouter à l'aperçu</Button>
      </div>
    </div>
  );
}

export default function UnifiedImporter({ properties, lots, rules, transactions, bankTransactions, withOwner, queryClient, onClose }) {
  const [type, setType] = useState(null);
  const [files, setFiles] = useState([]);
  const [rows, setRows] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [manualForm, setManualForm] = useState(null);
  const fileRef = useRef(null);

  const ctx = useMemo(() => ({ properties, lots, rules, existing: transactions, bankTransactions, withOwner, queryClient }),
    [properties, lots, rules, transactions, bankTransactions, withOwner, queryClient]);

  const reset = () => { setType(null); setFiles([]); setRows(null); setManualForm(null); if (fileRef.current) fileRef.current.value = ''; };
  const activeType = TYPES.find((t) => t.id === type);

  const handleFiles = (list) => {
    const arr = Array.from(list || []);
    if (!activeType?.multiple && arr.length > 1) { setFiles([arr[0]]); return; }
    setFiles(arr);
  };

  const launch = async () => {
    setParsing(true);
    try {
      const { rows: parsed } = await runPipeline({ type, files, manualRecord: manualForm }, ctx);
      setRows(parsed);
      if (!parsed.length) toast.info('Aucune ligne détectée dans le fichier');
    } catch (e) {
      toast.error(e.message || "Erreur lors de l'analyse du fichier");
    } finally {
      setParsing(false);
    }
  };

  const onAICategorize = async () => {
    setAiRunning(true);
    try {
      await aiCategorize(rows, ctx);
      setRows([...rows]);
      toast.success('Analyse IA terminée — vérifiez les lignes « à vérifier »');
    } catch (e) {
      toast.error(e.message || 'Erreur IA');
    } finally {
      setAiRunning(false);
    }
  };

  const onCommit = async () => {
    setCommitting(true);
    try {
      const txs = rowsToTransactions(rows);
      if (!txs.length) { toast.error('Aucune ligne à valider'); setCommitting(false); return; }
      const res = await commitTransactions(txs, ctx);
      toast.success(`${res.created} transaction${res.created > 1 ? 's' : ''} importée${res.created > 1 ? 's' : ''}`);
      reset();
    } catch (e) {
      toast.error(e.message || 'Erreur lors de la validation');
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary/10"><Upload className="w-4 h-4 text-primary" /></div>
          <div>
            <p className="text-sm font-semibold">Importer</p>
            <p className="text-xs text-muted-foreground">Relevé, CAF, Excel, document ou saisie — pipeline unifié</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(type || rows) && <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={reset}>← Changer de type</Button>}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <SlowLoadingMessage isLoading={parsing} message={type === 'bank' ? 'Analyse du relevé bancaire en cours…' : 'Analyse du fichier en cours…'} />
        <SlowLoadingMessage isLoading={aiRunning} message={`Catégorisation IA de ${rows?.length || 0} lignes…`} />
        <SlowLoadingMessage isLoading={committing} message={`Enregistrement de ${rows?.length || 0} transactions…`} />

        {/* Étape 1 : sélecteur de type */}
        {!type && !rows && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {TYPES.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => { setType(t.id); if (t.id === 'manual') setManualForm({}); }}
                  className="p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-all text-left space-y-1.5">
                  <Icon className="w-5 h-5 text-primary" />
                  <p className="text-sm font-semibold">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.desc}</p>
                </button>
              );
            })}
          </div>
        )}

        {/* Document : flux dédié (création d'entités) */}
        {type === 'document' && !rows && (
          <DocumentImporter properties={properties} lots={lots} onClose={onClose} />
        )}

        {/* Étape 2 : saisie du fichier */}
        {type && type !== 'document' && !rows && type !== 'manual' && (
          <>
            <div className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
              <input ref={fileRef} type="file" accept={activeType.accept} multiple={activeType.multiple} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
              <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="font-medium text-sm">Déposez ou sélectionnez {activeType.multiple ? 'vos fichiers' : 'votre fichier'}</p>
              <p className="text-xs text-muted-foreground mt-1">{activeType.accept}</p>
            </div>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted border border-border">
                    <span>{f.name.length > 22 ? f.name.slice(0, 20) + '…' : f.name}</span>
                    <button className="text-muted-foreground hover:text-destructive" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <Button size="sm" disabled={!files.length || parsing} onClick={launch}>
                {parsing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                {parsing ? 'Analyse…' : `Analyser ${files.length || ''} fichier${files.length > 1 ? 's' : ''}`}
              </Button>
            </div>
          </>
        )}

        {/* Saisie manuelle : formulaire avant pipeline */}
        {type === 'manual' && !rows && (
          <ManualForm onSubmit={(rec) => setManualForm(rec)} properties={properties} lots={lots} />
        )}
        {type === 'manual' && manualForm && !rows && (
          <div className="flex justify-end"><Button size="sm" onClick={launch}><Check className="w-4 h-4 mr-1" />Ajouter à l'aperçu</Button></div>
        )}

        {/* Étape 3 : aperçu unifié (statuts) */}
        {rows && (
          <PreviewTable rows={rows} onChange={setRows} onAICategorize={onAICategorize} onCommit={onCommit}
            aiRunning={aiRunning} committing={committing} properties={properties} lots={lots} />
        )}
      </div>
    </div>
  );
}