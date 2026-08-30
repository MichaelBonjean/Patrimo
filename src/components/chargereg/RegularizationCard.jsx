import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Save, Check, Trash2, FileDown, FolderClock } from 'lucide-react';
import { computeRegularization } from '@/lib/chargeRegularization';
import { formatCurrency } from '@/lib/formatters';
import { generateChargeRegularizationPDF } from '@/lib/chargeRegularizationReport';
import VentilationEditor from './VentilationEditor';
import JustificatifUploader from './JustificatifUploader';
import { cn } from '@/lib/utils';

export default function RegularizationCard({ row, onSave, onValidate, onDelete, busy }) {
  const lease = row.lease || {};
  const rec = row.record || null;
  const [ventilation, setVentilation] = useState(rec?.ventilation || []);
  const [justificatifs, setJustificatifs] = useState(rec?.justificatifs || []);
  const [note, setNote] = useState(rec?.note || '');

  const calc = useMemo(() => computeRegularization(row.provisions_collected, ventilation), [row.provisions_collected, ventilation]);

  const buildDocRec = () => ({
    period: String(lease.year || rec?.year || ''),
    tenant_name: lease.tenant_name || rec?.tenant_name || '',
    lot_designation: lease.lot_designation || rec?.lot_designation || '',
    property_name: lease.property_name || rec?.property_name || '',
    ventilation, recoverable_total: calc.recoverable_total,
    provisions_collected: row.provisions_collected, solde: calc.solde,
    direction: calc.direction, justificatifs,
  });

  const dirBadge = rec?.status === 'validee'
    ? { label: 'Validée', cls: 'bg-emerald-100 text-emerald-700' }
    : { label: 'Brouillon', cls: 'bg-amber-100 text-amber-700' };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <FolderClock className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">{lease.lot_designation || 'Bail'}{lease.property_name ? ` · ${lease.property_name}` : ''}</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Locataire : {lease.tenant_name || '—'} · Provisions encaissées ( année) : {formatCurrency(row.provisions_collected)}
          </p>
        </div>
        <Badge className={dirBadge.cls}>{dirBadge.label}</Badge>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Charges récupérables engagées</h4>
        <VentilationEditor lines={ventilation} onChange={setVentilation} />
      </div>

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Justificatifs</h4>
        <JustificatifUploader files={justificatifs} onChange={setJustificatifs} />
      </div>

      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Note</h4>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Commentaire…" className="text-sm" />
      </div>

      {/* Calcul */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-border p-2">
          <p className="text-[11px] uppercase text-muted-foreground">Charges récupérables</p>
          <p className="text-base font-bold number-fr">{formatCurrency(calc.recoverable_total)}</p>
        </div>
        <div className="rounded-lg border border-border p-2">
          <p className="text-[11px] uppercase text-muted-foreground">Provisions</p>
          <p className="text-base font-bold number-fr">{formatCurrency(calc.provisions_collected)}</p>
        </div>
        <div className={cn('rounded-lg border p-2', calc.solde > 0 ? 'border-amber-200 bg-amber-50' : calc.solde < 0 ? 'border-blue-200 bg-blue-50' : 'border-emerald-200 bg-emerald-50')}>
          <p className="text-[11px] uppercase text-muted-foreground">Solde</p>
          <p className="text-base font-bold number-fr">{formatCurrency(calc.solde)}</p>
        </div>
      </div>

      <div className={cn('rounded-md px-3 py-2 text-sm font-medium border',
        calc.direction === 'du_locataire' ? 'border-amber-200 bg-amber-50 text-amber-800'
          : calc.direction === 'rembourser_locataire' ? 'border-blue-200 bg-blue-50 text-blue-800'
          : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
        {calc.direction === 'du_locataire' && `Dû par le locataire : ${formatCurrency(calc.solde)}`}
        {calc.direction === 'rembourser_locataire' && `À rembourser au locataire : ${formatCurrency(Math.abs(calc.solde))}`}
        {calc.direction === 'solde_nul' && 'Régularisation nulle — aucun solde.'}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" onClick={() => onSave({ ventilation, justificatifs, note })} disabled={busy || rec?.status === 'validee'}>
          <Save className="w-3.5 h-3.5 mr-1" />Enregistrer
        </Button>
        <Button size="sm" onClick={() => onValidate(rec?.id)} disabled={busy || !rec || rec?.status === 'validee'}>
          <Check className="w-3.5 h-3.5 mr-1" />Valider {calc.solde > 0 && '(crée une échéance)'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => generateChargeRegularizationPDF(buildDocRec())} disabled={ventilation.length === 0}>
          <FileDown className="w-3.5 h-3.5 mr-1" />Document
        </Button>
        {rec && (
          <Button size="sm" variant="ghost" onClick={() => onDelete(rec.id)} disabled={busy}>
            <Trash2 className="w-3.5 h-3.5 mr-1 text-rose-500" />Supprimer
          </Button>
        )}
      </div>
      {rec?.due_rentdue_id && (
        <p className="text-[11px] text-emerald-700">Échéance créée dans le compte locataire (solde dû). Voir «&nbsp;Compte locataire&nbsp;».</p>
      )}
    </div>
  );
}