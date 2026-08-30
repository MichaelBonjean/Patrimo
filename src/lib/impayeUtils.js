/**
 * Utilitaires pour la gestion des impayés de loyer.
 */

export function getDueDateFromPeriod(period) {
  if (!period) return null;
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

/**
 * Nombre de jours d'impayé = écart en jours entre la date d'échéance
 * (1er du mois de la période) et aujourd'hui.
 */
export function getDaysOutstanding(period) {
  const due = getDueDateFromPeriod(period);
  if (!due) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ms = today.getTime() - due.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function isImpayeCritical(period, threshold = 30) {
  return getDaysOutstanding(period) > threshold;
}

export function relanceHistorySummary(history = []) {
  const counts = (history || []).reduce((acc, h) => {
    const key = h.type || 'note';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return counts;
}

/**
 * Construit l'email pré-rédigé de relance amicale.
 */
export function buildRelanceEmail(impaye, landlordName = 'Votre bailleur') {
  const period = impaye.period || '';
  const [year, month] = period.split('-').map(Number);
  const label = month ? `${getMonthLabel(month)} ${year}` : period;
  const subject = `Rappel — loyer ${label}`;
  const body = `Bonjour ${impaye.tenant_name || ''},

Je me permets de revenir vers vous concernant le loyer de ${label} pour le logement situé ${impaye.lot_address || ''} (${impaye.lot_designation || ''}).

À ce jour, je n'ai pas encaissé la somme de ${formatEuro(impaye.missing_amount)} sur les ${formatEuro(impaye.expected_amount)} attendus.

Il s'agit probablement d'un simple oubli de votre part. Je vous remercie de bien vouloir procéder au règlement dans les meilleurs délais, et de m'informer si une difficulté particulière nous avait échappé afin que nous puissions en discuter.

Restant à votre disposition pour toute question.

Bien cordialement,
${landlordName}`;

  return { subject, body };
}

function getMonthLabel(monthNum) {
  const MONTHS = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
  ];
  return MONTHS[monthNum - 1] || '';
}

function formatEuro(n) {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(v);
}

export function formatImpayeStatus(status) {
  switch (status) {
    case 'echeance_impayee': return { label: 'Échéance non réglée', className: 'bg-red-100 text-red-700' };
    case 'rappel_amiable': return { label: 'Rappel amiable', className: 'bg-amber-100 text-amber-700' };
    case 'deuxieme_relance': return { label: 'Deuxième relance', className: 'bg-amber-100 text-amber-700' };
    case 'mise_en_demeure_amiable': return { label: 'Mise en demeure amiable', className: 'bg-orange-100 text-orange-700' };
    case 'dossier_professionnel': return { label: 'Dossier à transmettre', className: 'bg-purple-100 text-purple-700' };
    case 'régularisé': return { label: 'Régularisé', className: 'bg-emerald-100 text-emerald-700' };
    case 'abandonné': return { label: 'Abandonné', className: 'bg-muted text-muted-foreground' };
    default: return { label: status, className: 'bg-muted text-muted-foreground' };
  }
}