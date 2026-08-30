import confetti from 'canvas-confetti';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';

// Palette Patrimo (marine + or + accents)
const PALETTE = ['#16305C', '#E8B23A', '#22c55e', '#0ea5e9'];

// Garde-fou anti double-déclenchement dans la même session
const _firedInSession = new Set();

// Navigateur SPA injectable (sinon fallback full-reload)
let _navigate = (url) => {
  if (url.startsWith('/')) window.location.assign(url);
  else window.location.assign(url);
};
export function setMilestoneNavigator(fn) {
  _navigate = typeof fn === 'function' ? fn : _navigate;
}

// Cache email utilisateur
let _userEmail = null;
async function getUserEmail() {
  if (_userEmail) return _userEmail;
  try {
    const me = await base44.auth.me();
    _userEmail = me?.email || null;
  } catch {
    _userEmail = null;
  }
  return _userEmail;
}

const MILESTONES = {
  first_property_added: {
    message: "Bravo, votre 1er bien est en ligne !",
    emoji: "🏠",
    action: { label: "Voir mon bien", url: "/biens" },
    confetti: (fire) =>
      fire({ particleCount: 90, spread: 75, origin: { y: 0.6 }, colors: PALETTE }),
  },
  first_import: {
    message: "Un import réussi, économisez déjà des heures !",
    emoji: "📥",
    action: { label: "Voir mes encaissements", url: "/loyers" },
    confetti: (fire) =>
      fire({ particleCount: 60, spread: 60, origin: { y: 0.6 }, colors: PALETTE }),
  },
  first_quittance: {
    message: "Votre 1re quittance est générée. Le fisc adore ça.",
    emoji: "🧾",
    action: { label: "Envoyer la quittance au locataire", url: "/loyers?tab=quittances" },
    confetti: (fire) =>
      fire({ particleCount: 70, spread: 70, origin: { y: 0.6 }, colors: ['#E8B23A', '#16305C', '#ffffff'] }),
  },
  first_impaye_resolved: {
    message: "Un impayé résolu, un souci en moins.",
    emoji: "✅",
    action: { label: "Voir les impayés", url: "/loyers?tab=impayes" },
    confetti: (fire) =>
      fire({ particleCount: 60, spread: 65, origin: { y: 0.6 }, colors: ['#22c55e', '#16305C', '#E8B23A'] }),
  },
  first_month_closed: {
    message: "Mois clôturé. Prêt pour le prochain !",
    emoji: "📅",
    action: { label: "Aller à la banque", url: "/banque?tab=cloture" },
    confetti: (fire) =>
      fire({ particleCount: 55, spread: 60, origin: { y: 0.6 }, colors: ['#0ea5e9', '#16305C', '#E8B23A'] }),
  },
  '5_properties': {
    message: "5 biens gérés, vous êtes un pro !",
    emoji: "🏆",
    action: { label: "Voir mes rendements", url: "/reglages?section=outils" },
    confetti: (fire) => {
      fire({ particleCount: 100, spread: 80, origin: { y: 0.6 }, colors: PALETTE });
      setTimeout(() => fire({ particleCount: 60, spread: 100, origin: { y: 0.5 }, colors: PALETTE }), 240);
    },
  },
  '12_months_active': {
    message: "1 an de Patrimo. Merci pour votre confiance !",
    emoji: "🎂",
    action: { label: "Exporter mon bilan", url: "/" },
    confetti: (fire) => {
      const end = Date.now() + 1200;
      const tick = () => {
        fire({ particleCount: 40, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors: PALETTE });
        fire({ particleCount: 40, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors: PALETTE });
        if (Date.now() < end) requestAnimationFrame(tick);
      };
      tick();
    },
  },
  'first_ai_import': {
    message: "Votre 1er document importé par l'IA !",
    emoji: "📄",
    action: { label: "Valider l'import IA", url: "/reglages?section=documents" },
    confetti: (fire) => fire({ particleCount: 80, spread: 75, origin: { y: 0.6 }, colors: PALETTE }),
  },
  'feature_sci_holders': {
    message: "Nouvelle fonctionnalité déverrouillée : Détenteurs & structures !",
    emoji: "🎊",
    action: { label: "Configurer mes détenteurs", url: "/reglages?section=detenteurs" },
    confetti: (fire) => fire({ particleCount: 70, spread: 70, origin: { y: 0.6 }, colors: PALETTE }),
  },
  'feature_analyse': {
    message: "Nouvelle fonctionnalité déverrouillée : Analyse patrimoine !",
    emoji: "🎊",
    action: { label: "Voir l'analyse", url: "/reglages?section=outils" },
    confetti: (fire) => fire({ particleCount: 70, spread: 70, origin: { y: 0.6 }, colors: PALETTE }),
  },
  'feature_tenant_portal': {
    message: "Nouvelle fonctionnalité déverrouillée : Portail locataire !",
    emoji: "🎊",
    action: { label: "Inviter un locataire", url: "/locataires" },
    confetti: (fire) => fire({ particleCount: 70, spread: 70, origin: { y: 0.6 }, colors: PALETTE }),
  },
  'feature_audit_log': {
    message: "Nouvelle fonctionnalité déverrouillée : Journal d'audit !",
    emoji: "🎊",
    action: { label: "Voir le journal", url: "/reglages?section=securite" },
    confetti: (fire) => fire({ particleCount: 70, spread: 70, origin: { y: 0.6 }, colors: PALETTE }),
  },
  'feature_connexion_bancaire': {
    message: "Nouvelle fonctionnalité déverrouillée : Connexion bancaire (Bridge) !",
    emoji: "🎊",
    action: { label: "Connecter ma banque", url: "/banque" },
    confetti: (fire) => fire({ particleCount: 70, spread: 70, origin: { y: 0.6 }, colors: PALETTE }),
  },
};

/**
 * Déclenche un milestone de célébration (confetti + toast Sonner), UNE seule fois par utilisateur.
 * L'existence d'un enregistrement UserMilestone pour ce kind + user verrouille tout redéclenchement.
 * @param {string} kind - identifiant du milestone
 * @returns {Promise<boolean>} true si la célébration a eu lieu ce coup-ci, false sinon.
 */
export async function triggerMilestone(kind) {
  const cfg = MILESTONES[kind];
  if (!cfg) return false;
  if (_firedInSession.has(kind)) return false;

  // Vérification serveur : déjà célébré par ce user ?
  try {
    const existing = await base44.entities.UserMilestone.filter({ kind }, '-first_time_at', 1);
    if (existing && existing.length > 0) {
      _firedInSession.add(kind);
      return false;
    }
  } catch {
    // En cas d'erreur de lecture, on continue (célébration non bloquée) mais le garde-fou session reste.
  }

  // Journalisation (entité)
  try {
    const email = await getUserEmail();
    await base44.entities.UserMilestone.create({
      kind,
      first_time_at: new Date().toISOString(),
      owner_id: email || undefined,
    });
  } catch {
    // Échec de persistance : on célèbre quand même cette session, sans garantie de non-répétition cross-session.
  }

  _firedInSession.add(kind);

  // Confetti
  try {
    cfg.confetti(confetti);
  } catch {
    /* noop */
  }

  // Analytics
  try {
    base44.analytics.track({ eventName: 'milestone_reached', properties: { kind } });
  } catch {
    /* noop */
  }

  // Toast Sonner avec action de rebond
  toast.success(`${cfg.emoji} ${cfg.message}`, {
    duration: 7000,
    action: cfg.action
      ? { label: cfg.action.label, onClick: () => _navigate(cfg.action.url) }
      : undefined,
  });

  return true;
}

/**
 * Déclenche la célébration "feature déverrouillée" (une seule fois par utilisateur).
 * @param {string} feature - identifiant de feature (ex: 'sci_holders')
 */
export async function triggerFeatureUnlock(feature) {
  const key = `feature_${feature}`;
  if (!MILESTONES[key]) return false;
  return triggerMilestone(key);
}

export { MILESTONES };