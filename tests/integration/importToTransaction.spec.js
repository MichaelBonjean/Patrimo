import { describe, it, expect } from 'vitest';
import { makeFingerprintSync, classifyDuplicate } from '../../base44/shared/bankTransactionEngine.ts';
import { makeMockService } from '../helpers/mockService.js';

// Intégration : import bancaire → Transaction catégorisée + BankTransaction liée,
// avec dédoublonnage exact au réimport.
// Miroir minimal du commit unifié (src/lib/import/commit.js) sur un faux service.
async function commitOne(svc, owner, row) {
  const fingerprint = makeFingerprintSync(row);
  const existing = await svc.entities.BankTransaction.filter({});
  const dup = classifyDuplicate({ ...row, fingerprint }, existing);
  if (dup.level === 'exact') return { committed: false, reason: 'exact', fingerprint };

  const tx = await svc.entities.Transaction.create({
    owner_id: owner,
    property_id: row.property_id,
    lot_id: row.lot_id,
    year: row.year,
    month: row.month,
    category: row.category,
    category_label: row.category_label || row.category,
    amount: row.amount,
    type: row.type,
  });
  const bt = await svc.entities.BankTransaction.create({
    owner_id: owner,
    account_id: row.account_id,
    date: row.date,
    amount: row.amount,
    raw_description: row.raw_description,
    normalized_description: row.normalized_description,
    fingerprint,
    dedup_status: dup.level === 'probable' ? 'probable' : 'unique',
    status: 'linked',
    transaction_id: tx.id,
    category: row.category,
    property_id: row.property_id,
    lot_id: row.lot_id,
  });
  return { committed: true, tx, bt, fingerprint };
}

describe('INTÉGRATION — import bancaire → transaction', () => {
  it('une ligne unique crée une Transaction + une BankTransaction liée (status linked)', async () => {
    const svc = makeMockService();
    const row = {
      account_id: 'FR12', date: '2024-01-05', amount: 900,
      raw_description: 'VIR LOYER DUPONT', normalized_description: 'loyer dupont',
      property_id: 'p1', lot_id: 'l1', year: 2024, month: 1,
      category: 'rent', type: 'income',
    };
    const r = await commitOne(svc, 'a@x.com', row);
    expect(r.committed).toBe(true);
    const tx = await svc.entities.Transaction.list();
    const bt = await svc.entities.BankTransaction.list();
    expect(tx.length).toBe(1);
    expect(bt.length).toBe(1);
    expect(bt[0].status).toBe('linked');
    expect(bt[0].transaction_id).toBe(tx[0].id);
    expect(bt[0].fingerprint.startsWith('sha256:')).toBe(true);
  });

  it('réimport du même fichier → doublon exact, aucune nouvelle ligne', async () => {
    const svc = makeMockService();
    const row = {
      account_id: 'FR12', date: '2024-01-05', amount: 900,
      raw_description: 'VIR LOYER DUPONT', normalized_description: 'loyer dupont',
      property_id: 'p1', lot_id: 'l1', year: 2024, month: 1, category: 'rent', type: 'income',
    };
    await commitOne(svc, 'a@x.com', row);
    const r2 = await commitOne(svc, 'a@x.com', row);
    expect(r2.committed).toBe(false);
    expect(r2.reason).toBe('exact');
    expect((await svc.entities.Transaction.list()).length).toBe(1);
    expect((await svc.entities.BankTransaction.list()).length).toBe(1);
  });

  it('deux loyers distincts même période/lot mais montants différents → deux lignes (jamais fusionnés)', async () => {
    const svc = makeMockService();
    await commitOne(svc, 'a@x.com', {
      account_id: 'FR12', date: '2024-01-05', amount: 800,
      raw_description: 'VIR LOYER DUPLEX', normalized_description: 'loyer duplex',
      property_id: 'p1', lot_id: 'l1', year: 2024, month: 1, category: 'rent', type: 'income',
    });
    await commitOne(svc, 'a@x.com', {
      account_id: 'FR12', date: '2024-01-05', amount: 700,
      raw_description: 'VIR LOYER DUPLEX', normalized_description: 'loyer duplex',
      property_id: 'p1', lot_id: 'l1', year: 2024, month: 1, category: 'rent', type: 'income',
    });
    expect((await svc.entities.Transaction.list()).length).toBe(2);
    expect((await svc.entities.BankTransaction.list()).length).toBe(2);
  });
});