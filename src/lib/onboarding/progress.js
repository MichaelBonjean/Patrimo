// Calcule la progression d'onboarding et les actions restantes importantes.

const CHECKS = [
  { key: 'patrimoine', label: 'Créer mon patrimoine', weight: 20, step: 0, cta: 'Créer mon premier bien' },
  { key: 'lots', label: 'Importer mes lots', weight: 20, step: 2, cta: 'Importer mes lots' },
  { key: 'pret', label: 'Ajouter mes prêts', weight: 10, step: 3, cta: 'Renseigner mes prêts' },
  { key: 'baux', label: 'Ajouter les baux / locataires', weight: 20, step: 4, cta: 'Importer les baux' },
  { key: 'transactions', label: 'Importer les transactions', weight: 25, step: 5, cta: 'Importer les transactions' },
  { key: 'rapprochements', label: 'Vérifier les rapprochements', weight: 5, step: 6, cta: 'Vérifier les rapprochements' },
];

export function computeOnboardingProgress({ properties = [], lots = [], leases = [], transactions = [], hasLoan = false } = {}) {
  const state = {
    patrimoine: properties.length > 0,
    lots: lots.length > 0,
    pret: hasLoan,
    baux: leases.length > 0,
    transactions: transactions.length > 0,
    rapprochements: transactions.length > 0,
  };
  const checks = CHECKS.map((c) => ({ ...c, done: !!state[c.key] }));
  const doneWeight = checks.filter((c) => c.done).reduce((s, c) => s + c.weight, 0);
  const percent = Math.min(100, Math.round(doneWeight));
  const remaining = checks.filter((c) => !c.done);
  const completedCount = checks.filter((c) => c.done).length;
  return { percent, checks, remaining, completedCount, total: checks.length };
}