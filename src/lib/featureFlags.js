import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { triggerFeatureUnlock } from '@/lib/celebrations';

/**
 * Catalogue des features à déblocage progressif.
 * `unlockText` est affiché dans les tooltips/cadenas.
 * `path` = route de rebond une fois débloqué.
 */
export const FEATURE_FLAGS = {
  simulateur_fiscal: { label: 'Simulateur fiscal', unlockText: 'Accessible dès le départ', path: '/reglages?section=outils' },
  sci_holders: { label: 'Détenteurs & structures', unlockText: 'Débloqué après 2 biens ajoutés', path: '/reglages?section=detenteurs' },
  analyse: { label: 'Analyse patrimoine', unlockText: "Débloqué après 3 biens et 30 jours d'activité", path: '/reglages?section=outils' },
  tenant_portal: { label: 'Portail locataire', unlockText: 'Débloqué après votre 1re quittance générée', path: '/locataires' },
  audit_log: { label: "Journal d'audit", unlockText: 'Disponible en offre Business', path: '/reglages?section=securite' },
  connexion_bancaire: { label: 'Connexion bancaire (Bridge)', unlockText: 'Disponible en offre Business', path: '/banque' },
};

const THRESHOLDS = {
  sci_holders: { minProperties: 2 },
  analyse: { minProperties: 3, minDays: 30 },
};

// Features célébrées au déblocage (simulateur_fiscal n'est jamais célébré : tjrs dispo)
const CELEBRATED = ['sci_holders', 'analyse', 'tenant_portal', 'audit_log', 'connexion_bancaire'];

export function isBusinessPlan(user) {
  return (user?.data?.plan || user?.plan) === 'business';
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

/**
 * Calcule l'état de déblocage de chaque feature à partir d'un contexte.
 * @param {{user?:object, propertiesCount?:number, hasQuittance?:boolean, accountDays?:number}} ctx
 * @returns {Record<string,{unlocked:boolean, reason:string|null, label:string, unlockText:string, path:string}>}
 */
export function computeFeatureUnlocks(ctx = {}) {
  const { user, propertiesCount = 0, hasQuittance = false, accountDays = 0 } = ctx;
  const business = isBusinessPlan(user);
  const t = THRESHOLDS;

  const base = {
    simulateur_fiscal: { unlocked: true, reason: null },
    sci_holders: {
      unlocked: propertiesCount >= t.sci_holders.minProperties,
      reason: propertiesCount >= t.sci_holders.minProperties ? null : `Ajoutez encore ${t.sci_holders.minProperties - propertiesCount} bien(s)`,
    },
    analyse: {
      unlocked: propertiesCount >= t.analyse.minProperties && accountDays >= t.analyse.minDays,
      reason:
        propertiesCount >= t.analyse.minProperties && accountDays >= t.analyse.minDays
          ? null
          : `Encore ${Math.max(0, t.analyse.minProperties - propertiesCount)} bien(s) et ${Math.max(0, t.analyse.minDays - accountDays)} j d'activité`,
    },
    tenant_portal: { unlocked: hasQuittance, reason: hasQuittance ? null : 'Générez votre 1re quittance' },
    audit_log: { unlocked: business, reason: business ? null : 'Offre Business requise' },
    connexion_bancaire: { unlocked: business, reason: business ? null : 'Offre Business requise' },
  };

  for (const k of Object.keys(base)) {
    base[k] = { ...base[k], ...FEATURE_FLAGS[k] };
  }
  return base;
}

/**
 * API demandée : isFeatureUnlocked(user, feature).
 * Pour les features à seuil, passer un 3e arg `ctx` ({propertiesCount, hasQuittance, accountDays}).
 * Sans ctx, les features à seuil renvoient `false` par sécurité.
 */
export function isFeatureUnlocked(user, feature, ctx = {}) {
  const map = computeFeatureUnlocks({ user, ...ctx });
  const f = map[feature];
  return !!(f && f.unlocked);
}

/**
 * Hook React : charge les données nécessaires et expose l'état de déblocage.
 */
export function useFeatureFlags() {
  const { data: user } = useQuery({ queryKey: ['me'], queryFn: () => base44.auth.me(), staleTime: 60000 });
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: () => base44.entities.Property.list('-updated_date', 200),
    staleTime: 30000,
  });
  const { data: quittances = [] } = useQuery({
    queryKey: ['quittances-exists'],
    queryFn: () => base44.entities.Quittance.list('-created_date', 1),
    staleTime: 30000,
  });

  const propertiesCount = (properties || []).length;
  const hasQuittance = (quittances || []).length > 0;
  const accountDays = daysSince(user?.created_date);

  const flags = computeFeatureUnlocks({ user, propertiesCount, hasQuittance, accountDays });
  const isUnlocked = (f) => !!(flags[f] && flags[f].unlocked);
  return { flags, isUnlocked, user, propertiesCount, hasQuittance, accountDays };
}

/**
 * Hook à poser au plus haut niveau (AppLayout) : déclenche la célébration
 * "feature déverrouillée" une seule fois par feature/porteur lorsque le seuil est atteint.
 */
export function useFeatureUnlockChecker() {
  const { flags, user } = useFeatureFlags();
  const unlockedKeys = Object.entries(flags).filter(([, v]) => v.unlocked).map(([k]) => k);
  const signature = unlockedKeys.join(',');
  useEffect(() => {
    if (!user) return;
    for (const feat of unlockedKeys) {
      if (!CELEBRATED.includes(feat)) continue;
      // Dedup assuré côté celebrations (UserMilestone + garde-fou session)
      triggerFeatureUnlock(feat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, signature]);
}