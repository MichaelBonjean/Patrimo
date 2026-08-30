import React, { useState, useRef, useMemo } from 'react';
import { Upload, X, ChevronDown, ChevronUp, Check, Loader2, RefreshCw, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateFR } from '@/lib/formatters';
import { TRANSACTION_CATEGORIES } from '@/constants/categories';
import { getProcessors, detectProcessor } from '@/lib/import/processorRegistry';
import { manualProcessor } from '@/lib/import/processors/manualProcessor';
import MappingStep from '@/components/import/MappingStep';

const CATEGORIES = TRANSACTION_CATEGORIES.map(c => c.value);
const FILE_PROCESSORS = getProcessors().filter(p => p.acceptFiles);

function ManualForm({ properties, lots, onSubmit, onCancel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    date: today, description: '', amount: '', type: 'income',
    property_id: '', lot_id: '', category: '',
  });
  const propLots = lots.filter(l => l.property_id === form.property_id);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const valid = form.property_id && form.category && Number(form.amount) > 0 && form.date;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Date *</Label>
          <Input type="date" value={form.date} onChange={e => set('date', e.target.value)} className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select value={form.type} onValueChange={v => set('type', v)}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="income">Entrée (+)</SelectItem><SelectItem value="expense">Sortie (-)</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Montant * (€)</Label>
          <Input type="number" step="0.01" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" className="h-8 text-sm number-fr" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Bien *</Label>
          <Select value={form.property_id} onValueChange={v => { set('property_id', v); set('lot_id', ''); }}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Choisir..." /></SelectTrigger>
            <SelectContent>{properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Lot</Label>
          <Select value={form.lot_id || 'none'} onValueChange={v => set('lot_id', v === 'none' ? '' : v)} disabled={!form.property_id}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Tous les lots" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Tous les lots</SelectItem>
              {propLots.map(l => <SelectItem key={l.id} value={l.id}>{l.designation} {l.tenant_name ? `(${l.tenant_name})` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Catégorie *</Label>
          <Select value={form.category} onValueChange={v => set('category', v)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Catégorie..." /></SelectTrigger>
            <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="col-span-2 md:col-span-3">
          <Label className="text-xs text-muted-foreground">Description / Libellé</Label>
          <Input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Ex: Loyer janvier 2025 – M. Dupont" className="h-8 text-sm" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>Annuler</Button>
        <Button size="sm" disabled={!valid} onClick={() => onSubmit(form)}>
          <Check className="w-3.5 h-3.5 mr-1" /> Enregistrer
        </Button>
      </div>
    </div>
  );
}

export default function ImportWizard({ properties, lots, rules, withOwner, queryClient, onClose, initialMode = 'file' }) {
  const [mode, setMode] = useState(initialMode);
  const [step, setStep] = useState('input'); // input | review | done
  const [processor, setProcessor] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState(null);
  const [openRow, setOpenRow] = useState(null);
  const fileRef = useRef(null);
  const lastInput = useRef(null);

  const ctx = useMemo(() => ({ properties, lots, rules, withOwner, queryClient }),
    [properties, lots, rules, withOwner, queryClient]);

  const reset = (toMode = mode) => {
    setStep('input'); setProcessor(null); setParsed(null); setMappings([]); setResult(null); setOpenRow(null);
    setMode(toMode);
    if (fileRef.current) fileRef.current.value = '';
  };

  const runParse = async (proc, input) => {
    const res = await proc.parse(input, ctx);
    const initMaps = res.records.map(r => proc.defaultMapping(r, ctx));
    lastInput.current = input;
    setProcessor(proc);
    setParsed(res);
    setMappings(initMaps);
    setOpenRow(null);
    setStep('review');
  };

  const handleFile = async (file) => {
    if (!file) return;
    let text = '';
    try { text = await file.text(); } catch { /* binary */ }
    const proc = await detectProcessor({ file, text }) || FILE_PROCESSORS[0];
    if (!proc) { toast.error('Format non reconnu'); return; }
    await runParse(proc, { file, text });
  };

  const changeProcessor = async (id) => {
    const proc = getProcessors().find(p => p.id === id);
    if (!proc || !lastInput.current) return;
    await runParse(proc, lastInput.current);
  };

  const updateMapping = (i, patch) => setMappings(prev => prev.map((m, idx) => idx === i ? { ...m, ...patch } : m));
  const toggleInclude = (i) => setMappings(prev => prev.map((m, idx) => idx === i ? { ...m, include: !m.include } : m));
  const includeAll = () => setMappings(prev => prev.map(m => ({ ...m, include: true })));

  const handleSubmitManual = async (record) => {
    setCommitting(true);
    try {
      const txs = await manualProcessor.transform([record], [manualProcessor.defaultMapping(record)], ctx);
      const res = await manualProcessor.commit(txs, ctx);
      setResult(res);
      setStep('done');
      toast.success('Opération enregistrée');
    } catch (e) {
      toast.error(e.message || 'Erreur');
    } finally {
      setCommitting(false);
    }
  };

  const handleCommit = async () => {
    if (!processor || !parsed) return;
    setCommitting(true);
    try {
      const txs = await processor.transform(parsed.records, mappings, ctx);
      if (!txs.length) { toast.error('Aucune ligne valide à importer'); setCommitting(false); return; }
      const res = await processor.commit(txs, ctx);
      setResult(res);
      setStep('done');
      toast.success(`${res.created} transaction${res.created > 1 ? 's' : ''} importée${res.created > 1 ? 's' : ''}`);
    } catch (e) {
      toast.error(e.message || 'Erreur');
    } finally {
      setCommitting(false);
    }
  };

  const validCount = mappings.filter((m, i) => m.include && parsed?.records[i] && m.propertyId && m.category).length;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Upload className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Assistant d'import</p>
            <p className="text-xs text-muted-foreground">CSV / CAF / saisie — détection automatique du format</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {step === 'input' && (
            <div className="flex rounded-lg border border-border p-0.5">
              <button className={cn('px-2.5 h-7 rounded-md text-xs font-medium', mode === 'file' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')} onClick={() => setMode('file')}>Fichier</button>
              <button className={cn('px-2.5 h-7 rounded-md text-xs font-medium', mode === 'manual' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')} onClick={() => setMode('manual')}>Manuel</button>
            </div>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* INPUT — file */}
        {step === 'input' && mode === 'file' && (
          <div
            className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          >
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => handleFile(e.target.files[0])} />
            <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="font-medium text-sm">Déposez ou sélectionnez votre fichier</p>
            <p className="text-xs text-muted-foreground mt-1">Relevé bancaire CSV (Bankin…) ou export CAF — détection auto</p>
            <div className="flex justify-center gap-1.5 mt-3 flex-wrap">
              {FILE_PROCESSORS.map(p => <Badge key={p.id} variant="secondary" className="text-[10px]">{p.label}</Badge>)}
            </div>
          </div>
        )}

        {/* INPUT — manual */}
        {step === 'input' && mode === 'manual' && (
          <ManualForm properties={properties} lots={lots} onSubmit={handleSubmitManual} onCancel={onClose} />
        )}

        {/* REVIEW */}
        {step === 'review' && parsed && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge className="bg-primary/10 text-primary border-0">{processor.label}</Badge>
              <Badge variant="secondary">{parsed.records.length} lignes</Badge>
              <Badge className={cn('border-0', validCount > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground')}>{validCount} prêtes</Badge>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Format :</span>
                <Select value={processor.id} onValueChange={changeProcessor}>
                  <SelectTrigger className="h-7 w-44 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{FILE_PROCESSORS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => reset('file')}><RefreshCw className="w-3.5 h-3.5 mr-1" />Autre fichier</Button>
              </div>
            </div>

            <div className="flex justify-end">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={includeAll}>Tout inclure</Button>
            </div>

            <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="w-8 px-2 py-2"></th>
                    {parsed.columns.map(c => (
                      <th key={c.key} className={cn('px-3 py-2 font-medium text-muted-foreground', c.align === 'right' && 'text-right')}>{c.label}</th>
                    ))}
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Affectation</th>
                    <th className="w-8 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.records.map((r, i) => {
                    const m = mappings[i];
                    const open = openRow === i;
                    const propName = properties.find(p => p.id === m.propertyId)?.name;
                    return (
                      <React.Fragment key={i}>
                        <tr className={cn('border-b border-border/50', !m.include && 'opacity-40', open && 'bg-muted/20')}>
                          <td className="px-2 py-2 text-center">
                            <input type="checkbox" checked={!!m.include} onChange={() => toggleInclude(i)} className="rounded" />
                          </td>
                          {parsed.columns.map(c => (
                            <td key={c.key} className={cn('px-3 py-2', c.align === 'right' && 'text-right')}>
                              {c.kind === 'amount'
                                ? <span className={cn('number-fr font-medium', r[c.key] >= 0 ? 'text-emerald-600' : 'text-red-500')}>{formatCurrency(Math.abs(r[c.key] || 0))}</span>
                                : c.key === 'date' ? formatDateFR(r[c.key])
                                : <span className="truncate max-w-[220px] inline-block align-bottom">{r[c.key]}</span>}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1 flex-wrap">
                              {m.category && <Badge variant="secondary" className="text-[10px]">{m.category}</Badge>}
                              {propName && <span className="text-[10px] text-muted-foreground">{propName}</span>}
                              {!m.category && <span className="text-[10px] text-amber-600">à affecter</span>}
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <button className="text-muted-foreground hover:text-foreground" onClick={() => setOpenRow(open ? null : i)}>
                              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-b border-border/50 bg-muted/10">
                            <td colSpan={parsed.columns.length + 3} className="px-4 py-3">
                              <MappingStep value={m} onChange={patch => updateMapping(i, patch)} properties={properties} lots={lots} categories={CATEGORIES} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2 border-t border-border">
              <Button size="sm" onClick={handleCommit} disabled={committing || validCount === 0}>
                {committing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                Valider {validCount} transaction{validCount > 1 ? 's' : ''}
              </Button>
            </div>
          </>
        )}

        {/* DONE */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check className="w-6 h-6 text-emerald-600" />
            </div>
            <p className="text-sm font-medium">{result?.created ?? 0} transaction{result?.created > 1 ? 's' : ''} importée{result?.created > 1 ? 's' : ''}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => reset('file')}><Plus className="w-3.5 h-3.5 mr-1" />Autre import</Button>
              <Button size="sm" onClick={onClose}>Fermer</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}