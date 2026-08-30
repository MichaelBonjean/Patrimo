import { parseCsvTable, findField, toNumber, isCafText, parseDate, matchTenantLot } from '../csvUtils';
import { commitTransactions } from '../commit';
import { resolveKey } from '@/lib/financeCategories';

/**
 * Generic bank CSV export (incl. Bankin-style exports): columns date,
 * description, optional category, amount, account.
 */
function parseBank(text) {
  const { headers, rows } = parseCsvTable(text);
  const di = findField(headers, ['date']);
  const desci = findField(headers, ['description', 'libellé', 'libelle', 'opération', 'operation', 'intitulé']);
  const cati = findField(headers, ['catégorie', 'categorie', 'type']);
  const amti = findField(headers, ['montant', 'amount', 'débit', 'crédit', 'valeur']);
  const acci = findField(headers, ['compte', 'account']);
  const notei = findField(headers, ['note']);
  const get = (row, idx) => (idx >= 0 ? row[headers[idx]] || '' : '');
  return rows
    .map((row, i) => ({
      id: i,
      date: get(row, di),
      description: get(row, desci),
      bank_category: get(row, cati),
      amount: toNumber(get(row, amti)),
      account: get(row, acci),
      note: get(row, notei),
    }))
    .filter(r => r.amount !== 0);
}

export const genericBankProcessor = {
  id: 'generic-bank',
  label: 'Relevé bancaire (CSV)',
  acceptFiles: true,
  acceptExtensions: ['csv', 'txt'],

  async detect({ text }) {
    if (!text || isCafText(text)) return 0;
    const { headers, rows } = parseCsvTable(text);
    if (!rows.length) return 0;
    const hasAmount = findField(headers, ['montant', 'amount', 'débit', 'crédit', 'valeur']) >= 0;
    return hasAmount ? 0.85 : 0;
  },

  async parse({ text }) {
    const records = parseBank(text);
    const columns = [
      { key: 'date', label: 'Date' },
      { key: 'description', label: 'Description' },
      { key: 'bank_category', label: 'Cat. banque' },
      { key: 'amount', label: 'Montant', align: 'right', kind: 'amount' },
    ];
    return { records, columns };
  },

  defaultMapping(record, ctx) {
    const desc = (record.description || '').toLowerCase();
    let category = '';
    let propertyId = '';
    let lotId = '';
    const rules = ctx.rules || [];
    const matched = rules
      .filter(r => r.is_active !== false)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0))
      .find(r => r.keyword && desc.includes(r.keyword.toLowerCase()));
    if (matched) {
      category = resolveKey(matched.assigned_category);
      propertyId = matched.assigned_property_id || '';
      lotId = matched.assigned_lot_id || '';
    }
    if (!category || category === 'other') {
      const lot = matchTenantLot(record.description, ctx.lots);
      if (lot) { lotId = lot.id; propertyId = lot.property_id; category = 'rent'; }
    }
    const type = record.amount >= 0 ? 'income' : 'expense';
    const d = parseDate(record.date) || { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
    return { include: !!category, category, propertyId, lotId, type, month: d.month, year: d.year, note: record.description };
  },

  async transform(records, mappings, ctx) {
    const txs = [];
    records.forEach((r, i) => {
      const m = mappings[i] || this.defaultMapping(r, ctx);
      if (!m.include || !m.propertyId || !m.category) return;
      txs.push({
        property_id: m.propertyId,
        lot_id: m.lotId || undefined,
        year: m.year,
        month: m.month,
        category: m.category,
        amount: Math.abs(r.amount),
        type: m.type,
        note: m.note || r.description,
        _bankImport: {
          import_date: r.date,
          description: r.description,
          amount: r.amount,
          bank_category: r.bank_category,
          bank_notes: r.note,
          account: r.account,
          status: 'categorized',
          assigned_property_id: m.propertyId,
          assigned_lot_id: m.lotId || '',
          assigned_category: m.category,
          batch_id: 'wizard-bank-' + Date.now(),
        },
      });
    });
    return txs;
  },

  async commit(transactions, ctx) {
    return commitTransactions(transactions, ctx);
  },
};