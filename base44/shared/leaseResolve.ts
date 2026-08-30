/**
 * Résolution des bails (Lease) — helpers partagés par les fonctions backend.
 * Source canonique de la donnée locative ; les champs legacy du Lot restent
 * disponibles en repli (fallback) tant que la migration n'est pas sécurisée.
 */

export function cleanStr(v: any): string {
  if (!v) return '';
  const s = String(v).trim();
  return (s === 'null' || s === 'undefined') ? '' : s;
}

/** Retourne aujourd'hui à minuit (date locale) sous forme ISO YYYY-MM-DD. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Statut calculé d'un bail selon ses dates et aujourd'hui. */
export function computeLeaseStatus(lease: any, today: string = todayISO()): string {
  const start = lease.date_start || '';
  const end = lease.date_end || '';
  if (start && start > today) return 'futur';
  if (end && end < today) return 'termine';
  // Pas de date de fin = bail en cours.
  return 'actif';
}

/** Un bail est-il actif à une date donnée (par défaut aujourd'hui) ? */
export function isLeaseActiveAt(lease: any, dateISO: string = todayISO()): boolean {
  if (!lease.date_start || lease.date_start > dateISO) return false;
  if (lease.date_end && lease.date_end < dateISO) return false;
  return true;
}

/** Bail actif parmi une liste de baux d'un lot (le plus récent actif). */
export function pickActiveLease(leases: any[], today: string = todayISO()): any | null {
  const actifs = (leases || []).filter(l => isLeaseActiveAt(l, today));
  if (actifs.length === 0) return null;
  // Le plus récent date_start gagne (en cas de chevauchement).
  actifs.sort((a, b) => (b.date_start || '').localeCompare(a.date_start || ''));
  return actifs[0];
}

/** Bail couvrant une période (année, mois 1-12) — pour quittances / impayés. */
export function pickLeaseForPeriod(
  leases: any[],
  year: number,
  month: number
): any | null {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const firstISO = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastISO = `${year}-${String(month).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  const cands = (leases || []).filter((l) => {
    if (!l.date_start) return false;
    if (l.date_start > lastISO) return false;
    if (l.date_end && l.date_end < firstISO) return false;
    return true;
  });
  if (cands.length === 0) return null;
  cands.sort((a, b) => (b.date_start || '').localeCompare(a.date_start || ''));
  return cands[0];
}

/** Snapshot legacy du lot (au cas où aucun bail n'existe encore). */
export function legacyLotSnapshot(lot: any, property: any): any {
  const tenants: any[] = Array.isArray(lot.tenants) ? [...lot.tenants] : [];
  if (cleanStr(lot.tenant_name) && !tenants.find((t) => t.name === lot.tenant_name)) {
    tenants.unshift({
      id: 'legacy',
      name: cleanStr(lot.tenant_name),
      entry_date: lot.tenant_entry_date || '',
      exit_date: lot.tenant_exit_date || '',
      email: cleanStr(lot.tenant_email),
      phone: cleanStr(lot.tenant_phone),
    });
  }
  const active = tenants.find((t) => {
    if (!t.entry_date) return true;
    const today = todayISO();
    if (t.entry_date > today) return false;
    if (t.exit_date && t.exit_date < today) return false;
    return true;
  }) || tenants[0] || null;
  const type = lot.lease_type || (lot.furnished ? 'Meublé' : 'Vide-Nu');
  return {
    lease_type: type,
    date_start: active?.entry_date || lot.tenant_entry_date || lot.acquisition_date || '',
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

/** Informations locatives effectives : bail actif sinon snapshot legacy. */
export function activeLeaseInfo(
  leases: any[],
  lot: any,
  property: any,
  today: string = todayISO()
): any {
  const active = pickActiveLease(leases, today);
  if (active) return { ...active, _legacy: false };
  return legacyLotSnapshot(lot, property);
}

/** Bail actif d'un lot résolu côté backend (charge les baux du lot). */
export async function loadActiveLease(
  svc: any,
  lot: any,
  property: any,
  today: string = todayISO()
): Promise<any> {
  const leases = await svc.entities.Lease.filter({ lot_id: lot.id });
  return activeLeaseInfo(leases, lot, property, today);
}

/**
 * Helpers canoniques — Lease est l'unique source de vérité locative.
 * Les champs legacy du Lot ne servent qu'au repli (migration/compat) pour les
 * périodes antérieures non couvertes par un bail. Aucune écriture legacy.
 */

/** Bail actif d'un lot à une date donnée (par défaut aujourd'hui). */
export function getActiveLeaseForLot(
  lotId: any,
  leases: any[],
  today: string = todayISO()
): any | null {
  return pickActiveLease((leases || []).filter((l: any) => l.lot_id === lotId), today);
}

/** Bail actif d'un lot à une date précise. */
export function getLeaseAtDate(
  lotId: any,
  leases: any[],
  dateISO: string = todayISO()
): any | null {
  return getActiveLeaseForLot(lotId, leases, dateISO);
}

/** Locataires actifs d'un lot à une date donnée (issus du bail actif). */
export function getCurrentTenants(
  lotId: any,
  leases: any[],
  dateISO: string = todayISO()
): any[] {
  const lease = getActiveLeaseForLot(lotId, leases, dateISO);
  if (!lease || !Array.isArray(lease.tenants)) return [];
  return lease.tenants.filter((t: any) => {
    if (!t) return false;
    if (t.entry_date && t.entry_date > dateISO) return false;
    if (t.exit_date && t.exit_date < dateISO) return false;
    return true;
  });
}

/** Loyer HC mensuel attendu d'un lot pour une période (null si aucun bail). */
export function getMonthlyRentForLot(
  lotId: any,
  leases: any[],
  year: number,
  month: number
): number | null {
  const lease = pickLeaseForPeriod(
    (leases || []).filter((l: any) => l.lot_id === lotId),
    year,
    month
  );
  if (!lease) return null;
  return Number(lease.rent_excluding_charges) || 0;
}

/** Charges mensuelles attendues d'un lot pour une période (null si aucun bail). */
export function getMonthlyChargesForLot(
  lotId: any,
  leases: any[],
  year: number,
  month: number
): number | null {
  const lease = pickLeaseForPeriod(
    (leases || []).filter((l: any) => l.lot_id === lotId),
    year,
    month
  );
  if (!lease) return null;
  return Number(lease.charges) || 0;
}