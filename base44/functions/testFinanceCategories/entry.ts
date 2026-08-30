import {
  FINANCE_CATEGORIES,
  CATEGORY_BY_KEY,
  CATEGORY_BY_LABEL,
  LEGACY_ALIASES,
  resolveKey,
  labelOf,
  directionOf,
  activeKeys,
  OTHER_KEY,
} from '../../shared/financeCategories.ts';
import { treatmentOf, buildEstimate } from '../../shared/taxEngine.ts';

/**
 * Tests de cohérence du catalogue canonique de catégories financières.
 *
 * Garantit nott. qu'aucune catégorie présentée par l'UI n'est refusée par le
 * backend : chaque clé active est reconnue du moteur fiscal, a un sens, un
 * groupe cashflow et un libellé ; tous les alias historiques se résolvent en
 * une clé connue (jamais le fallback) ; le fallback 'other' préserve l'original.
 */
export default async function (_req: Request): Promise<Response> {
  const errors: string[] = [];

  // 1) Cohérence interne du catalogue
  for (const c of FINANCE_CATEGORIES) {
    if (c.id !== c.key) errors.push(`id≠key sur ${c.key}`);
    if (CATEGORY_BY_KEY[c.key]?.key !== c.key) errors.push(`CATEGORY_BY_KEY manquant: ${c.key}`);
    if (CATEGORY_BY_LABEL[c.label]?.key !== c.key) errors.push(`CATEGORY_BY_LABEL manquant: ${c.label}`);
    if (!['income', 'expense'].includes(c.direction)) errors.push(`direction invalide: ${c.key}`);
    if (!c.tax_group) errors.push(`tax_group manquant: ${c.key}`);
    if (!c.cashflow_group) errors.push(`cashflow_group manquant: ${c.key}`);
  }

  // 2) Pas de doublon de clé ni de libellé
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const c of FINANCE_CATEGORIES) {
    if (keys.has(c.key)) errors.push(`clé dupliquée: ${c.key}`);
    if (labels.has(c.label)) errors.push(`libellé dupliqué: ${c.label}`);
    keys.add(c.key); labels.add(c.label);
  }

  // 3) Round-trip label -> key -> label pour chaque catégorie active
  for (const c of FINANCE_CATEGORIES.filter((x) => x.active)) {
    const k = resolveKey(c.label);
    if (k !== c.key) errors.push(`resolveKey(label) ≠ key : '${c.label}' -> '${k}' (attendu '${c.key}')`);
    const lbl = labelOf(c.key);
    if (lbl !== c.label) errors.push(`labelOf(key) ≠ label : '${c.key}' -> '${lbl}' (attendu '${c.label}')`);
  }

  // 4) Tous les alias historiques se résolvent en une clé connue (pas le fallback)
  for (const [alias, expectedKey] of Object.entries(LEGACY_ALIASES)) {
    const k = resolveKey(alias);
    if (k !== expectedKey) errors.push(`alias '${alias}' -> '${k}' (attendu '${expectedKey}')`);
    if (k === OTHER_KEY) errors.push(`alias '${alias}' retombe sur le fallback 'other'`);
  }

  // 5) Chaque alias historique renvoie vers une clé active du catalogue
  for (const alias of Object.keys(LEGACY_ALIASES)) {
    const k = resolveKey(alias);
    const cat = CATEGORY_BY_KEY[k];
    if (!cat) errors.push(`alias '${alias}' -> clé inconnue '${k}'`);
    if (cat && !cat.active && k !== OTHER_KEY) errors.push(`alias '${alias}' -> catégorie inactive '${k}'`);
  }

  // 6) Replay des clés actives EXACTEMENT celles exposées par l'UI
  const incomeKeys = activeKeys('income');
  const expenseKeys = activeKeys('expense');
  for (const k of [...incomeKeys, ...expenseKeys]) {
    if (!CATEGORY_BY_KEY[k]) errors.push(`clé UI inconnue du backend: ${k}`);
    if (resolveKey(k) !== k) errors.push(`resolveKey(key) ≠ key : ${k}`);
  }

  // 7) Un traitement fiscal est défini pour CHAQUE clé active (l'UI ne peut pas
  //    produire une catégorie que le backend refuserait / non comptée par sécurité)
  for (const k of [...incomeKeys, ...expenseKeys]) {
    const tr = treatmentOf(k);
    if (!tr.kind) errors.push(`treatmentOf(${k}) sans genre`);
    if (!tr.reason) errors.push(`treatmentOf(${k}) sans raison`);
    // coherent direction
    const d = directionOf(k);
    if (incomeKeys.includes(k) && d !== 'income') errors.push(`direction incohérente (income): ${k}`);
    if (expenseKeys.includes(k) && d !== 'expense') errors.push(`direction incohérente (expense): ${k}`);
  }

  // 8) buildEstimate ne lève pas pour une transaction portant chaque clé active
  //    (simule l'acceptation par le backend d'une transaction issue de l'UI)
  const property = {
    name: 'Bien test', tax_regime: 'Location nue (revenus fonciers)',
    loan_amount: 100000, loan_rate: 1.5, loan_duration_years: 20, loan_start_date: '2022-01-01',
  };
  for (const k of [...incomeKeys, ...expenseKeys]) {
    try {
      const tx = { category: k, amount: 100, type: directionOf(k) === 'income' ? 'income' : 'expense' };
      const e = buildEstimate({ property, transactions: [tx], year: 2025 });
      if (!e || typeof e.taxableBase !== 'number') errors.push(`buildEstimate invalide pour clé ${k}`);
    } catch (err) {
      errors.push(`buildEstime lève pour la clé ${k}: ${err.message}`);
    }
  }

  // 9) Fallback 'other' préserve le libellé original
  const ko = resolveKey('TaratorInconnu');
  if (ko !== OTHER_KEY) errors.push(`fallback attendu '${OTHER_KEY}', obtenu '${ko}'`);
  if (labelOf('TaratorInconnu') !== 'TaratorInconnu') errors.push(`labelOf('TaratorInconnu') doit préserver l'original`);

  return Response.json({
    ok: errors.length === 0,
    total: errors.length + 9 + 8 + FINANCE_CATEGORIES.length + Object.keys(LEGACY_ALIASES).length * 2 + incomeKeys.length + expenseKeys.length + (incomeKeys.length + expenseKeys.length) * 2,
    categories: FINANCE_CATEGORIES.length,
    active_categories: FINANCE_CATEGORIES.filter((c) => c.active).length,
    aliases: Object.keys(LEGACY_ALIASES).length,
    income_keys: incomeKeys.length,
    expense_keys: expenseKeys.length,
    errors,
  });
}