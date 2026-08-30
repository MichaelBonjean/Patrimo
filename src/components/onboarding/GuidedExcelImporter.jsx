import React, { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Check, Loader2, AlertTriangle, Copy, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { base44 } from '@/api/base44Client';
import { ENTITY_FIELDS } from '@/lib/onboarding/fieldMaps';
import { parseSheet, autoMapping, buildRecords, STATUS_META } from '@/lib/onboarding/excel';

const NONE = '__none__';

function MappingRow({ label, required, headers, value, onChange, guess }) {
  return (
    <div className="grid grid-cols-12 items-center gap-2 py-1.5">
      <div className="col-span-5 text-xs text-muted-foreground">
        {label} {required && <span className="text-red-500">*</span>}
      </div>
      <div className="col-span-2 text-center text-xs text-muted-foreground">←</div>
      <div className="col-span-5">
        <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Aucune" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>— Aucune —</SelectItem>
            {headers.map((h) => (
              <SelectItem key={h} value={h}>{h}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export default function GuidedExcelImporter({ entityType, ownerEmail, ctx, onImported }) {
  const def = ENTITY_FIELDS[entityType];
  const fileRef = useRef(null);
  const [phase, setPhase] = useState('drop');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({ links: {}, fields: {} });
  const [records, setRecords] = useState(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState(null);

  const reset = () => {
    setPhase('drop'); setHeaders([]); setRows([]); setMapping({ links: {}, fields: {} });
    setRecords(null); setSummary(null); setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFile = async (file) => {
    if (!file) return;
    try {
      const { headers: h, rows: r } = await parseSheet(file);
      if (!r.length) { toast.error('Aucune ligne trouvée dans le fichier'); return; }
      setFileName(file.name); setHeaders(h); setRows(r);
      setMapping(autoMapping(h, entityType));
      setPhase('mapping');
      setRecords(null); setSummary(null);
    } catch (e) {
      toast.error('Lecture du fichier impossible : ' + (e?.message || 'format non reconnu'));
    }
  };

  const preview = () => {
    const recs = buildRecords(entityType, rows, mapping, ctx);
    setRecords(recs);
    setPhase('preview');
  };

  const counts = records
    ? {
        ok: records.filter((r) => r.status === 'ok').length,
        dup: records.filter((r) => r.status === 'duplicate').length,
        err: records.filter((r) => r.status === 'error').length,
      }
    : null;

  const handleImport = async () => {
    const valid = records.filter((r) => r.status === 'ok').map((r) => ({ ...r.rec, owner_id: ownerEmail, is_demo: false }));
    if (!valid.length) { toast.error('Aucune ligne valide à importer'); return; }
    setImporting(true);
    try {
      const batches = [];
      for (let i = 0; i < valid.length; i += 100) batches.push(valid.slice(i, i + 100));
      let created = 0;
      for (const b of batches) {
        const res = await base44.entities[def.entity].bulkCreate(b);
        created += res?.length ?? b.length;
      }
      setSummary({ created, duplicates: counts.dup, errors: counts.err, total: records.length });
      setPhase('done');
      toast.success(`${created} ${def.singular}${created > 1 ? 's' : ''} importé${created > 1 ? 's' : ''}`);
      onImported?.();
    } catch (e) {
      toast.error('Import échoué : ' + (e?.message || 'erreur serveur'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      {phase === 'drop' && (
        <div
          className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        >
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
          <FileSpreadsheet className="w-9 h-9 mx-auto mb-2 text-muted-foreground/60" />
          <p className="text-sm font-medium">Déposez votre fichier Excel ou CSV</p>
          <p className="text-xs text-muted-foreground mt-1">{def.label} — vous mapirez ensuite vos colonnes</p>
          <div className="flex items-center justify-center gap-1.5 mt-2 text-[10px] text-muted-foreground">
            <Upload className="w-3 h-3" /> .xlsx, .xls, .csv
          </div>
        </div>
      )}

      {phase === 'mapping' && (
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">{fileName}</Badge>
              <span className="text-xs text-muted-foreground">{rows.length} lignes · {headers.length} colonnes</span>
            </div>
            <Button variant="ghost" size="sm" className="h-7" onClick={reset}><X className="w-3.5 h-3.5" /></Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Associez chaque champ <span className="font-medium text-foreground">Patrimo</span> à la colonne correspondante de votre fichier. Les champs obligatoires sont marqués <span className="text-red-500">*</span>.
          </p>
          <div className="rounded-lg border border-border divide-y divide-border max-h-[340px] overflow-auto px-3">
            {def.links.map((l) => (
              <MappingRow key={l.key} label={l.label} required={l.required} headers={headers}
                value={mapping.links[l.key]} onChange={(v) => setMapping((m) => ({ ...m, links: { ...m.links, [l.key]: v } }))} />
            ))}
            {def.fields.map((f) => (
              <MappingRow key={f.key} label={f.label} required={f.required} headers={headers}
                value={mapping.fields[f.key]} onChange={(v) => setMapping((m) => ({ ...m, fields: { ...m.fields, [f.key]: v } }))} />
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={reset}>Annuler</Button>
            <Button size="sm" onClick={preview}><Check className="w-3.5 h-3.5 mr-1" /> Prévisualiser</Button>
          </div>
        </div>
      )}

      {phase === 'preview' && records && counts && (
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-emerald-100 text-emerald-700 border-0">{counts.ok} prêts</Badge>
            {counts.dup > 0 && <Badge className="bg-amber-100 text-amber-700 border-0">{counts.dup} doublons</Badge>}
            {counts.err > 0 && <Badge className="bg-red-100 text-red-700 border-0">{counts.err} invalides</Badge>}
            <Button variant="ghost" size="sm" className="h-7 ml-auto" onClick={() => setPhase('mapping')}>Modifier le mapping</Button>
          </div>
          <div className="max-h-[300px] overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="px-2 py-2 text-left font-medium text-muted-foreground w-20">Statut</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Détail</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Problèmes</th>
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 60).map((r, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="px-2 py-1.5">
                      <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium', STATUS_META[r.status].cls)}>
                        {STATUS_META[r.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {entityType === 'property' && r.rec.name}
                      {entityType === 'lot' && `${r.rec.designation || ''} · ${headers.find((h) => false) || ''}`}
                      {entityType === 'lease' && `${r.rec.tenants?.[0]?.name || '—'} · ${r.rec.date_start || ''}`}
                    </td>
                    <td className="px-3 py-1.5 text-red-500">
                      {r.errors.map((e) => e.message).join(' · ')}
                      {r.warnings.map((w) => w.message).join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {records.length > 60 && <p className="text-[10px] text-muted-foreground px-3 py-1.5">… {records.length - 60} lignes supplémentaires non affichées</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setPhase('mapping')}>Retour</Button>
            <Button size="sm" onClick={handleImport} disabled={importing || counts.ok === 0}>
              {importing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
              Importer {counts.ok} {def.singular}{counts.ok > 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      )}

      {phase === 'done' && summary && (
        <div className="p-6 flex flex-col items-center text-center gap-2">
          <div className="w-11 h-11 rounded-full bg-emerald-100 flex items-center justify-center"><Check className="w-5 h-5 text-emerald-600" /></div>
          <p className="text-sm font-medium">{summary.created} {def.singular}{summary.created > 1 ? 's' : ''} importé{summary.created > 1 ? 's' : ''}</p>
          <div className="flex gap-3 text-xs text-muted-foreground">
            {summary.duplicates > 0 && <span className="flex items-center gap-1"><Copy className="w-3 h-3" /> {summary.duplicates} doublons ignorés</span>}
            {summary.errors > 0 && <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="w-3 h-3" /> {summary.errors} lignes invalides</span>}
          </div>
          <div className="flex gap-2 mt-1">
            <Button variant="outline" size="sm" onClick={reset}>Importer un autre fichier</Button>
            <Button size="sm" onClick={onImported}>Continuer</Button>
          </div>
        </div>
      )}
    </div>
  );
}