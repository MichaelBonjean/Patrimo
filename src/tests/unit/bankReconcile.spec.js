import { describe, it, expect } from 'vitest';
import {
  reconcileBankTransaction,
  matchRent,
  matchLoan,
  detectInternalTransfer,
  applyRules,
  computeRealCashflow,
  aggregateReconcile,
  suggestRuleFromProposal,
  normalizeDescription,
  levelFromConfidence,
} from '@/lib/bankReconcileEngine';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const BT = (overrides = {}) => ({
  id: 'bt1',
  account_id: 'cic_sci',
  date: '2026-08-05',
  amount: 750,
  raw_description: 'VIR DUPONT JEAN',
  normalized_description: normalizeDescription('VIR DUPONT JEAN'),
  owner_id: 'owner.a@patrimo.fr',
  status: 'pending',
  ...overrides,
});

const LEASE_DUPONT = {
  id: 'lease1', property_id: 'p_irigny', lot_id: 'lot_t3',
  tenants: [{ id: 'tn1', name: 'Jean Dupont', entry_date: '2024-01-01' }],
  rent_excluding_charges: 720, charges: 30,
};

const RD_OPEN = (amount = 750, status = 'unpaid', overrides = {}) => ({
  id: 'rd1', lease_id: 'lease1', property_id: 'p_irigny', lot_id: 'lot_t3',
  year: 2026, month: 8, period: '2026-08', due_date: '2026-08-05',
  rent_excluding_charges: 720, charges: 30, additional_amount: 0,
  total_due: amount, paid_amount: 0, balance: amount, status,
  tenant_name: 'Jean Dupont',
  ...overrides,
});

const HUMAN_ACCOUNT = (o = {}) => ({
  id: 'acct_perso', account_name: 'BoursoBank perso', bank_name: 'BoursoBank',
  account_masked_id: 'boursoperso', holder_id: 'h_michael', active: true, ...o,
});
const SCI_ACCOUNT = (o = {}) => ({
  id: 'acct_cic', account_name: 'CIC SCI Irigny', bank_name: 'CIC',
  account_masked_id: 'cic_sci', holder_id: 'h_sci_irigny', active: true, ...o,
});
const SCI_HOLDER = { id: 'h_sci_irigny', name: 'SCI DUPONT IMMOBILIER', type: 'SCI' };
const PHYS_HOLDER = { id: 'h_michael', name: 'Michael Dupont', type: 'Personne physique' };

const baseCtx = (extras = {}) => ({
  account: SCI_ACCOUNT(),
  accounts: [SCI_ACCOUNT(), HUMAN_ACCOUNT()],
  leases: [LEASE_DUPONT],
  rent_dues: [RD_OPEN(750)],
  loans: [],
  rules: [],
  holders: [SCI_HOLDER, PHYS_HOLDER],
  transfert_pool: [],
  ...extras,
});

describe('Moteur bancaire — détection de loyer (RentDue)', () => {
  it('1. loyer exact identifié → rent_income automatique + Payment', () => {
    const p = reconcileBankTransaction(BT(), baseCtx());
    expect(p.type).toBe('rent_income');
    expect(p.level).toBe('automatic');
    expect(p.payment_patch.lease_id).toBe('lease1');
    expect(p.payment_patch.rent_due_id).toBe('rd1');
    expect(p.payment_patch.amount).toBe(750);
    expect(p.payment_patch.payer_type).toBe('tenant');
    expect(p.payment_patch.allocations[0].amount).toBe(750);
  });

  it('2. loyer partiel (montant < attendu) → proposé, allocation partielle', () => {
    const p = reconcileBankTransaction(BT({ amount: 500 }), baseCtx({ rent_dues: [RD_OPEN(750)] }));
    expect(p.type).toBe('rent_income');
    expect(p.level).toBe('proposed');
    expect(p.payment_patch.allocations[0].amount).toBe(500);
    expect(p.payment_patch.unallocated).toBe(0);
  });

  it('3. loyer supérieur (montant > attendu) → proposé, unpllocated = surplus', () => {
    const p = reconcileBankTransaction(BT({ amount: 820 }), baseCtx({ rent_dues: [RD_OPEN(750)] }));
    expect(p.type).toBe('rent_income');
    expect(p.level).toBe('proposed');
    expect(p.payment_patch.allocations[0].amount).toBe(750);
    expect(p.payment_patch.unallocated).toBe(70);
  });

  it('4. CAF + locataire → payer_type = caf', () => {
    const p = reconcileBankTransaction(BT({ raw_description: 'VIR CAF APL DUPONT JEAN' }), baseCtx({ rent_dues: [RD_OPEN(750)] }));
    expect(p.payment_patch.payer_type).toBe('caf');
  });

  it('5. deux locataires avec même montant et même prénom → ambiguïté (ex æquo), proposé', () => {
    const lease2 = { ...LEASE_DUPONT, id: 'lease2', lot_id: 'lot_t2', property_id: 'p_firminy', tenants: [{ name: 'Jean Martin' }] };
    const rd2 = RD_OPEN(750, 'unpaid', { id: 'rd2', lease_id: 'lease2', property_id: 'p_firminy', lot_id: 'lot_t2', tenant_name: 'Jean Martin' });
    const p = reconcileBankTransaction(BT({ raw_description: 'VIR JEAN' }), baseCtx({ leases: [LEASE_DUPONT, lease2], rent_dues: [RD_OPEN(750), rd2] }));
    expect(p.type).toBe('rent_income');
    expect(p.level).not.toBe('automatic');
    expect(p.rent_due_id).toBeTruthy();
  });

  it('32. aucun faux rapprochement si description sans lien locataire', () => {
    const p = reconcileBankTransaction(BT({ raw_description: 'VIR REMBOURSEMENT UNESCO', amount: 750 }), baseCtx());
    expect(p.type).not.toBe('rent_income');
  });
});

describe('Moteur bancaire — échéances de prêt (Loan)', () => {
  const loans = [{ id: 'loan1', property_id: 'p_irigny', monthly_payment: 1020, holder_id: 'h_sci_irigny' }];

  it('11. échéance conforme → automatic + conforme true', () => {
    const p = reconcileBankTransaction(BT({ amount: -1020, raw_description: 'CIC PRET IMMO' }), baseCtx({ loans }));
    expect(p.type).toBe('loan_installment');
    expect(p.level).toBe('automatic');
    expect(p.loan_id).toBe('loan1');
    expect(p.reason).toContain('conforme');
  });

  it('écart détecté > tolérance → proposé + note d écart', () => {
    const p = reconcileBankTransaction(BT({ amount: -1032, raw_description: 'CIC PRET IMMO' }), baseCtx({ loans }));
    expect(p.type).toBe('loan_installment');
    expect(p.level).toBe('proposed');
    expect(p.reason).toContain('cart');
  });

  it('libellé non rélié et montant très éloigné → pas rapproché', () => {
    const p = reconcileBankTransaction(BT({ amount: -1500, raw_description: 'CIC PRET IMMO' }), baseCtx({ loans }));
    expect(p.type).not.toBe('loan_installment');
  });
});

describe('Moteur bancaire — virements internes', () => {
  it('13. virement interne détecté (sens inverse, montant égal, comptes distincts) → internal_transfer', () => {
    const out = BT({ account_id: 'boursoperso', amount: -2000, raw_description: 'VIR VERS SCI' });
    const inn = BT({ id: 'bt2', account_id: 'cic_sci', amount: 2000, raw_description: 'VIR DE MICHEL', date: '2026-08-05' });
    const p = reconcileBankTransaction(out, baseCtx({ account: HUMAN_ACCOUNT(), transfert_pool: [inn] }));
    expect(p.type).toBe('internal_transfer');
  });
});

describe('Moteur bancaire — dépenses & affectation', () => {
  it('7. comptable SCI → structure_expense, jamais attribué à un logement', () => {
    const p = reconcileBankTransaction(BT({ amount: -600, raw_description: 'HONORAIRE CABINET COMPTABLE X' }), baseCtx({ rent_dues: [] }));
    expect(p.type).toBe('structure_expense');
    expect(p.transaction_patch.category).toBe('accounting_fees');
    expect(p.transaction_patch.lot_id).toBe(null);
  });

  it('9. assurance PNO → property_insurance (exploitation)', () => {
    const p = reconcileBankTransaction(BT({ amount: -180, raw_description: 'AXA ASSURANCE PNO' }), baseCtx({ rent_dues: [] }));
    expect(p.transaction_patch.category).toBe('property_insurance');
  });

  it('10. taxe foncière → property_tax', () => {
    const p = reconcileBankTransaction(BT({ amount: -480, raw_description: 'TAXE FONCIERE DGFIP' }), baseCtx({ rent_dues: [] }));
    expect(p.transaction_patch.category).toBe('property_tax');
  });

  it('6. dépense sur compte dédié bien (property_id) → property_expense', () => {
    const acct = SCI_ACCOUNT({ property_id: 'p_irigny' });
    const p = reconcileBankTransaction(BT({ amount: -320, raw_description: 'TRAVAUX PEINTURE LEROY MERLIN' }), baseCtx({ account: acct, rent_dues: [] }));
    expect(p.transaction_patch.category).toBe('supplies');
    expect(p.type).toBe('property_expense');
  });

  it('plusieurs sociétés : affectation présomptive par le compte', () => {
    const sci2 = { id: 'h_sci_bonjean', name: 'SCI BONJEAN 2', type: 'SCI' };
    const acct2 = { id: 'acct_bj', account_name: 'CIC SCI Bonjean', account_masked_id: 'cic_bj', holder_id: 'h_sci_bonjean', active: true };
    const p = reconcileBankTransaction(BT({ account_id: 'cic_bj', amount: -600, raw_description: 'CABINET COMPTABLE Y' }), baseCtx({ accounts: [acct2], account: acct2, holders: [SCI_HOLDER, sci2, PHYS_HOLDER], rent_dues: [] }));
    expect(p.type).toBe('structure_expense');
    expect(p.transaction_patch.category).toBe('accounting_fees');
  });
});

describe('Moteur bancaire — ambiguïté & exceptions', () => {
  it('14. transaction ambiguë (aucun indice) → to_identify', () => {
    const p = reconcileBankTransaction(BT({ amount: -99, raw_description: 'PRELEV INCONNU XYZ' }), baseCtx({ rent_dues: [] }));
    expect(p.level).toBe('to_identify');
    expect(p.type).toBe('unknown');
  });

  it('22. validation groupée : exceptions seulement (EXCEPTION ONLY)', () => {
    const props = [
      { level: 'automatic' }, { level: 'automatic' },
      { level: 'proposed' }, { level: 'to_identify' },
    ];
    const agg = aggregateReconcile(props);
    expect(agg.total).toBe(4);
    expect(agg.automatic_count).toBe(2);
    expect(agg.exceptions).toHaveLength(2);
    expect(agg.exceptions.every((e) => e.level !== 'automatic')).toBe(true);
  });
});

describe('Moteur bancaire — apprentissage & règles', () => {
  it('17. une BankRule active est appliquée en priorité', () => {
    const rule = { id: 'r1', keyword: 'dupont jean', assigned_category: 'rent', assigned_property_id: 'p_irigny', assigned_lot_id: 'lot_t3', is_active: true, priority: 10 };
    const p = reconcileBankTransaction(BT({ amount: 750 }), baseCtx({ rules: [rule], rent_dues: [] }));
    expect(p.rule_id).toBe('r1');
    expect(p.transaction_patch.category).toBe('rent');
    expect(p.level).toBe('proposed');
  });

  it('16. suggestRuleFromProposal propose une règle à mémoriser (jamais trop générique)', () => {
    const p = reconcileBankTransaction(BT({ amount: -600, raw_description: 'CABINET COMPTABLE BONJEAN' }), baseCtx({ rent_dues: [] }));
    const suggestion = suggestRuleFromProposal(p, BT({ amount: -600, raw_description: 'CABINET COMPTABLE BONJEAN' }));
    expect(suggestion).toBeTruthy();
    expect(suggestion.keyword.length).toBeGreaterThanOrEqual(4);
    expect(suggestion.assigned_category).toBe('accounting_fees');
  });
});

describe('Moteur bancaire — cash-flow réel', () => {
  it('22. cash-flow réel consolidé exclusive les virements internes', () => {
    const txs = [
      { category: 'rent', type: 'income', amount: 750 },
      { category: 'rent', type: 'income', amount: 720 },
      { category: 'condo_fees', type: 'expense', amount: -210 },
      { category: 'loan_installment', type: 'expense', amount: -1020 },
      { category: 'internal_transfer', type: 'expense', amount: -2000 },
      { category: 'internal_transfer', type: 'income', amount: 2000 },
    ];
    const cf = computeRealCashflow(txs);
    expect(cf.operating_income).toBe(1470);
    expect(cf.operating_expense).toBe(210);
    expect(cf.debt_service).toBe(1020);
    // internal_transfer buckets excluded → net = 1470 - 210 - 1020 = 240
    expect(cf.net).toBe(240);
  });
});

describe('Moteur bancaire — pureté & isolation', () => {
  it('le moteur ne rapproche jamais un RentDue non fourni dans le contexte', () => {
    const p = reconcileBankTransaction(BT(), baseCtx({ rent_dues: [] }));
    expect(p.type).not.toBe('rent_income');
  });

  it('levelFromConfidence : seuils exacts', () => {
    expect(levelFromConfidence(0.92)).toBe('automatic');
    expect(levelFromConfidence(0.7)).toBe('proposed');
    expect(levelFromConfidence(0.4)).toBe('to_identify');
  });
});