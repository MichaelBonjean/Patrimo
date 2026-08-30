import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { analyzeMonth } from '../../shared/monthClose.ts';

/**
 * Gestion de la clôture mensuelle.
 *  - op 'analyze' : renvoie le résumé consolidé + le statut courant.
 *  - op 'close'   : passe status='closed' et snapshotte le résumé (historisé).
 *  - op 'reopen'  : repasse status='open' (réouverture historisée).
 *
 * La clôture est un marqueur de statut : elle n'empêche aucune correction
 * ultérieure ; toute réouverture est tracée dans history[].
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const owner = user.email;
    const svc = base44.asServiceRole;

    const body = await req.json().catch(() => ({}));
    const op = body.op || 'analyze';
    const year = Number(body.year);
    const month = Number(body.month);
    if (!year || !month) return Response.json({ error: 'year et month requis' }, { status: 400 });

    const period = `${year}-${String(month).padStart(2, '0')}`;
    const existing = await svc.entities.MonthClose.filter({ owner_id: owner, period });
    const record = existing[0] || null;

    if (op === 'analyze') {
      const summary = await analyzeMonth(svc, owner, year, month);
      return Response.json({ summary, status: record?.status || 'open', record });
    }

    if (op === 'close' || op === 'reopen') {
      const newStatus = op === 'close' ? 'closed' : 'open';
      const now = new Date().toISOString();
      const entry = {
        date: now,
        action: op,
        actor: owner,
        from_status: record?.status || 'open',
        to_status: newStatus,
        note: body.note || '',
      };

      let summary = record?.summary;
      if (op === 'close') {
        summary = await analyzeMonth(svc, owner, year, month);
      }

      if (record) {
        const updated = await svc.entities.MonthClose.update(record.id, {
          status: newStatus,
          closed_date: op === 'close' ? now.slice(0, 10) : null,
          summary,
          history: [...(record.history || []), entry],
        });
        return Response.json({ ok: true, record: updated });
      }
      const created = await svc.entities.MonthClose.create({
        owner_id: owner,
        is_demo: false,
        period,
        year,
        month,
        status: newStatus,
        closed_date: op === 'close' ? now.slice(0, 10) : null,
        summary,
        history: [entry],
      });
      return Response.json({ ok: true, record: created });
    }

    return Response.json({ error: 'op inconnu' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}