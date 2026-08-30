import React from 'react';
import { FileText, Hotel, ScrollText, Receipt, FileSignature, Landmark, Gauge, ShieldCheck, Banknote, ClipboardCheck, Landmark as BankIcon, File, AlertTriangle, Clock, CircleCheck } from 'lucide-react';
import { badgeClass, labelOfType, expirationStatus, formatDateFR, formatAmount } from '@/lib/documents';

const TYPE_ICON = {
  bail: ScrollText,
  etat_des_lieux: Hotel,
  quittance: Receipt,
  facture: FileText,
  acte: FileSignature,
  taxe_fonciere: Landmark,
  dpe: Gauge,
  assurance: ShieldCheck,
  pret: Banknote,
  ag_copropriete: ClipboardCheck,
  releve_bancaire: BankIcon,
  autre: File,
};

export default function DocumentCard({ doc, linkNames, onOpen }) {
  const Icon = TYPE_ICON[doc.type] || File;
  const exp = expirationStatus(doc.expiration_date);
  const links = [
    linkNames?.property?.[doc.property_id],
    linkNames?.lot?.[doc.lot_id],
    linkNames?.lease?.[doc.lease_id],
    doc.tenant_name,
    linkNames?.holder?.[doc.holder_id],
    doc.loan_id ? `Prêt` : null,
    linkNames?.transaction?.[doc.transaction_id],
    linkNames?.impaye?.[doc.impaye_id],
  ].filter(Boolean);

  return (
    <button
      onClick={() => onOpen(doc)}
      className="text-left w-full bg-card border rounded-lg p-3 hover:shadow-md transition-shadow flex flex-col gap-2"
    >
      <div className="flex items-start gap-2">
        <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Icon className="w-4.5 h-4.5 text-muted-foreground" style={{ width: 18, height: 18 }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{doc.title || doc.filename || 'Document'}</div>
          <div className="text-xs text-muted-foreground truncate">{doc.supplier || doc.filename || ''}</div>
        </div>
        {doc.status === 'pending_review' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 shrink-0">À valider</span>
        )}
      </div>

      <div className={`inline-block self-start text-[11px] px-2 py-0.5 rounded border ${badgeClass(doc.type)}`}>
        {labelOfType(doc.type)}
      </div>

      {doc.amount != null && (
        <div className="text-xs font-medium text-foreground">{formatAmount(doc.amount)}</div>
      )}

      {links.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {links.slice(0, 3).map((l, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 truncate max-w-[9rem]">{l}</span>
          ))}
        </div>
      )}

      {doc.tags && doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {doc.tags.slice(0, 4).map((t) => (
            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">#{t}</span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-auto pt-1 border-t">
        <span>{doc.document_date ? formatDateFR(doc.document_date) : '—'}</span>
        {doc.expiration_date && (
          <span className={`flex items-center gap-1 font-medium ${exp === 'expired' ? 'text-rose-600' : exp === 'soon' ? 'text-amber-600' : ''}`}>
            {exp === 'expired' ? <AlertTriangle className="w-3 h-3" /> : exp === 'soon' ? <Clock className="w-3 h-3" /> : <CircleCheck className="w-3 h-3" />}
            {formatDateFR(doc.expiration_date)}
          </span>
        )}
      </div>
    </button>
  );
}