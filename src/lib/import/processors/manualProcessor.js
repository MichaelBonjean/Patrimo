import { commitTransactions } from '../commit';

/**
 * Manual single entry — no file. The wizard renders a dedicated form whose
 * output becomes the single record passed to parse().
 */
export const manualProcessor = {
  id: 'manual',
  label: 'Saisie manuelle',
  acceptFiles: false,
  acceptExtensions: [],

  async detect() { return 0; },

  async parse({ record }) {
    return {
      records: [record],
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Montant', align: 'right', kind: 'amount' },
        { key: 'category', label: 'Catégorie' },
      ],
    };
  },

  defaultMapping(record) {
    const d = new Date(record.date);
    return {
      include: true,
      category: record.category,
      propertyId: record.property_id,
      lotId: record.lot_id,
      type: record.type,
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      note: record.description,
    };
  },

  async transform(records, mappings) {
    const m = mappings[0] || this.defaultMapping(records[0]);
    if (!m.include || !m.propertyId || !m.category) return [];
    const amt = Math.abs(Number(records[0].amount) || 0);
    return [{
      property_id: m.propertyId,
      lot_id: m.lotId || undefined,
      year: m.year,
      month: m.month,
      category: m.category,
      amount: amt,
      type: m.type,
      note: m.note,
      _bankImport: {
        import_date: records[0].date,
        description: records[0].description,
        amount: m.type === 'income' ? amt : -amt,
        status: 'categorized',
        assigned_property_id: m.propertyId,
        assigned_lot_id: m.lotId || '',
        assigned_category: m.category,
        batch_id: 'wizard-manual-' + Date.now(),
      },
    }];
  },

  async commit(transactions, ctx) {
    return commitTransactions(transactions, ctx);
  },
};