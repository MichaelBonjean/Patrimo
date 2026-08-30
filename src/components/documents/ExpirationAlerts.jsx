import React from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { expirationStatus, formatDateFR } from '@/lib/documents';

const byExp = (a, b) => String(a.expiration_date || '').localeCompare(String(b.expiration_date || ''));

export default function ExpirationAlerts({ documents, onFilter }) {
  const today = new Date().toISOString().slice(0, 10);
  const expired = documents
    .filter((d) => expirationStatus(d.expiration_date, today) === 'expired')
    .sort(byExp);
  const soon = documents
    .filter((d) => expirationStatus(d.expiration_date, today) === 'soon')
    .sort(byExp);

  if (expired.length === 0 && soon.length === 0) return null;

  return (
    <div className="space-y-2">
      {expired.length > 0 && (
        <button onClick={() => onFilter('expired')} className="w-full text-left bg-rose-50 border border-rose-200 rounded-lg p-3 hover:bg-rose-100 transition-colors">
          <div className="flex items-center gap-2 text-rose-800 font-medium text-sm">
            <AlertTriangle className="w-4 h-4" /> {expired.length} document{expired.length > 1 ? 's' : ''} expiré{expired.length > 1 ? 's' : ''}
          </div>
          <div className="text-xs text-rose-700 mt-1 truncate">
            {expired.slice(0, 3).map((d) => `${d.title} (${formatDateFR(d.expiration_date)})`).join(' · ')}
          </div>
        </button>
      )}
      {soon.length > 0 && (
        <button onClick={() => onFilter('soon')} className="w-full text-left bg-amber-50 border border-amber-200 rounded-lg p-3 hover:bg-amber-100 transition-colors">
          <div className="flex items-center gap-2 text-amber-800 font-medium text-sm">
            <Clock className="w-4 h-4" /> {soon.length} document{soon.length > 1 ? 's' : ''} à expirer sous 30 j
          </div>
          <div className="text-xs text-amber-700 mt-1 truncate">
            {soon.slice(0, 3).map((d) => `${d.title} (${formatDateFR(d.expiration_date)})`).join(' · ')}
          </div>
        </button>
      )}
    </div>
  );
}