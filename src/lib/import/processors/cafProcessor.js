import { parseCsvTable, findField, toNumber, isCafText, guessMonthYear, matchTenantLot } from '../csvUtils';
import { commitTransactions } from '../commit';

function parseCaf(text) {
  const { headers, rows } = parseCsvTable(text);
  const di = findField(headers, ['date']);
  const amti = findField(headers, ['montant', 'amount']);
  const beni = findField(headers, ['bénéficiaire', 'beneficiaire', 'allocataire', 'nom', 'prestation', 'libellé']);
  const peri = findField(headers, ['période', 'periode', 'mois']);
  const get = (row, idx) => (idx >= 0 ? row[headers[idx]] || '' : '');
  return rows
    .map((row, i) => ({
      id: i,
      date: get(row, di),
      beneficiary: get(row, beni),
      amount: toNumber(get(row, amti)),
      period: get(row, peri),
    }))
    .filter(r => r.amount > 0);
}

export const cafProcessor = {
  id: 'caf',
  label: 'Allocations CAF',
  acceptFiles: true,
  acceptExtensions: ['csv', 'txt'],

  async detect({ text }) {
    if (!text) return 0;
    return isCafText(text) ? 0.95 : 0;
  },

  async parse({ text }) {
    const records = parseCaf(text);
    const columns = [
      { key: 'date', label: 'Date' },
      { key: 'beneficiary', label: 'Bénéficiaire' },
      { key: 'amount', label: 'Montant', align: 'right', kind: 'amount' },
      { key: 'period', label: 'Période' },
    ];
    return { records, columns };
  },

  defaultMapping(record, ctx) {
    const lot = matchTenantLot(record.beneficiary, ctx.lots);
    const propertyId = lot ? lot.property_id : '';
    const lotId = lot ? lot.id : '';
    const { month, year } = guessMonthYear(record.period, record.date);
    return { include: !!lotId, category: 'caf', propertyId, lotId, type: 'income', month, year, note: `CAF – ${record.beneficiary}` };
  },

  async transform(records, mappings, ctx) {
    const txs = [];
    records.forEach((r, i) => {
      const m = mappings[i] || this.defaultMapping(r, ctx);
      if (!m.include || !m.propertyId || !m.lotId) return;
      txs.push({
        property_id: m.propertyId,
        lot_id: m.lotId,
        year: m.year,
        month: m.month,
        category: 'caf',
        amount: Math.abs(r.amount),
        type: 'income',
        note: m.note || `CAF – ${r.beneficiary}`,
        _bankImport: {
          import_date: r.date,
          description: `CAF – ${r.beneficiary}`,
          amount: r.amount,
          status: 'categorized',
          assigned_property_id: m.propertyId,
          assigned_lot_id: m.lotId,
          assigned_category: 'caf',
          batch_id: 'wizard-caf-' + Date.now(),
        },
      });
    });
    return txs;
  },

  async commit(transactions, ctx) {
    return commitTransactions(transactions, ctx);
  },
};