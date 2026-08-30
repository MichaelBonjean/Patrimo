import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { FileText, Mail, Send, Loader2, Download, Eye } from 'lucide-react';
import { formatCurrency, formatDateFR } from '@/lib/formatters';

// ── helpers ─────────────────────────────────────────────────────────────────

const MONTHS_FR = [
  'janvier','février','mars','avril','mai','juin',
  'juillet','août','septembre','octobre','novembre','décembre'
];

function monthLabel(m, y) {
  return `${MONTHS_FR[m - 1]} ${y}`;
}

function buildMonthRange(from, to) {
  // from / to = "YYYY-MM"
  const months = [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push({ year: y, month: m, label: monthLabel(m, y) });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

const DEFAULT_QUITTANCE_TPL = `Quittance de loyer – {{mois_annee}}

Je soussigné(e) {{bailleur}}, propriétaire du logement situé {{adresse_bien}},
donne quittance à {{locataire}} pour la somme de {{total}} TTC
au titre du loyer et des charges du mois de {{mois_annee}}.

  • Loyer hors charges : {{loyer_hc}}
  • Charges : {{charges}}
  • Total : {{total}}

Paiement reçu le {{date_paiement}}.

Fait le {{date_emission}}

{{signature}}`;

const DEFAULT_RELANCE_SUBJECT = `Rappel – loyer impayé – {{mois_annee}}`;

const DEFAULT_RELANCE_TPL = `Bonjour {{locataire}},

Sauf erreur de notre part, nous n'avons pas reçu votre règlement de loyer pour le mois de {{mois_annee}} d'un montant de {{total}}.

Nous vous remercions de bien vouloir régulariser cette situation dans les meilleurs délais.

Cordialement,
{{bailleur}}

{{signature}}`;

// ── QuittancesTab ────────────────────────────────────────────────────────────

function QuittancesTab({ lots, properties }) {
  const today = new Date();
  const currentYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}`;
  const prevYM = (() => {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`;
  })();

  const [selectedLotId, setSelectedLotId] = useState('');
  const [fromMonth, setFromMonth] = useState(prevYM);
  const [toMonth, setToMonth] = useState(currentYM);
  const [template, setTemplate] = useState(() => localStorage.getItem('quittance_tpl') || DEFAULT_QUITTANCE_TPL);
  const [signature, setSignature] = useState(() => localStorage.getItem('quittance_sig') || '');
  const [bailleur, setBailleur] = useState(() => localStorage.getItem('quittance_bailleur') || '');
  const [editingTpl, setEditingTpl] = useState(false);
  const [preview, setPreview] = useState(null);
  const [sending, setSending] = useState(false);
  const [generated, setGenerated] = useState([]); // list of { label, text, email }

  const activeLots = lots.filter(l => {
    const tenants = getLotTenants(l);
    return tenants.some(t => !t.exit_date || t.exit_date >= today.toISOString().split('T')[0]);
  });

  const selectedLot = lots.find(l => l.id === selectedLotId);
  const selectedProperty = selectedLot ? properties.find(p => p.id === selectedLot.property_id) : null;
  const activeTenants = selectedLot ? getLotTenants(selectedLot).filter(t => !t.exit_date || t.exit_date >= today.toISOString().split('T')[0]) : [];
  const tenantEmail = activeTenants[0]?.email || '';

  const saveTpl = () => {
    localStorage.setItem('quittance_tpl', template);
    localStorage.setItem('quittance_sig', signature);
    localStorage.setItem('quittance_bailleur', bailleur);
    setEditingTpl(false);
    toast.success('Template sauvegardé');
  };

  const resetTpl = () => {
    setTemplate(DEFAULT_QUITTANCE_TPL);
    toast.success('Template réinitialisé');
  };

  const handleGenerate = () => {
    if (!selectedLotId) { toast.error('Sélectionnez un lot'); return; }
    if (!fromMonth || !toMonth) { toast.error('Indiquez la période'); return; }
    const months = buildMonthRange(fromMonth, toMonth);
    const docs = months.map(({ year, month, label }) => {
      const loyer_hc = formatCurrency(selectedLot.rent_excluding_charges || 0);
      const charges = formatCurrency(selectedLot.charges || 0);
      const total = formatCurrency((selectedLot.rent_excluding_charges || 0) + (selectedLot.charges || 0));
      const tenantName = activeTenants.map(t => t.name).join(' & ') || '—';
      const adresse = selectedProperty ? `${selectedProperty.address || ''}, ${selectedProperty.postal_code || ''} ${selectedProperty.city || ''}`.trim().replace(/^,\s*/, '') : '—';
      const vars = {
        mois_annee: label,
        locataire: tenantName,
        bailleur: bailleur || '[Bailleur]',
        adresse_bien: adresse,
        loyer_hc,
        charges,
        total,
        date_paiement: `1er ${label}`,
        date_emission: formatDateFR(today.toISOString().split('T')[0]),
        signature: signature || '',
      };
      return { label, year, month, text: fillTemplate(template, vars), email: tenantEmail };
    });
    setGenerated(docs);
    setPreview(docs[0]);
    toast.success(`${docs.length} quittance${docs.length > 1 ? 's' : ''} générée${docs.length > 1 ? 's' : ''}`);
  };

  const handleSend = async (doc) => {
    if (!doc.email) { toast.error('Aucun email pour ce locataire'); return; }
    setSending(true);
    const tenantName = activeTenants.map(t => t.name).join(' & ') || 'locataire';
    const subject = `Quittance de loyer – ${doc.label}`;
    await base44.integrations.Core.SendEmail({
      to: doc.email,
      subject,
      body: doc.text,
    });
    setSending(false);
    toast.success(`Quittance de ${doc.label} envoyée à ${doc.email}`);
  };

  const handleDownload = (doc) => {
    const blob = new Blob([doc.text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quittance_${doc.label.replace(' ', '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Config bailleur + paramètres */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Nom du bailleur</Label>
          <Input value={bailleur} onChange={e => setBailleur(e.target.value)} placeholder="Votre nom / SCI..." />
        </div>
        <div>
          <Label className="text-xs">Lot / Locataire</Label>
          <Select value={selectedLotId} onValueChange={setSelectedLotId}>
            <SelectTrigger><SelectValue placeholder="Choisir un lot" /></SelectTrigger>
            <SelectContent>
              {activeLots.map(l => {
                const tenants = getLotTenants(l);
                const prop = properties.find(p => p.id === l.property_id);
                return (
                  <SelectItem key={l.id} value={l.id}>
                    {prop?.name || '—'} — {l.designation} {tenants.length > 0 ? `(${tenants[0].name})` : ''}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {selectedLot && tenantEmail && (
            <p className="text-xs text-muted-foreground mt-1">📧 {tenantEmail}</p>
          )}
          {selectedLot && !tenantEmail && (
            <p className="text-xs text-amber-600 mt-1">Pas d'email — envoi impossible</p>
          )}
        </div>
      </div>

      {/* Période */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Mois de début</Label>
          <Input type="month" value={fromMonth} onChange={e => setFromMonth(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Mois de fin</Label>
          <Input type="month" value={toMonth} onChange={e => setToMonth(e.target.value)} />
        </div>
      </div>

      {/* Template */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Template quittance</Label>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={resetTpl}>Réinitialiser</Button>
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setEditingTpl(!editingTpl)}>
              {editingTpl ? 'Replier' : 'Modifier'}
            </Button>
          </div>
        </div>
        {editingTpl && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                Variables : {'{{mois_annee}}'} {'{{locataire}}'} {'{{bailleur}}'} {'{{adresse_bien}}'} {'{{loyer_hc}}'} {'{{charges}}'} {'{{total}}'} {'{{date_emission}}'} {'{{signature}}'}
              </Label>
              <Textarea value={template} onChange={e => setTemplate(e.target.value)} rows={14} className="font-mono text-xs" />
            </div>
            <div>
              <Label className="text-xs">Signature (texte, optionnel)</Label>
              <Textarea value={signature} onChange={e => setSignature(e.target.value)} rows={3} placeholder="Votre signature..." className="text-xs" />
            </div>
            <Button size="sm" onClick={saveTpl}>Sauvegarder le template</Button>
          </div>
        )}
        {!editingTpl && (
          <p className="text-xs text-muted-foreground italic line-clamp-2">{template.slice(0, 100)}…</p>
        )}
      </div>

      <Button onClick={handleGenerate} className="w-full gap-2">
        <FileText className="w-4 h-4" /> Générer les quittances
      </Button>

      {/* Liste générée */}
      {generated.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">{generated.length} quittance{generated.length > 1 ? 's' : ''} générée{generated.length > 1 ? 's' : ''}</p>
          <div className="grid gap-2">
            {generated.map((doc, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-border p-3 bg-muted/30">
                <span className="text-sm font-medium capitalize">{doc.label}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setPreview(preview?.label === doc.label ? null : doc)}>
                    <Eye className="w-3.5 h-3.5" />
                    {preview?.label === doc.label ? 'Replier' : 'Prévisualiser'}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => handleDownload(doc)}>
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                  {doc.email ? (
                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleSend(doc)} disabled={sending}>
                      {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      Envoyer
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground self-center">Pas d'email</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Prévisualisation */}
          {preview && (
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground font-medium mb-2">Aperçu — {preview.label}</p>
              <pre className="text-xs whitespace-pre-wrap font-mono text-foreground leading-relaxed max-h-72 overflow-y-auto">{preview.text}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── RelancesTab ──────────────────────────────────────────────────────────────

function RelancesTab({ lots, properties }) {
  const today = new Date();
  const currentYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2,'0')}`;
  const prevYM = (() => {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`;
  })();

  const [selectedLotId, setSelectedLotId] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(prevYM);
  const [subject, setSubject] = useState(() => localStorage.getItem('relance_subject') || DEFAULT_RELANCE_SUBJECT);
  const [template, setTemplate] = useState(() => localStorage.getItem('relance_tpl') || DEFAULT_RELANCE_TPL);
  const [bailleur, setBailleur] = useState(() => localStorage.getItem('quittance_bailleur') || '');
  const [signature, setSignature] = useState(() => localStorage.getItem('quittance_sig') || '');
  const [editingTpl, setEditingTpl] = useState(false);
  const [preview, setPreview] = useState('');
  const [sending, setSending] = useState(false);

  const activeLots = lots.filter(l => {
    const tenants = getLotTenants(l);
    return tenants.some(t => !t.exit_date || t.exit_date >= today.toISOString().split('T')[0]);
  });

  const selectedLot = lots.find(l => l.id === selectedLotId);
  const selectedProperty = selectedLot ? properties.find(p => p.id === selectedLot.property_id) : null;
  const activeTenants = selectedLot ? getLotTenants(selectedLot).filter(t => !t.exit_date || t.exit_date >= today.toISOString().split('T')[0]) : [];
  const tenantEmail = activeTenants[0]?.email || '';

  const getVars = () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const label = monthLabel(m, y);
    const total = formatCurrency((selectedLot?.rent_excluding_charges || 0) + (selectedLot?.charges || 0));
    return {
      mois_annee: label,
      locataire: activeTenants.map(t => t.name).join(' & ') || '—',
      bailleur: bailleur || '[Bailleur]',
      total,
      signature: signature || '',
    };
  };

  useEffect(() => {
    if (selectedLotId && selectedMonth) {
      const vars = getVars();
      setPreview(fillTemplate(template, vars));
    }
  }, [selectedLotId, selectedMonth, template, bailleur, signature]);

  const saveTpl = () => {
    localStorage.setItem('relance_tpl', template);
    localStorage.setItem('relance_subject', subject);
    toast.success('Template sauvegardé');
    setEditingTpl(false);
  };

  const resetTpl = () => {
    setTemplate(DEFAULT_RELANCE_TPL);
    setSubject(DEFAULT_RELANCE_SUBJECT);
    toast.success('Template réinitialisé');
  };

  const handleSend = async () => {
    if (!selectedLotId) { toast.error('Sélectionnez un lot'); return; }
    if (!tenantEmail) { toast.error('Pas d\'email pour ce locataire'); return; }
    setSending(true);
    const vars = getVars();
    await base44.integrations.Core.SendEmail({
      to: tenantEmail,
      subject: fillTemplate(subject, vars),
      body: fillTemplate(template, vars),
    });
    setSending(false);
    toast.success(`Relance envoyée à ${tenantEmail}`);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Nom du bailleur</Label>
          <Input value={bailleur} onChange={e => setBailleur(e.target.value)} placeholder="Votre nom / SCI..." />
        </div>
        <div>
          <Label className="text-xs">Locataire concerné</Label>
          <Select value={selectedLotId} onValueChange={setSelectedLotId}>
            <SelectTrigger><SelectValue placeholder="Choisir un lot" /></SelectTrigger>
            <SelectContent>
              {activeLots.map(l => {
                const tenants = getLotTenants(l);
                const prop = properties.find(p => p.id === l.property_id);
                return (
                  <SelectItem key={l.id} value={l.id}>
                    {prop?.name || '—'} — {l.designation} {tenants.length > 0 ? `(${tenants[0].name})` : ''}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {tenantEmail && <p className="text-xs text-muted-foreground mt-1">📧 {tenantEmail}</p>}
          {selectedLotId && !tenantEmail && <p className="text-xs text-amber-600 mt-1">Pas d'email — envoi impossible</p>}
        </div>
      </div>

      <div>
        <Label className="text-xs">Mois de la relance</Label>
        <Input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="max-w-xs" />
      </div>

      {/* Template */}
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Template relance</Label>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="text-xs h-7" onClick={resetTpl}>Réinitialiser</Button>
            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setEditingTpl(!editingTpl)}>
              {editingTpl ? 'Replier' : 'Modifier'}
            </Button>
          </div>
        </div>
        {editingTpl && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">
                Variables : {'{{mois_annee}}'} {'{{locataire}}'} {'{{bailleur}}'} {'{{total}}'} {'{{signature}}'}
              </Label>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Objet du mail</Label>
                  <Input value={subject} onChange={e => setSubject(e.target.value)} />
                </div>
                <Textarea value={template} onChange={e => setTemplate(e.target.value)} rows={12} className="font-mono text-xs" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Signature</Label>
              <Textarea value={signature} onChange={e => setSignature(e.target.value)} rows={3} placeholder="Votre signature..." className="text-xs" />
            </div>
            <Button size="sm" onClick={saveTpl}>Sauvegarder le template</Button>
          </div>
        )}
        {!editingTpl && (
          <p className="text-xs text-muted-foreground italic line-clamp-2">{template.slice(0, 100)}…</p>
        )}
      </div>

      {/* Prévisualisation live */}
      {preview && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground font-medium mb-2">Aperçu du message</p>
          <pre className="text-xs whitespace-pre-wrap font-mono text-foreground leading-relaxed max-h-60 overflow-y-auto">{preview}</pre>
        </div>
      )}

      <Button onClick={handleSend} disabled={sending || !tenantEmail} className="w-full gap-2">
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
        Envoyer la relance
      </Button>
    </div>
  );
}

// ── getLotTenants (dupliqué localement) ─────────────────────────────────────

function getLotTenants(lot) {
  const arr = Array.isArray(lot.tenants) ? [...lot.tenants] : [];
  if (lot.tenant_name && !arr.find(t => t.name === lot.tenant_name)) {
    arr.unshift({
      id: 'legacy',
      name: lot.tenant_name,
      entry_date: lot.tenant_entry_date || '',
      exit_date: lot.tenant_exit_date || '',
      email: lot.tenant_email || '',
      phone: lot.tenant_phone || '',
    });
  }
  return arr;
}

// ── TemplatesDialog ──────────────────────────────────────────────────────────

export default function TemplatesDialog({ open, onClose, lots, properties }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" /> Templates
          </DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="quittances">
          <TabsList className="w-full">
            <TabsTrigger value="quittances" className="flex-1">Quittances</TabsTrigger>
            <TabsTrigger value="relances" className="flex-1">Relances</TabsTrigger>
          </TabsList>
          <TabsContent value="quittances" className="mt-4">
            <QuittancesTab lots={lots} properties={properties} />
          </TabsContent>
          <TabsContent value="relances" className="mt-4">
            <RelancesTab lots={lots} properties={properties} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}