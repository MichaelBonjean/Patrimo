import { base44 } from '@/api/base44Client';

/**
 * Accès côté frontend au RBAC patrimoine. Miroir de base44/shared/rbac.ts.
 * Le contrôle réel (sécurité) est appliqué côté serveur dans les backend functions;
 * ce module n'agit que sur l'affichage (masquer les actions interdites, etc.).
 */

const MATRIX = {
  OWNER: 'ALL',
  ADMIN: 'ALL',
  MANAGER: ['view', 'manage_properties', 'manage_documents', 'generate_quittance', 'manage_alerts', 'manage_rent_revision', 'manage_charge_regularization', 'reconcile'],
  ACCOUNTANT: ['view', 'manage_finances', 'manage_documents', 'reconcile', 'generate_quittance', 'view_audit_log'],
  ASSOCIATE: ['view'],
  READ_ONLY: ['view'],
};

export function can(role, perm) {
  if (!role) return false;
  const r = String(role).toUpperCase();
  const set = MATRIX[r];
  if (!set) return false;
  if (set === 'ALL') return true;
  return set.includes(perm);
}

export function roleLabel(role) {
  const map = {
    OWNER: 'Propriétaire',
    ADMIN: 'Administrateur',
    MANAGER: 'Gestionnaire',
    ACCOUNTANT: 'Comptable',
    ASSOCIATE: 'Associé',
    READ_ONLY: 'Lecture seule',
  };
  return map[String(role || '').toUpperCase()] || role || '—';
}

export const ROLE_OPTIONS = [
  { value: 'ADMIN', label: 'Administrateur', description: 'Tous les droits hors gestion du OWNER' },
  { value: 'MANAGER', label: 'Gestionnaire', description: 'Biens, documents, quittances, alertes, révisions, rapprochements' },
  { value: 'ACCOUNTANT', label: 'Comptable', description: 'Finances, documents, rapprochements, quittances, journal' },
  { value: 'ASSOCIATE', label: 'Associé', description: 'Lecture seule (structures autorisées)' },
  { value: 'READ_ONLY', label: 'Lecture seule', description: 'Aucune modification' },
];

/** Journalise une action sensible côté client (création/modification/suppression). */
export async function logAudit({ action, entity_type, entity_id, entity_label, details }) {
  try {
    await base44.functions.invoke('recordAudit', {
      action, entity_type, entity_id, entity_label, details: details || {},
    });
  } catch (e) {
    // L'audit ne doit jamais bloquer l'UI.
    console.error('[audit] logAudit failed', e);
  }
}