// Catalogue des types de documents + helpers d'expiration et de recherche.

export const TYPE_LABELS = {
  bail: 'Bail',
  etat_des_lieux: 'État des lieux',
  quittance: 'Quittance',
  facture: 'Facture',
  acte: 'Acte',
  taxe_fonciere: 'Taxe foncière',
  dpe: 'DPE',
  assurance: 'Assurance',
  pret: 'Prêt',
  ag_copropriete: 'AG copropriété',
  releve_bancaire: 'Relevé bancaire',
  autre: 'Autre',
};

export const TYPE_LIST = Object.keys(TYPE_LABELS);

export const SOURCE_LABELS = {
  upload: 'Import manuel',
  import: 'Pipeline',
  email: 'Email',
  manuel: 'Saisie',
};

export function labelOfType(t) {
  return TYPE_LABELS[t] || t || 'Autre';
}

// Couleur Tailwind (littérale) par type — utilisé pour les badges.
export const TYPE_BADGE_CLASS = {
  bail: 'bg-blue-50 text-blue-700 border-blue-200',
  etat_des_lieux: 'bg-amber-50 text-amber-700 border-amber-200',
  quittance: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  facture: 'bg-purple-50 text-purple-700 border-purple-200',
  acte: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  taxe_fonciere: 'bg-rose-50 text-rose-700 border-rose-200',
  dpe: 'bg-teal-50 text-teal-700 border-teal-200',
  assurance: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  pret: 'bg-sky-50 text-sky-700 border-sky-200',
  ag_copropriete: 'bg-orange-50 text-orange-700 border-orange-200',
  releve_bancaire: 'bg-slate-100 text-slate-700 border-slate-300',
  autre: 'bg-muted text-muted-foreground border-border',
};

export function badgeClass(type) {
  return TYPE_BADGE_CLASS[type] || TYPE_BADGE_CLASS.autre;
}

// Statut d'expiration : 'expired' | 'soon' (<= 30j) | 'ok' | 'none'
export function expirationStatus(dateStr, todayStr, horizonDays = 30) {
  if (!dateStr) return 'none';
  const today = todayStr || new Date().toISOString().slice(0, 10);
  const diff = Math.round((new Date(dateStr) - new Date(today)) / 86400000);
  if (diff < 0) return 'expired';
  if (diff <= horizonDays) return 'soon';
  return 'ok';
}

export function formatAmount(n) {
  const v = Number(n);
  if (!v || Number.isNaN(v)) return '';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v);
}

export function formatDateFR(d) {
  if (!d) return '';
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('fr-FR');
  } catch {
    return d;
  }
}

// Recherche multicritère locale (sur la liste déjà chargée).
// q peut matcher : titre, type, tags, fournisseur, commentaire, noms des entités liées.
export function matchDocument(doc, q, linkNames) {
  if (!q) return true;
  const needle = q.toLowerCase().trim();
  if (!needle) return true;
  const hay = [
    doc.title, doc.filename, doc.type, labelOfType(doc.type),
    doc.supplier, doc.commentaire, doc.version,
    (doc.tags || []).join(' '),
    doc.tenant_name,
    linkNames?.property?.[doc.property_id],
    linkNames?.lot?.[doc.lot_id],
    linkNames?.lease?.[doc.lease_id],
    linkNames?.holder?.[doc.holder_id],
    linkNames?.transaction?.[doc.transaction_id],
    linkNames?.impaye?.[doc.impaye_id],
    doc.property_id ? `loan:${doc.property_id}` : '',
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}