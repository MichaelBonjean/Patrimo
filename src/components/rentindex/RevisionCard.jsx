import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Check, X, RefreshCw, Lock, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatPercent } from '@/lib/formatters';

function Metric({ label, value, tone }) {
  const cls = { positive: 'text-emerald-700', negative: 'text-rose-700', default: 'text-foreground' }[tone || 'default'];
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('text-base font-bold number-fr', cls)}>{value}</p>
    </div>
  );
}

const STATUS = {
  proposition: { label: 'Proposition', cls: 'bg-amber-100 text-amber-700' },
  validee: { label: 'Validée', cls: 'bg-blue-100 text-blue-700' },
  refusee: { label: 'Refusée', cls: 'bg-rose-100 text-rose-700' },
  appliquee: { label: 'Appliquée', cls: 'bg-emerald-100 text-emerald-700' },
};

export default function RevisionCard({ p, onRecompute, onAction, busy }) {
  const rec = p.record || {};
  const lease = p.lease || {};
  const st = STATUS[rec.status] || STATUS.proposition;
  const [idx, setIdx] = useState(p.newIndexValue != null ? String(p.newIndexValue) : '');
  const blocked = p.canApply === false;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{lease.lot_designation || 'Bail'}{lease.property_name ? ` · ${lease.property_name}` : ''}</h3>
            <Badge variant="secondary" className="bg-muted text-muted-foreground">{p.indexationType || lease.indexation_type || '—'}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Référence : {lease.index_reference || '—'} · Loyer HC actuel : {formatCurrency(p.oldRent)}
          </p>
        </div>
        <Badge className={st.cls}>{st.label}</Badge>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[11px] text-muted-foreground block">Indice initial</label>
          <p className="text-sm font-semibold number-fr">{p.oldIndexValue ?? '—'}</p>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground block mb-1">Indice courant</label>
          <Input value={idx} onChange={(e) => setIdx(e.target.value)} type="number" step="0.01" className="w-32 h-8" placeholder="ex: 143,02" />
        </div>
        <Button size="sm" variant="outline" onClick={() => onRecompute(lease.id, idx)} disabled={busy}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" />Recalculer
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Metric label="Loyer actuel" value={formatCurrency(p.oldRent)} />
        <Metric label="Loyer théorique" value={p.newRent != null ? formatCurrency(p.newRent) : '—'} tone="positive" />
        <Metric label="Variation €" value={p.variationAmount != null ? formatCurrency(p.variationAmount) : '—'} tone={p.variationAmount > 0 ? 'positive' : p.variationAmount < 0 ? 'negative' : 'default'} />
        <Metric label="Variation %" value={p.variationPercent != null ? formatPercent(p.variationPercent) : '—'} tone={p.variationPercent > 0 ? 'positive' : p.variationPercent < 0 ? 'negative' : 'default'} />
      </div>

      <p className="text-xs text-muted-foreground italic">{p.formula}</p>
      <p className="text-[11px] text-muted-foreground">Prochaine éligibilité : {p.nextRevisionDate}</p>

      {p.blockedReason && (
        <div className={cn('flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs', blocked ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-800')}>
          {blocked ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
          <span>{p.blockedReason}</span>
        </div>
      )}

      {rec.status === 'proposition' && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={() => onAction('validate', rec.id)} disabled={busy || blocked}><Check className="w-3.5 h-3.5 mr-1" />Valider</Button>
          <Button size="sm" variant="outline" onClick={() => onAction('reject', rec.id)} disabled={busy}><X className="w-3.5 h-3.5 mr-1" />Refuser</Button>
        </div>
      )}
      {rec.status === 'validee' && (
        <div className="flex flex-wrap gap-2 pt-1 items-center">
          <Button size="sm" onClick={() => onAction('apply', rec.id)} disabled={busy}><Lock className="w-3.5 h-3.5 mr-1" />Appliquer au bail</Button>
          <span className="text-[11px] text-muted-foreground">Nouveau montant validé : {formatCurrency(rec.new_amount)}</span>
        </div>
      )}
    </div>
  );
}