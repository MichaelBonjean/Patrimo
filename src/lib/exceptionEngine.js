/**
 * MOTEUR « EXCEPTION ONLY » — Patrimo.
 *
 *   Chaque élément métier (paiement, document, impayé, alerte, indexation,
 *   clôture mensuelle) est classifié en un verdict parmi :
 *
 *     AUTO_PROCESS        → traité automatiquement, aucune intervention.
 *     NEEDS_CONFIRMATION  → le système a une proposition fiable mais sensible /
 *                           ambiguë : une confirmation rapide suffit.
 *     NEEDS_ACTION        → action réelle requise (relancer, clôturer, catégoriser…).
 *     ERROR               → anomalie bloquante (échec d'analyse, doublon…).
 *
 *   RÈGLE UI : l'interface ne présente QUE les verdicts NEEDS_CONFIRMATION,
 *   NEEDS_ACTION et ERROR. Un mois normal sans anomalie ne doit nécessiter
 *   quasiment aucune saisie manuelle.
 *
 *   MOTEUR PUR : aucun accès base, aucun effet de bord. Réutilisable côté
 *   front (aperçu instantané) et backend (fonction computeAttentionQueue).
 *   Chaque évaluateur consomme les champs PERSISTÉS des entités — il ne
 *   re-déroule pas les moteurs lourds (réconciliation, commit plan) sauf
 *   pour les DocumentsImport en attente de revue (plan léger reconstitué).
 */

export const EXCEPTION_LEVELS = {
  AUTO_PROCESS: 'AUTO_PROCESS',
  NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION',
  NEEDS_ACTION: 'NEEDS_ACTION',
  ERROR: 'ERROR',
};

export const EXCEPTION_DOMAINS = {
  PAYMENT: 'payment',
  DOCUMENT: 'document',
  IMPAYE: 'impaye',
  ALERT: 'alert',
  RENT_REVISION: 'rentRevision',
  MONTH_CLOSE: 'monthClose',
};

// Priorité d'affichage (tri croissant : 0 = le plus urgent).
const PRIORITY = {
  [EXCEPTION_LEVELS.ERROR]: 0,
  urgent: 1,
  important: 2,
  a_traiter: 3,
  needs_confirmation: 4,
};

function verdict(level, domain, opts = {}) {
  const {
    reason = '', linked_type = 'none', linked_id = '', linked_label = '',
    action_url = '', priority, date = null, meta = {},
  } = opts;
  return {
    level, domain, reason,
    linked_type, linked_id, linked_label,
    action_url,
    priority: priority != null ? priority : (PRIORITY[level] ?? 9),
    date, meta,
  };
}

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return v.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

// ── Paiements / opérations bancaires ────────────────────────────────────────
//
//consume les champs persistés de BankTransaction (status, dedup_status,
// category). La réconciliation lourde (loyers, prêts) est faite à l'import ;
// ici on se contente de lire le verdict persisté pour ne rien recalculer.
export function evaluateBankTransaction(tx) {
  if (!tx) return null;
  const st = tx.status;
  const label = tx.raw_description || tx.normalized_description || 'Opération bancaire';
  if (st === 'linked' || st === 'ignored') {
    return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.PAYMENT, {
      reason: 'Paiement rapproché automatiquement', linked_id: tx.id, linked_label: label,
    });
  }
  if (st === 'pending') {
    if (tx.dedup_status === 'exact' || tx.duplicate_of) {
      return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.PAYMENT, {
        reason: 'Doublon exact — écarté automatiquement', linked_id: tx.id, linked_label: label,
      });
    }
    if (tx.dedup_status === 'probable') {
      return verdict(EXCEPTION_LEVELS.NEEDS_CONFIRMATION, EXCEPTION_DOMAINS.PAYMENT, {
        reason: 'Doublon probable — confirmer l\'écartement', linked_id: tx.id, linked_label: label,
        action_url: '/banque', priority: PRIORITY.needs_confirmation, date: tx.date,
      });
    }
    if (tx.category) {
      return verdict(EXCEPTION_LEVELS.NEEDS_CONFIRMATION, EXCEPTION_DOMAINS.PAYMENT, {
        reason: `Opération catégorisée « ${tx.category} » — à confirmer`,
        linked_id: tx.id, linked_label: label, action_url: '/banque',
        priority: PRIORITY.needs_confirmation, date: tx.date,
      });
    }
    return verdict(EXCEPTION_LEVELS.NEEDS_ACTION, EXCEPTION_DOMAINS.PAYMENT, {
      reason: 'Opération non reconnue — à catégoriser',
      linked_id: tx.id, linked_label: label, action_url: '/banque',
      priority: PRIORITY.a_traiter, date: tx.date,
    });
  }
  return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.PAYMENT, {
    reason: 'Opération traitée', linked_id: tx.id, linked_label: label,
  });
}

// ── Documents importés ──────────────────────────────────────────────────────
// `plan` est le résultat de buildCommitPlan (reconstitué côté backend pour
// les docs en awaiting_review) ; il porte needs_review + risk_notes + targets.
export function evaluateDocumentImport(rec, plan = null) {
  if (!rec) return null;
  const st = rec.status;
  const label = rec.file_name || 'Document';
  if (st === 'committed') {
    return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.DOCUMENT, {
      reason: 'Document validé et intégré', linked_id: rec.id, linked_label: label,
    });
  }
  if (st === 'rejected') {
    return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.DOCUMENT, {
      reason: 'Document rejeté', linked_id: rec.id, linked_label: label,
    });
  }
  if (st === 'failed') {
    return verdict(EXCEPTION_LEVELS.ERROR, EXCEPTION_DOMAINS.DOCUMENT, {
      reason: rec.error_message || 'Échec de l\'analyse du document',
      linked_id: rec.id, linked_label: label, action_url: '/import',
      priority: PRIORITY[EXCEPTION_LEVELS.ERROR],
    });
  }
  if (['uploaded', 'ocr_running', 'extracting'].includes(st)) {
    return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.DOCUMENT, {
      reason: 'Analyse du document en cours', linked_id: rec.id, linked_label: label,
    });
  }
  // awaiting_review
  const classification = rec.classification || 'unknown';
  if (classification === 'unknown' || classification === 'autre') {
    return verdict(EXCEPTION_LEVELS.NEEDS_ACTION, EXCEPTION_DOMAINS.DOCUMENT, {
      reason: 'Document non classé — à catégoriser',
      linked_id: rec.id, linked_label: label, action_url: '/import',
      priority: PRIORITY.a_traiter,
    });
  }
  const needsReview = plan?.needs_review ?? true;
  const riskNotes = plan?.risk_notes || [];
  if (!needsReview && riskNotes.length === 0) {
    return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.DOCUMENT, {
      reason: 'Document reconnu — validation automatique possible',
      linked_id: rec.id, linked_label: label,
    });
  }
  return verdict(EXCEPTION_LEVELS.NEEDS_CONFIRMATION, EXCEPTION_DOMAINS.DOCUMENT, {
    reason: riskNotes[0] || 'Donnée sensible ou ambiguë — à valider',
    linked_id: rec.id, linked_label: label, action_url: '/import',
    priority: PRIORITY.needs_confirmation,
  });
}

// ── Impayés ─────────────────────────────────────────────────────────────────
export function evaluateImpaye(imp) {
  if (!imp) return null;
  const st = imp.status;
  const label = imp.tenant_name || 'Locataire';
  if (st === 'régularisé' || st === 'abandonné') {
    return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.IMPAYE, {
      reason: 'Impayé clos', linked_id: imp.id, linked_label: label,
    });
  }
  const urgent = ['deuxieme_relance', 'mise_en_demeure_amiable', 'dossier_professionnel'].includes(st);
  const amt = fmtMoney(imp.missing_amount != null ? imp.missing_amount : imp.outstanding_amount);
  return verdict(EXCEPTION_LEVELS.NEEDS_ACTION, EXCEPTION_DOMAINS.IMPAYE, {
    reason: `Impayé ${label}${amt ? ` — reste ${amt}` : ''}`,
    linked_id: imp.id, linked_label: label, action_url: '/loyers?tab=impayes',
    priority: urgent ? PRIORITY.urgent : PRIORITY.important,
    date: imp.due_date || imp.detected_date,
  });
}

// ── Alertes ──────────────────────────────────────────────────────────────────
export function evaluateAlert(a) {
  if (!a) return null;
  if (a.status === 'resolved' || a.status === 'ignored' || a.status === 'snoozed') {
    return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.ALERT, {
      reason: a.title || 'Alerte traitée', linked_id: a.id, linked_label: a.linked_label,
    });
  }
  if (a.status !== 'active') {
    return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.ALERT, { linked_id: a.id });
  }
  if (a.priority === 'information') {
    return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.ALERT, {
      reason: a.title || 'Information', linked_id: a.id, linked_label: a.linked_label,
    });
  }
  const prio = a.priority === 'urgent' ? PRIORITY.urgent
    : a.priority === 'important' ? PRIORITY.important
    : PRIORITY.a_traiter;
  return verdict(EXCEPTION_LEVELS.NEEDS_ACTION, EXCEPTION_DOMAINS.ALERT, {
    reason: a.title || a.message || 'Alerte à traiter',
    linked_id: a.id, linked_label: a.linked_label, action_url: a.action_url || '/',
    priority: prio, date: a.date,
  });
}

// ── Révisions de loyer ───────────────────────────────────────────────────────
export function evaluateRentRevision(r) {
  if (!r) return null;
  if (r.status === 'appliquee' || r.status === 'validee' || r.status === 'refusee') {
    return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.RENT_REVISION, {
      reason: 'Révision traitée', linked_id: r.id, linked_label: r.lot_designation || r.property_name,
    });
  }
  if (r.status === 'proposition') {
    if (r.can_apply) {
      return verdict(EXCEPTION_LEVELS.NEEDS_ACTION, EXCEPTION_DOMAINS.RENT_REVISION, {
        reason: 'Révision de loyer applicable',
        linked_id: r.id, linked_label: r.lot_designation || r.property_name,
        action_url: '/loyers?tab=loyers-revision', priority: PRIORITY.a_traiter,
        date: r.new_revision_date,
      });
    }
    return verdict(EXCEPTION_LEVELS.NEEDS_CONFIRMATION, EXCEPTION_DOMAINS.RENT_REVISION, {
      reason: r.blocked_reason || 'Révision bloquée — à examiner',
      linked_id: r.id, linked_label: r.lot_designation || r.property_name,
      action_url: '/loyers?tab=loyers-revision', priority: PRIORITY.needs_confirmation,
    });
  }
  return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.RENT_REVISION, {
    linked_id: r.id, linked_label: r.lot_designation || r.property_name,
  });
}

// ── Clôtures mensuelles ──────────────────────────────────────────────────────
export function evaluateMonthClose(mc, today = new Date()) {
  if (!mc) return null;
  if (mc.status === 'closed') {
    return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.MONTH_CLOSE, {
      reason: 'Mois clôturé', linked_id: mc.id, linked_label: mc.period,
    });
  }
  const y = Number(mc.year); const m = Number(mc.month);
  if (!y || !m) {
    return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.MONTH_CLOSE, {
      linked_id: mc.id, linked_label: mc.period,
    });
  }
  const now = new Date(today);
  const curY = now.getFullYear(); const curM = now.getMonth() + 1;
  const isPast = y < curY || (y === curY && m < curM);
  if (mc.status === 'review') {
    return verdict(EXCEPTION_LEVELS.NEEDS_ACTION, EXCEPTION_DOMAINS.MONTH_CLOSE, {
      reason: `Clôture ${mc.period} à finaliser`,
      linked_id: mc.id, linked_label: mc.period, action_url: '/banque?tab=cloture',
      priority: PRIORITY.a_traiter,
    });
  }
  if (mc.status === 'open' && isPast) {
    return verdict(EXCEPTION_LEVELS.NEEDS_ACTION, EXCEPTION_DOMAINS.MONTH_CLOSE, {
      reason: `Mois ${mc.period} écoulé — à clôturer`,
      linked_id: mc.id, linked_label: mc.period, action_url: '/banque?tab=cloture',
      priority: PRIORITY.a_traiter,
    });
  }
  return verdict(EXCEPTION_LEVELS.AUTO_PROCESS, EXCEPTION_DOMAINS.MONTH_CLOSE, {
    reason: 'Mois en cours ou futur', linked_id: mc.id, linked_label: mc.period,
  });
}

// ── Agrégation ───────────────────────────────────────────────────────────────
export function isException(v) {
  return !!v && (
    v.level === EXCEPTION_LEVELS.NEEDS_CONFIRMATION
    || v.level === EXCEPTION_LEVELS.NEEDS_ACTION
    || v.level === EXCEPTION_LEVELS.ERROR
  );
}

/**
 * Construit la file d'attention : ne conserve QUE les exceptions, triées par
 * priorité (urgent d'abord) puis par date.
 *
 * @param {Array} verdicts  verdicts retournés par les évaluateurs
 * @returns {{ items, count, by_domain, by_level, auto_count }}
 */
export function buildAttentionQueue(verdicts = []) {
  const list = (verdicts || []).filter(Boolean);
  const items = list.filter(isException).sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.date && b.date) return new Date(a.date) - new Date(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });
  const by_domain = {};
  const by_level = {};
  for (const v of items) {
    by_domain[v.domain] = (by_domain[v.domain] || 0) + 1;
    by_level[v.level] = (by_level[v.level] || 0) + 1;
  }
  const auto_count = list.filter((v) => v.level === EXCEPTION_LEVELS.AUTO_PROCESS).length;
  return { items, count: items.length, by_domain, by_level, auto_count };
}