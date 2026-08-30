import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * Enregistre une action de recouvrement sur un impayé, l'ajoute à
 * l'historique horodaté (action_history) et fait progresser l'étape du
 * workflow si demandé. Côté serveur pour garantir l'intégrité de l'historique.
 *
 * Payload:
 *   { impaye_id, stage?, action_type?, method?, note?, document_url?, amount? }
 * - stage: nouvelle étape du workflow (echeance_impayee, rappel_amiable,
 *   deuxieme_relance, mise_en_demeure_amiable, dossier_professionnel,
 *   régularisé, abandonné). Si absent, laisse le statut inchangé (action pure).
 * - method: email | courrier_lrar | manuel | generé | telechargement | transmission | paiement | note
 *
 * L'utilisateur doit être propriétaire de l'impayé (owner_id === user.email).
 */
const STAGE_LABELS = {
  echeance_impayee: 'Échéance non réglée',
  rappel_amiable: 'Rappel amiable',
  deuxieme_relance: 'Deuxième relance',
  mise_en_demeure_amiable: 'Mise en demeure amiable',
  dossier_professionnel: 'Dossier transmis à un professionnel',
  régularisé: 'Dette régularisée',
  abandonné: 'Dette abandonnée',
  note: 'Note',
};
const STAGE_ACTOR = {
  echeance_impayee: 'systeme', régularisé: 'systeme', abandonné: 'systeme',
  rappel_amiable: 'bailleur', deuxieme_relance: 'bailleur',
  mise_en_demeure_amiable: 'bailleur', dossier_professionnel: 'bailleur', note: 'bailleur',
};

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
      return Response.json({ error: 'Corps invalide' }, { status: 400 });
    }
    const impaye_id = String(body.impaye_id || '');
    if (!impaye_id) return Response.json({ error: 'impaye_id requis' }, { status: 400 });

    const svc = base44.asServiceRole;
    const imp = await svc.entities.Impaye.get(impaye_id).catch(() => null);
    if (!imp || imp.owner_id !== user.email) {
      return Response.json({ error: 'Impayé introuvable' }, { status: 404 });
    }

    const stage = body.stage ? String(body.stage) : '';
    const action_type = body.action_type ? String(body.action_type) : '';
    const method = body.method ? String(body.method) : 'manuel';
    const note = String(body.note || '');
    const document_url = body.document_url ? String(body.document_url) : '';
    const amount = body.amount != null ? Number(body.amount) : null;

    const allowed = Object.keys(STAGE_LABELS);
    if (stage && !allowed.includes(stage)) {
      return Response.json({ error: 'stage inconnu' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const action = {
      date: now,
      stage: stage || action_type || 'note',
      label: STAGE_LABELS[stage || action_type] || action_type || 'Note',
      actor: STAGE_ACTOR[stage || action_type] || 'bailleur',
      method,
      note,
      document_url,
      ...(amount != null && Number.isFinite(amount) ? { amount } : {}),
    };

    const action_history = Array.isArray(imp.action_history) ? [...imp.action_history, action] : [action];
    const patch: any = { action_history, last_relance_date: now.slice(0, 10) };

    if (stage && stage !== imp.status) patch.status = stage;
    if (stage === 'régularisé') {
      patch.missing_amount = 0;
      patch.outstanding_amount = 0;
      patch.regularized_date = now.slice(0, 10);
    }
    if (stage === 'abandonné') {
      patch.abandoned_date = now.slice(0, 10);
    }

    await svc.entities.Impaye.update(imp.id, patch);

    return Response.json({ ok: true, status: patch.status || imp.status, action });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}