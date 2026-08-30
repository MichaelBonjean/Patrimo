import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ExternalLink, Trash2, Save, BadgeCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { TYPE_LIST, TYPE_LABELS, SOURCE_LABELS, labelOfType, badgeClass, formatDateFR, formatAmount } from '@/lib/documents';

const NONE = 'none';
const v = (val) => (val ? String(val) : NONE);
const unone = (val) => (val === NONE ? null : val);

function LinkSelect({ label, value, onChange, options, placeholder }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={v(value)} onValueChange={(val) => onChange(unone(val))}>
        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={placeholder || 'Aucun'} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Aucun</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function DocumentDetailDialog({ open, onOpenChange, doc, catalogs, onSave, onValidate, onDelete }) {
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (doc) {
      setForm({
        title: doc.title || '',
        type: doc.type || 'autre',
        property_id: doc.property_id || null,
        lot_id: doc.lot_id || null,
        lease_id: doc.lease_id || null,
        tenant_id: doc.tenant_id || null,
        tenant_name: doc.tenant_name || '',
        holder_id: doc.holder_id || null,
        transaction_id: doc.transaction_id || null,
        impaye_id: doc.impaye_id || null,
        loan_id: doc.loan_id || null,
        document_date: doc.document_date || '',
        expiration_date: doc.expiration_date || '',
        supplier: doc.supplier || '',
        amount: doc.amount ?? '',
        version: doc.version || '',
        source: doc.source || 'upload',
        tags: (doc.tags || []).join(', '),
        commentaire: doc.commentaire || '',
      });
    }
  }, [doc]);

  const set = (k, val) => setForm((f) => ({ ...f, [k]: val }));

  const lotsForProp = useMemo(() => {
    if (!catalogs?.lots) return [];
    return catalogs.lots.filter((l) => !form?.property_id || l.property_id === form.property_id);
  }, [catalogs, form?.property_id]);

  const leasesForProp = useMemo(() => {
    if (!catalogs?.leases) return [];
    return catalogs.leases.filter((l) => !form?.property_id || l.property_id === form.property_id);
  }, [catalogs, form?.property_id]);

  const tenantOptions = useMemo(() => {
    const out = [];
    const lease = (catalogs?.leases || []).find((l) => l.id === form?.lease_id);
    if (lease) for (const t of lease.tenants || []) out.push({ value: `lease:${lease.id}:${t.id || t.name}`, label: t.name });
    const lot = (catalogs?.lots || []).find((l) => l.id === form?.lot_id);
    if (lot) for (const t of (lot.tenants || [])) { const val = `lot:${lot.id}:${t.id || t.name}`; if (!out.find((o) => o.value === val)) out.push({ value: val, label: t.name }); }
    return out;
  }, [catalogs, form?.lease_id, form?.lot_id]);

  const loanOptions = useMemo(() => {
    return (catalogs?.properties || []).filter((p) => Number(p.loan_amount) > 0)
      .map((p) => ({ value: `loan:${p.id}`, label: `Prêt — ${p.name}` }));
  }, [catalogs]);

  if (!form) return null;

  const submit = (validate = false) => {
    const patch = {
      title: form.title || 'Document',
      type: form.type,
      property_id: form.property_id,
      lot_id: form.lot_id,
      lease_id: form.lease_id,
      tenant_id: form.tenant_id,
      tenant_name: form.tenant_name,
      holder_id: form.holder_id,
      transaction_id: form.transaction_id,
      impaye_id: form.impaye_id,
      loan_id: form.loan_id,
      document_date: form.document_date || null,
      expiration_date: form.expiration_date || null,
      supplier: form.supplier,
      version: form.version,
      source: form.source,
      amount: form.amount === '' ? null : Number(form.amount),
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      commentaire: form.commentaire,
      set_valide: validate,
    };
    onSave(patch);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:min-w-[520px] max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`inline-block text-[11px] px-2 py-0.5 rounded border ${badgeClass(form.type)}`}>{labelOfType(form.type)}</span>
            <span className="truncate">{form.title || doc?.filename || 'Document'}</span>
            {doc?.status === 'pending_review' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />À valider</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={form.type} onValueChange={(val) => set('type', val)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{TYPE_LIST.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Source</Label>
              <Select value={form.source} onValueChange={(val) => set('source', val)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(SOURCE_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Titre</Label>
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} className="h-8" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Date du document</Label>
              <Input type="date" value={form.document_date} onChange={(e) => set('document_date', e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Expiration</Label>
              <Input type="date" value={form.expiration_date} onChange={(e) => set('expiration_date', e.target.value)} className="h-8" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Fournisseur</Label>
              <Input value={form.supplier} onChange={(e) => set('supplier', e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Montant (€)</Label>
              <Input type="number" value={form.amount} onChange={(e) => set('amount', e.target.value)} className="h-8" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <LinkSelect label="Bien" value={form.property_id} onChange={(val) => set('property_id', val)}
              options={(catalogs?.properties || []).map((p) => ({ value: p.id, label: p.name }))} placeholder="Aucun bien" />
            <LinkSelect label="Lot" value={form.lot_id} onChange={(val) => set('lot_id', val)}
              options={lotsForProp.map((l) => ({ value: l.id, label: l.designation || 'Lot' }))} placeholder="Aucun lot" />
            <LinkSelect label="Bail" value={form.lease_id} onChange={(val) => set('lease_id', val)}
              options={leasesForProp.map((l) => ({ value: l.id, label: `${l.tenants?.[0]?.name || 'Bail'} · ${l.date_start || ''}` }))} placeholder="Aucun bail" />
            <LinkSelect label="Locataire" value={form.tenant_id} onChange={(val) => { set('tenant_id', val); const o = tenantOptions.find((o) => o.value === val); set('tenant_name', o?.label || ''); }}
              options={tenantOptions} placeholder="Aucun locataire" />
            <LinkSelect label="Détenteur" value={form.holder_id} onChange={(val) => set('holder_id', val)}
              options={(catalogs?.holders || []).map((h) => ({ value: h.id, label: h.name }))} placeholder="Aucun détenteur" />
            <LinkSelect label="Prêt" value={form.loan_id} onChange={(val) => set('loan_id', val)}
              options={loanOptions} placeholder="Aucun prêt" />
            <LinkSelect label="Transaction" value={form.transaction_id} onChange={(val) => set('transaction_id', val)}
              options={(catalogs?.transactions || []).map((t) => ({ value: t.id, label: `${t.category_label || t.category || ''} ${t.amount || 0}€` }))} placeholder="Aucune transaction" />
            <LinkSelect label="Impayé" value={form.impaye_id} onChange={(val) => set('impaye_id', val)}
              options={(catalogs?.impayes || []).map((i) => ({ value: i.id, label: `${i.tenant_name || ''} · ${i.period || ''}` }))} placeholder="Aucun impayé" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Tags (séparés par des virgules)</Label>
            <Input value={form.tags} onChange={(e) => set('tags', e.target.value)} className="h-8" placeholder="contrat, 2025, urgence…" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Version</Label>
              <Input value={form.version} onChange={(e) => set('version', e.target.value)} className="h-8" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Commentaire</Label>
            <Textarea value={form.commentaire} onChange={(e) => set('commentaire', e.target.value)} rows={2} className="text-sm" />
          </div>

          {doc?.amount != null && doc.amount !== '' && (
            <div className="text-xs text-muted-foreground">Montant extrait : {formatAmount(doc.amount)}</div>
          )}
          {doc?.document_date && <div className="text-xs text-muted-foreground">Date : {formatDateFR(doc.document_date)}</div>}
          {doc?.file_url && (
            <a href={doc.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
              <ExternalLink className="w-3.5 h-3.5" /> Ouvrir le fichier
            </a>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="destructive" size="sm" onClick={onDelete}><Trash2 className="w-3.5 h-3.5 mr-1" />Supprimer</Button>
          <div className="flex gap-2">
            {doc?.status === 'pending_review' && <Button variant="secondary" size="sm" onClick={() => submit(true)}><BadgeCheck className="w-3.5 h-3.5 mr-1" />Enregistrer & valider</Button>}
            <Button size="sm" onClick={() => submit(false)}><Save className="w-3.5 h-3.5 mr-1" />Enregistrer</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}