/**
 * Helpers frontend pour le modèle Lease (bail).
 * La source canonique est l'entité Lease ; les champs legacy du Lot restent
 * utilisés en repli tant que la migration n'a pas été déployée/sécurisée.
 */

export const LEASE_TYPES = ['Vide-Nu', 'Meublé', 'Bail commercial', 'Bail mobilité', 'Bail étudiant', 'Saisonnier-Airbnb', 'Bail mixte', 'Courte durée'];
export const PAYMENT_FREQUENCIES = ['mensuel', 'trimestriel', 'semestriel', 'annuel'];
export const INDEXATION_TYPES = ['aucune', 'IRL', 'ILC', 'ILAT'];

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function computeLeaseStatus(lease, today = todayISO()) {
  const start = lease.date_start || '';
  const end = lease.date_end || '';
  if (lease.status === 'resilie') return 'resilie';
  if (start && start > today) return 'futur';
  if (end && end < today) return 'termine';
  return 'actif';
}

export function statusLabel(status) {
  switch (status) {
    case 'actif': return 'Actif';
    case 'futur': return 'À venir';
    case 'termine': return 'Terminé';
    case 'resilie': return 'Résilié';
    default: return status || '—';
  }
}

export function statusBadgeClass(status) {
  switch (status) {
    case 'actif': return 'bg-emerald-100 text-emerald-700';
    case 'futur': return 'bg-blue-100 text-blue-700';
    case 'termine': return 'bg-muted text-muted-foreground';
    case 'resilie': return 'bg-red-100 text-red-700';
    default: return 'bg-muted text-muted-foreground';
  }
}

export function isLeaseActiveAt(lease, dateISO = todayISO()) {
  if (!lease.date_start || lease.date_start > dateISO) return false;
  if (lease.date_end && lease.date_end < dateISO) return false;
  return true;
}

/** Baux d'un lot triés du plus récent au plus ancien. */
export function sortLeases(leases) {
  return [...(leases || [])].sort((a, b) => (b.date_start || '').localeCompare(a.date_start || ''));
}

/** Bail actif d'un lot (le plus récent actif). */
export function pickActiveLease(leases, today = todayISO()) {
  const actifs = (leases || []).filter((l) => isLeaseActiveAt(l, today));
  if (actifs.length === 0) return null;
  return actifs.sort((a, b) => (b.date_start || '').localeCompare(a.date_start || ''))[0];
}

/** Bail couvrant une période (année, mois 1-12). */
export function pickLeaseForPeriod(leases, year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  const firstISO = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastISO = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const cands = (leases || []).filter((l) => {
    if (!l.date_start || l.date_start > lastISO) return false;
    if (l.date_end && l.date_end < firstISO) return false;
    return true;
  });
  if (cands.length === 0) return null;
  return cands.sort((a, b) => (b.date_start || '').localeCompare(a.date_start || ''))[0];
}

/** Snapshot legacy d'un lot (quand aucun bail n'existe encore). */
export function legacyLotSnapshot(lot) {
  const tenants = Array.isArray(lot.tenants) ? [...lot.tenants] : [];
  if (lot.tenant_name && !tenants.find((t) => t.name === lot.tenant_name)) {
    tenants.unshift({
      id: 'legacy',
      name: lot.tenant_name,
      entry_date: lot.tenant_entry_date || '',
      exit_date: lot.tenant_exit_date || '',
      email: lot.tenant_email || '',
      phone: lot.tenant_phone || '',
    });
  }
  const active = tenants.find((t) => {
    if (!t.entry_date) return true;
    const today = todayISO();
    if (t.entry_date > today) return false;
    if (t.exit_date && t.exit_date < today) return false;
    return true;
  }) || tenants[0] || null;
  return {
    lease_type: lot.lease_type || (lot.furnished ? 'Meublé' : 'Vide-Nu'),
    date_start: active?.entry_date || lot.tenant_entry_date || '',
    date_end: active?.exit_date || lot.tenant_exit_date || '',
    status: 'actif',
    tenants,
    rent_excluding_charges: lot.rent_excluding_charges || 0,
    charges: lot.charges || 0,
    deposit: lot.deposit || 0,
    due_day: 5,
    payment_frequency: 'mensuel',
    indexation_type: 'aucune',
    furnished: !!lot.furnished,
    tenant_name: active?.name || '',
    tenant_email: active?.email || '',
    _legacy: true,
  };
}

/** Infos locatives effectives d'un lot (bail actif sinon legacy). */
export function activeLeaseInfo(lot, leases, today = todayISO()) {
  const active = pickActiveLease(leases, today);
  if (active) return { ...active, computedStatus: computeLeaseStatus(active, today), _legacy: false };
  return { ...legacyLotSnapshot(lot), computedStatus: 'actif', _legacy: true };
}

/** Loyer HC effectif d'un lot (bail actif sinon legacy). */
export function effectiveRent(lot, leases) {
  const info = activeLeaseInfo(lot, leases);
  return Number(info.rent_excluding_charges) || 0;
}

/** Locataires effectifs d'un lot (bail actif sinon legacy). */
export function effectiveTenants(lot, leases) {
  const info = activeLeaseInfo(lot, leases);
  return Array.isArray(info.tenants) ? info.tenants : [];
}

/**
 * ---------------------------------------------------------------------------
 * HELPERS CANONIQUES — Lease est l'unique source de vérité locative.
 * Les champs legacy du Lot ne servent qu'au repli (migration/compat) pour les
 * périodes antérieures non couvertes par un bail. Aucune écriture legacy.
 * ---------------------------------------------------------------------------
 */

/** Bail actif d'un lot à une date donnée (par défaut aujourd'hui). */
export function getActiveLeaseForLot(lotId, leases, dateISO = todayISO()) {
  return pickActiveLease((leases || []).filter((l) => l.lot_id === lotId), dateISO);
}

/** Bail actif d'un lot à une date précise (alias sémantique de getActiveLeaseForLot). */
export function getLeaseAtDate(lotId, leases, dateISO = todayISO()) {
  return getActiveLeaseForLot(lotId, leases, dateISO);
}

/** Locataires actifs d'un lot à une date donnée (issus du bail actif). */
export function getCurrentTenants(lotId, leases, dateISO = todayISO()) {
  const lease = getActiveLeaseForLot(lotId, leases, dateISO);
  if (!lease || !Array.isArray(lease.tenants)) return [];
  return lease.tenants.filter((t) => {
    if (!t) return false;
    if (t.entry_date && t.entry_date > dateISO) return false;
    if (t.exit_date && t.exit_date < dateISO) return false;
    return true;
  });
}

/**
 * Loyer HC mensuel attendu d'un lot pour une période (année, mois 1-12).
 * Renvoie null si aucun bail ne couvre cette période (appelant → repli legacy
 * lot.rent_excluding_charges pour l'historique non migré).
 */
export function getMonthlyRentForLot(lotId, leases, year, month) {
  const lease = pickLeaseForPeriod((leases || []).filter((l) => l.lot_id === lotId), year, month);
  if (!lease) return null;
  return Number(lease.rent_excluding_charges) || 0;
}

/** Charges mensuelles attendues d'un lot pour une période (null si aucun bail). */
export function getMonthlyChargesForLot(lotId, leases, year, month) {
  const lease = pickLeaseForPeriod((leases || []).filter((l) => l.lot_id === lotId), year, month);
  if (!lease) return null;
  return Number(lease.charges) || 0;
}

/**
 * Loyer HC effectif d'un lot pour la période courante : bail couvrant le mois
 * sinon repli legacy lot.rent_excluding_charges. Utilisé pour les KPI "actuels".
 */
export function currentRentHC(lot, leases, today = todayISO()) {
  const d = new Date(today);
  const lease = pickLeaseForPeriod(
    (leases || []).filter((l) => l.lot_id === lot.id),
    d.getFullYear(),
    d.getMonth() + 1
  );
  if (lease) return Number(lease.rent_excluding_charges) || 0;
  return Number(lot?.rent_excluding_charges) || 0;
}

/** Regroupe les baux par statut pour l'affichage. */
export function groupLeasesByStatus(leases, today = todayISO()) {
  const groups = { futur: [], actif: [], termine: [], resilie: [] };
  for (const l of leases || []) {
    const s = computeLeaseStatus(l, today);
    if (groups[s]) groups[s].push(l);
  }
  for (const k of Object.keys(groups)) groups[k] = sortLeases(groups[k]);
  return groups;
}