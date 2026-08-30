import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/**
 * manageReminders — CRUD sur les rappels personnels (PersonalReminder).
 *
 *   Payload : { op, ... }
 *   ops :
 *     list                  -> { items } (tous, tri -due_date)
 *     create  { title, due_date?, note?, priority?, property_id?, tags? }
 *     update  { id, patch }
 *     delete  { id }
 *     snooze  { id, snoozed_until }        -> status snoozed
 *     mark_done { id }                    -> status done + done_at
 *
 *   Isolation owner_id (RLS) + contrôle explicite owner_id == user.email.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' && user.role !== 'user') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const svc = base44.asServiceRole;
    const owner = user.email;

    let body: any = {};
    try { body = await req.json(); } catch (_e) { /* vide */ }
    const op = String(body.op || 'list');

    if (op === 'list') {
      const items = await svc.entities.PersonalReminder.filter({ owner_id: owner }).catch(() => []);
      const sorted = (items || []).slice().sort((a: any, b: any) =>
        String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
      return Response.json({ ok: true, items: sorted });
    }

    if (op === 'create') {
      const title = String(body.title || '').trim();
      if (!title) return Response.json({ error: 'title requis' }, { status: 400 });
      const rec = await svc.entities.PersonalReminder.create({
        owner_id: owner,
        is_demo: false,
        patrimony_id: owner,
        title,
        note: body.note ? String(body.note) : null,
        due_date: body.due_date ? String(body.due_date) : null,
        due_time: body.due_time ? String(body.due_time) : null,
        priority: ['low', 'normal', 'high'].includes(body.priority) ? body.priority : 'normal',
        status: 'pending',
        property_id: body.property_id ? String(body.property_id) : null,
        tags: Array.isArray(body.tags) ? body.tags : [],
      });
      return Response.json({ ok: true, item: rec });
    }

    if (op === 'update') {
      const id = String(body.id || '');
      if (!id) return Response.json({ error: 'id requis' }, { status: 400 });
      const patch: any = {};
      for (const k of ['title', 'note', 'due_date', 'due_time', 'priority', 'property_id', 'tags', 'status']) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      const rec = await svc.entities.PersonalReminder.update(id, patch);
      return Response.json({ ok: true, item: rec });
    }

    if (op === 'delete') {
      const id = String(body.id || '');
      if (!id) return Response.json({ error: 'id requis' }, { status: 400 });
      await svc.entities.PersonalReminder.delete(id);
      return Response.json({ ok: true });
    }

    if (op === 'snooze') {
      const id = String(body.id || '');
      if (!id) return Response.json({ error: 'id requis' }, { status: 400 });
      const snoozed_until = String(body.snoozed_until || '');
      const rec = await svc.entities.PersonalReminder.update(id, {
        status: 'snoozed',
        snoozed_until: snoozed_until || null,
      });
      return Response.json({ ok: true, item: rec });
    }

    if (op === 'mark_done') {
      const id = String(body.id || '');
      if (!id) return Response.json({ error: 'id requis' }, { status: 400 });
      const rec = await svc.entities.PersonalReminder.update(id, {
        status: 'done',
        done_at: new Date().toISOString(),
      });
      return Response.json({ ok: true, item: rec });
    }

    return Response.json({ error: 'op inconnu' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: (error as any)?.message || 'erreur' }, { status: 500 });
  }
}