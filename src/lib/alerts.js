// Façade frontend — libellés et couleurs d'affichage des alertes.
// La logique de génération (dedup, priorités) vit dans base44/shared/alertsEngine.ts.

export const SOURCE_LABELS = {
  loyer_impaye: 'Loyer impayé',
  paiement_non_rapproche: 'Paiement non rapproché',
  bail_expirant: 'Bail expirant',
  indexation_disponible: 'Indexation disponible',
  dpe: 'DPE',
  assurance: 'Assurance',
  echeance_fiscale: 'Échéance fiscale',
  ag_copropriete: 'AG copropriété',
  echeance_credit: 'Échéance crédit',
  document_manquant: 'Document manquant',
  anomalie_financiere: 'Anomalie financière',
  echeance_loyer: 'Échéance de loyer',
  echeance_sci: 'Date clé SCI',
};

export const PRIORITY_LABELS = {
  urgent: 'Urgent',
  important: 'Important',
  a_traiter: 'À traiter',
  information: 'Information',
};

export const PRIORITY_ORDER = ['urgent', 'important', 'a_traiter', 'information'];

export const STATUS_LABELS = {
  active: 'Active',
  snoozed: 'Reportée',
  resolved: 'Traitée',
  ignored: 'Ignorée',
};

export function priorityBadge(priority) {
  switch (priority) {
    case 'urgent': return 'bg-red-100 text-red-800 border-red-200';
    case 'important': return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'a_traiter': return 'bg-amber-100 text-amber-800 border-amber-200';
    default: return 'bg-sky-100 text-sky-800 border-sky-200';
  }
}

export function priorityStripe(priority) {
  switch (priority) {
    case 'urgent': return 'border-l-red-500';
    case 'important': return 'border-l-orange-500';
    case 'a_traiter': return 'border-l-amber-500';
    default: return 'border-l-sky-400';
  }
}

export function priorityIcon(priority) {
  switch (priority) {
    case 'urgent': return 'text-red-600';
    case 'important': return 'text-orange-600';
    case 'a_traiter': return 'text-amber-600';
    default: return 'text-sky-600';
  }
}

export function labelOfSource(source) {
  return SOURCE_LABELS[source] || source;
}

export function formatDateFR(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}