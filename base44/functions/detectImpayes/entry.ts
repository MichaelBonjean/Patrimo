import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { syncImpayesAll } from '../../shared/impayeEngine.ts';

/**
 * Détection des impayés — pilotée par le compte locataire (RentDue/Payment).
 * Un impayé apparaît dès qu'une échéance arrivée à maturité présente un solde
 * débiteur (balance > 0). Aucun rapprochement bancaire approximatif.
 *
 * - Cron (pas d'utilisateur) : scanne tous les patrimoines.
 * - Admin authentifié : limite à son propre patrimoine (owner_id).
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') {
      return Response.json(
        { error: 'Forbidden: réservé au système planifié ou admin' },
        { status: 403 },
      );
    }

    const asOfISO = new Date().toISOString().slice(0, 10);
    const owner_filter = user?.email || undefined;

    const res = await syncImpayesAll(svc, asOfISO, owner_filter);
    return Response.json({ ok: true, as_of: asOfISO, ...res });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}