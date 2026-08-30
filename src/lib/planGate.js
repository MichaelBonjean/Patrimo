// planGate — contrôle d'accès par plan d'abonnement.
//
// Plans (cf. spec) :
//  - starter : 1 bien max, pas de quittances/révisions/outils avancés
//  - pro      : 5 biens max + quittances + révisions de loyer
//  - business: illimité + partage comptable + connexion bancaire
//
// Essai inscription : 14 jours SANS CB → accès business complet jusqu'à
// trial_ends_at (ou created_date + 14j si non renseigné).
// Pendant past_due / canceled : on garde le plan courant (grace / fin de période).

export const PLAN_LIMITS = {
  starter: { maxProperties: 1, features: [] },
  pro: { maxProperties: 5, features: ['quittances', 'rent_revisions'] },
  business: { maxProperties: Infinity, features: ['quittances', 'rent_revisions', 'accountant_sharing', 'bank_connection'] },
};

export const PLAN_LABELS = {
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
};

export const PLAN_ORDER = ['starter', 'pro', 'business'];

const DAY_MS = 86400000;
const TRIAL_DAYS = 14;

// Plan effectif en tenant compte de l'essai inscription et des statuts intermédiaires.
export function getEffectivePlan(user) {
  if (!user) return 'starter';
  const status = user.subscription_status || 'none';
  const plan = user.plan || 'starter';

  // Abonnement actif ou en essai Stripe → le plan enregistré s'applique.
  if (status === 'active' || status === 'trialing') return plan;

  // past_due : on conserve l'accès au plan courant jusqu'au downgrade (7j).
  if (status === 'past_due') return plan;

  // canceled : on garde l'accès jusqu'à la fin de la période payée.
  if (status === 'canceled') return plan;

  // Aucun abonnement actif → essai d'inscription (14j) si encore valide.
  const trialEndMs = user.trial_ends_at
    ? new Date(user.trial_ends_at).getTime()
    : user.created_date
      ? new Date(user.created_date).getTime() + TRIAL_DAYS * DAY_MS
      : 0;
  if (Date.now() < trialEndMs) return 'business';

  return 'starter';
}

export function canUseFeature(user, feature) {
  const plan = getEffectivePlan(user);
  return (PLAN_LIMITS[plan]?.features || []).includes(feature);
}

export function getPropertyLimit(user) {
  const plan = getEffectivePlan(user);
  return PLAN_LIMITS[plan]?.maxProperties ?? 1;
}

export function canAddProperty(user, currentCount = 0) {
  const limit = getPropertyLimit(user);
  return currentCount < limit;
}

// Jours restants de l'essai inscription (ou 0 si hors essai).
export function trialDaysLeft(user) {
  if (!user) return 0;
  const status = user.subscription_status || 'none';
  if (status === 'active' || status === 'trialing' || status === 'past_due' || status === 'canceled') return 0;
  const trialEndMs = user.trial_ends_at
    ? new Date(user.trial_ends_at).getTime()
    : user.created_date
      ? new Date(user.created_date).getTime() + TRIAL_DAYS * DAY_MS
      : 0;
  if (!trialEndMs || Date.now() >= trialEndMs) return 0;
  return Math.ceil((trialEndMs - Date.now()) / DAY_MS);
}