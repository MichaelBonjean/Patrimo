import {
  makeFingerprintSync,
  normalizeDescription,
  descriptionSimilarity,
  isProbableDuplicate,
  classifyDuplicate,
} from '../../shared/bankTransactionEngine.ts';

/**
 * Tests de réimport & dédoublonnage des transactions bancaires brutes.
 *
 * Garanties vérifiées :
 *  - T1  réimport du même fichier → DOUBLON EXACT (même fingerprint) → non recréé.
 *  - T2  idempotence : mêmes entrées ⇒ même fingerprint (stable, déterministe).
 *  - T3  DEUX paiements DISTINCTS même mois + catégorie + lot mais dates/libellés
 *        différents ⇒ AUCUN rapprochement (unique). Cœur du cahier des charges.
 *  - T4  doublon probable : même compte + même montant + même date + libellés
 *        similaires (tokens chevauchants ≥ 0,6) ⇒ 'probable' (validation humaine).
 *  - T5  doublon probable sur date proche (±2 j) + libellé identique ⇒ 'probable'.
 *  - T6  date > 3 jours ⇒ unique (rien d'automatique).
 *  - T7  montant différent ⇒ unique.
 *  - T8  même provider_transaction_id ⇒ 'probable' même si libellé diffère.
 *  - T9  la normalisation ignore bruit/accents/références longues (stable).
 *  - T10 exact prioritaire sur probable (fingerprint d'abord).
 */

function run() {
  const errors: string[] = [];
  const asserts: any[] = [];
  const assert = (label: string, cond: boolean) => {
    asserts.push({ label, pass: !!cond });
    if (!cond) errors.push(label);
  };

  const base = {
    account_id: 'FR76-1234',
    provider_transaction_id: '',
    date: '2026-03-05',
    amount: -850.00,
  };

  const fpA = makeFingerprintSync({ ...base, raw_description: 'VIREMENT DUPONT MARS' });

  // ── T1 réimport exact ─────────────────────────────────────────────────
  {
    const existing = [{ id: 'bt1', fingerprint: fpA, ...base, normalized_description: normalizeDescription('VIREMENT DUPONT MARS') }];
    const cand = { fingerprint: fpA, ...base, normalized_description: normalizeDescription('VIREMENT DUPONT MARS') };
    const r = classifyDuplicate(cand, existing);
    assert('T1 réimport → exact', r.level === 'exact');
    assert('T1 match = bt1', r.match?.id === 'bt1');
  }

  // ── T2 idempotence ─────────────────────────────────────────────────────
  {
    const a = makeFingerprintSync({ ...base, raw_description: 'CB CARREFOUR 12/03' });
    const b = makeFingerprintSync({ ...base, raw_description: 'CB CARREFOUR 12/03' });
    assert('T2 fingerprint stable', a === b);
    assert('T2 préfixe sha256', a.startsWith('sha256:') && a.length === 71);
  }

  // ── T3 deux paiements DISTINCTS (même mois/cat/lot) → unique ───────────
  {
    const existing = [{
      id: 'bt3', fingerprint: fpA, ...base, date: '2026-03-05', amount: -850,
      normalized_description: normalizeDescription('VIREMENT DUPONT MARS'),
    }];
    // Même catégorie (loyer), même lot, même mois — mais date + libellé différents.
    const cand = {
      fingerprint: makeFingerprintSync({ ...base, date: '2026-03-19', raw_description: 'VIREMENT DUPONT SOLDE MARS' }),
      account_id: base.account_id, provider_transaction_id: '',
      date: '2026-03-19', amount: -850,
      normalized_description: normalizeDescription('VIREMENT DUPONT SOLDE MARS'),
    };
    const r = classifyDuplicate(cand, existing);
    assert('T3 deux loyers distincts → unique', r.level === null);
  }

  // ── T4 doublon probable (même jour, libellés similaires) ───────────────
  {
    const existing = [{
      id: 'bt4', fingerprint: makeFingerprintSync({ ...base, raw_description: 'LOYER MARS DUPONT T2' }),
      ...base, date: '2026-03-05', amount: -850,
      normalized_description: normalizeDescription('LOYER MARS DUPONT T2'),
    }];
    const cand = {
      fingerprint: makeFingerprintSync({ ...base, raw_description: 'LOYER MARS DUPONT T2 LYON' }),
      ...base, date: '2026-03-05', amount: -850,
      normalized_description: normalizeDescription('LOYER MARS DUPONT T2 LYON'),
    };
    const r = classifyDuplicate(cand, existing);
    assert('T4 probable (même jour, libellés similaires)', r.level === 'probable');
    assert('T4 sim ≥ 0,6', descriptionSimilarity(cand.normalized_description, existing[0].normalized_description) >= 0.6);
  }

  // ── T5 date ±2 j + libellé identique → probable ─────────────────────────
  {
    const existing = [{
      id: 'bt5', fingerprint: makeFingerprintSync({ ...base, raw_description: 'LOYER DUPONT' }),
      ...base, date: '2026-03-05', amount: -850,
      normalized_description: normalizeDescription('LOYER DUPONT'),
    }];
    const cand = {
      fingerprint: makeFingerprintSync({ ...base, date: '2026-03-07', raw_description: 'LOYER DUPONT' }),
      ...base, date: '2026-03-07', amount: -850,
      normalized_description: normalizeDescription('LOYER DUPONT'),
    };
    const r = classifyDuplicate(cand, existing);
    assert('T5 ±2j + même libellé → probable', r.level === 'probable');
  }

  // ── T6 date > 3 j → unique ─────────────────────────────────────────────
  {
    const existing = [{
      id: 'bt6', fingerprint: makeFingerprintSync({ ...base, raw_description: 'LOYER DUPONT' }),
      ...base, date: '2026-03-01', amount: -850,
      normalized_description: normalizeDescription('LOYER DUPONT'),
    }];
    const cand = {
      fingerprint: makeFingerprintSync({ ...base, date: '2026-03-08', raw_description: 'LOYER DUPONT' }),
      ...base, date: '2026-03-08', amount: -850,
      normalized_description: normalizeDescription('LOYER DUPONT'),
    };
    const r = classifyDuplicate(cand, existing);
    assert('T6 >3 jours → unique', r.level === null);
  }

  // ── T7 montant différent → unique ──────────────────────────────────────
  {
    const existing = [{
      id: 'bt7', fingerprint: makeFingerprintSync({ ...base, amount: -850, raw_description: 'LOYER DUPONT' }),
      ...base, date: '2026-03-05', amount: -850,
      normalized_description: normalizeDescription('LOYER DUPONT'),
    }];
    const cand = {
      fingerprint: makeFingerprintSync({ ...base, amount: -820, raw_description: 'LOYER DUPONT' }),
      ...base, date: '2026-03-05', amount: -820,
      normalized_description: normalizeDescription('LOYER DUPONT'),
    };
    const r = classifyDuplicate(cand, existing);
    assert('T7 montant différent → unique', r.level === null);
  }

  // ── T8 même provider_transaction_id → probable ─────────────────────────
  {
    const existing = [{
      id: 'bt8', fingerprint: makeFingerprintSync({ ...base, provider_transaction_id: 'TX-999', raw_description: 'LOYER DUPONT' }),
      ...base, provider_transaction_id: 'TX-999', date: '2026-03-05', amount: -850,
      normalized_description: normalizeDescription('LOYER DUPONT'),
    }];
    const cand = {
      fingerprint: makeFingerprintSync({ ...base, provider_transaction_id: 'TX-999', raw_description: 'LOYER DUPONT LYON 69006' }),
      ...base, provider_transaction_id: 'TX-999', date: '2026-03-05', amount: -850,
      normalized_description: normalizeDescription('LOYER DUPONT LYON 69006'),
    };
    const r = classifyDuplicate(cand, existing);
    assert('T8 même provider_id → probable', r.level === 'probable');
  }

  // ── T9 normalisation ignore bruit/références ──────────────────────────
  {
    const a = normalizeDescription('CB*1234  X7890 VIREMENT DUPONT MARS');
    const b = normalizeDescription('virement dupont mars');
    assert('T9 bruit/accents neutralisés', a === b);
  }

  // ── T10 exact prioritaire sur probable ─────────────────────────────────
  {
    const existing = [{
      id: 'bt10', fingerprint: fpA, ...base, date: '2026-03-05', amount: -850,
      normalized_description: normalizeDescription('VIREMENT DUPONT MARS'),
    }];
    const cand = {
      fingerprint: fpA, // exact
      ...base, date: '2026-03-05', amount: -850,
      normalized_description: normalizeDescription('VIREMENT DUPONT MARS'),
    };
    const r = classifyDuplicate(cand, existing);
    assert('T10 exact prioritaire', r.level === 'exact');
  }

  return { ok: errors.length === 0, errorCount: errors.length, errors, asserts };
}

export default async function (_req: Request): Promise<Response> {
  try {
    return Response.json(run());
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message }, { status: 500 });
  }
}