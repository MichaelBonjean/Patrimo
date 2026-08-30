/**
 * Audit log — journalisation des opérations sensibles.
 *
 * `logAction` est conçu pour ne JAMAIS casser l'opération principale: toute
 * erreur d'écriture est absorbée et tracée en console. Détails: qui (actor),
 * a fait quoi (action), quand (date), sur quel objet (entity_type/id/label).
 */

export type AuditAction =
  | 'create' | 'update' | 'delete'
  | 'import' | 'reconcile' | 'quittance'
  | 'financial_change' | 'admin_access' | 'other';

export interface LogActionOpts {
  patrimony_id: string;
  actor_email: string;
  actor_role?: string | null;
  action: AuditAction;
  entity_type?: string;
  entity_id?: string;
  entity_label?: string;
  details?: any;
  req?: Request | null;
}

export async function logAction(svc: any, opts: LogActionOpts): Promise<void> {
  try {
    const headers = opts.req?.headers;
    const ip = headers?.get?.('x-forwarded-for') || '';
    const ua = headers?.get?.('user-agent') || '';
    await svc.entities.AuditLog.create({
      patrimony_id: opts.patrimony_id,
      actor_email: opts.actor_email,
      actor_role: opts.actor_role || '',
      action: opts.action,
      entity_type: opts.entity_type || '',
      entity_id: opts.entity_id || '',
      entity_label: opts.entity_label || '',
      details: opts.details || {},
      date: new Date().toISOString(),
      ip,
      user_agent: ua,
    });
  } catch (e: any) {
    // L'audit ne doit jamais bloquer l'opération métier.
    console.error('[audit] logAction failed:', e?.message || e);
  }
}