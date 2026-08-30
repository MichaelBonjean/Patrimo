import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { refreshAlerts } from '../../shared/alertsPersist.ts';

/**
 * Centre d'actions & d'alertes unifié (utilisé par le Dashboard et la page
 * Alertes). Une seule logique de génération (alertsEngine) → dédoublonnée par
 * empreinte stable → persistence dans l'entité Alert.
 *
 *  - op 'list' (défaut) : rafraîchit les alertes (génère + dédoublonne) puis
 *                         renvoie toutes les alertes + compteurs.
 *  - op 'resolve'       : marque une alerte traitée.
 *  - op 'ignore'        : marque une alerte ignorée.
 *  - op 'snooze'        : reporte une alerte (days, défaut 7).
 *  - op 'reactivate'    : remet une alerte active.
 *  - op 'bulkResolve'   : traite plusieurs alertes.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const owner = user.email;
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const op = body.op || 'list';

    if (op === 'list') {
      const { alerts, counts } = await refreshAlerts(svc, owner);
      return Response.json({ alerts, counts });
    }

    const getRec = async (id: string) => {
      const recs = await svc.entities.Alert.filter({ owner_id: owner });
      return recs.find((r) => r.id === id) || null;
    };

    if (op === 'resolve' || op === 'ignore') {
      if (!body.id) return Response.json({ error: 'id requis' }, { status: 400 });
      const rec = await getRec(body.id);
      if (!rec) return Response.json({ error: 'Alerte introuvable' }, { status: 404 });
      const updated = await svc.entities.Alert.update(rec.id, {
        status: op === 'resolve' ? 'resolved' : 'ignored',
        resolved_date: new Date().toISOString().slice(0, 10),
        actor: owner,
      });
      return Response.json({ record: updated });
    }

    if (op === 'snooze') {
      if (!body.id) return Response.json({ error: 'id requis' }, { status: 400 });
      const rec = await getRec(body.id);
      if (!rec) return Response.json({ error: 'Alerte introuvable' }, { status: 404 });
      const days = Math.max(1, Math.min(90, Number(body.days) || 7));
      const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      const updated = await svc.entities.Alert.update(rec.id, { status: 'snoozed', snooze_until: until, actor: owner });
      return Response.json({ record: updated });
    }

    if (op === 'reactivate') {
      if (!body.id) return Response.json({ error: 'id requis' }, { status: 400 });
      const rec = await getRec(body.id);
      if (!rec) return Response.json({ error: 'Alerte introuvable' }, { status: 404 });
      const updated = await svc.entities.Alert.update(rec.id, { status: 'active', snooze_until: null, resolved_date: null, actor: owner });
      return Response.json({ record: updated });
    }

    if (op === 'bulkResolve') {
      const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
      if (!ids.length) return Response.json({ ok: true, n: 0 });
      const recs = await svc.entities.Alert.filter({ owner_id: owner });
      const today = new Date().toISOString().slice(0, 10);
      let n = 0;
      for (const id of ids) {
        const rec = recs.find((r) => r.id === id);
        if (rec && rec.status !== 'resolved') {
          await svc.entities.Alert.update(rec.id, { status: 'resolved', resolved_date: today, actor: owner });
          n++;
        }
      }
      return Response.json({ ok: true, n });
    }

    return Response.json({ error: 'op inconnu' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}