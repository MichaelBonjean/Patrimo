/**
 * RBAC — Contrôle d'accès basé sur les rôles patrimoine.
 *
 * Rôles: OWNER, ADMIN, MANAGER, ACCOUNTANT, ASSOCIATE, READ_ONLY.
 * Les droits sont vérifiés côté serveur (backend functions) via `requirePermission`.
 * L'isolation des données (quel patrimoine) est assurée par RLS (owner_id),
 * ce module contrôle QUOI un rôle peut faire sur ce patrimoine.
 */

export type PatrimonyRole = 'OWNER' | 'ADMIN' | 'ASSOCIATE' | 'ACCOUNTANT' | 'MANAGER' | 'READ_ONLY';

export type Permission =
  | 'view'
  | 'manage_properties'
  | 'delete_property'
  | 'manage_finances'
  | 'manage_documents'
  | 'reconcile'
  | 'generate_quittance'
  | 'manage_rent_revision'
  | 'manage_charge_regularization'
  | 'manage_alerts'
  | 'import_data'
  | 'manage_team'
  | 'view_audit_log';

const ALL_PERMS: Permission[] = [
  'view', 'manage_properties', 'delete_property', 'manage_finances',
  'manage_documents', 'reconcile', 'generate_quittance', 'manage_rent_revision',
  'manage_charge_regularization', 'manage_alerts', 'import_data', 'manage_team', 'view_audit_log',
];

const MATRIX: Record<PatrimonyRole, Permission[] | 'ALL'> = {
  OWNER: 'ALL',
  ADMIN: 'ALL',
  // Gestionnaire opérationnel: biens, documents, quittances, alertes, révisions, rapprochements
  MANAGER: ['view', 'manage_properties', 'manage_documents', 'generate_quittance', 'manage_alerts', 'manage_rent_revision', 'manage_charge_regularization', 'reconcile'],
  // Comptable: finances, documents, rapprochements, quittances, lecture du journal
  ACCOUNTANT: ['view', 'manage_finances', 'manage_documents', 'reconcile', 'generate_quittance', 'view_audit_log'],
  // Associé: lecture seule (sur structures autorisées via allowed_holders)
  ASSOCIATE: ['view'],
  // Lecture seule: aucune modification
  READ_ONLY: ['view'],
};

const ROLES: PatrimonyRole[] = ['OWNER', 'ADMIN', 'ASSOCIATE', 'ACCOUNTANT', 'MANAGER', 'READ_ONLY'];

export function normalizeRole(r?: string | null): PatrimonyRole | null {
  if (!r) return null;
  const up = String(r).toUpperCase();
  return ROLES.includes(up as PatrimonyRole) ? (up as PatrimonyRole) : null;
}

export function can(role: string | null | undefined, perm: Permission): boolean {
  const r = normalizeRole(role);
  if (!r) return false;
  const set = MATRIX[r];
  if (set === 'ALL') return true;
  return set.includes(perm);
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(msg: string) {
    super(msg);
    this.name = 'ForbiddenError';
  }
}

/** Vérifie côté serveur que le rôle dispose de la permission — lève 403 sinon. */
export function requirePermission(role: string | null | undefined, perm: Permission): void {
  if (!can(role, perm)) {
    throw new ForbiddenError(`Rôle « ${role || 'aucun'} » insuffisant pour l'action « ${perm} ».`);
  }
}