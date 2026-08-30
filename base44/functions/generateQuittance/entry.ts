import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { generateQuittanceFor } from '../../shared/quittanceEngine.ts';

/**
 * Point d'entrée HTTP — génère (ou renvoie) une quittance/reçu immuable à
 * partir du compte locataire réel (RentDue -> Payments). Toute la logique est
 * dans le moteur partagé `quittanceEngine.ts` (réutilisé par les tests).
 *
 * Payload: { lease_id, year, month } — Réponse: { ok, kind, reason?, quittance? }.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' && user.role !== 'user') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body: any = {};
    try { body = await req.json(); } catch (_e) {
      return Response.json({ error: 'Corps de requête invalide' }, { status: 400 });
    }

    const result = await generateQuittanceFor(base44.asServiceRole, user, {
      lease_id: String(body.lease_id || ''),
      year: Number(body.year),
      month: Number(body.month),
    });

    if (!result.ok) {
      return Response.json(result.body || { error: 'Quittance impossible' }, { status: result.status || 400 });
    }
    return Response.json({ ok: true, kind: result.kind, reason: result.reason, quittance: result.quittance });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}