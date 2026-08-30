import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const active = vi.hoisted(() => ({ current: null }));
vi.mock('npm:@base44/sdk@0.8.40', () => ({ createClientFromRequest: () => active.current }));

import ingestHandler from '../../../base44/functions/ingestDocument/entry.ts';

const OWNER_A = 'a.bailleur@example.fr';
const OWNER_B = 'b.bailleur@example.fr';

const BAIL_TEXT =
  'CONTRAT DE BAIL DE RESIDENCE PRINCIPALE\n' +
  'Entre le bailleur M. Durand et le locataire M. Dupont,\n' +
  'Loyer hors charges : 850 EUR, charges : 50 EUR, dépôt : 900 EUR,\n' +
  'Date de prise effet : 2026-01-01, durée 3 ans, échéance le 5 du mois.';

// Mock InvokeLLM : branche sur le response_json_schema demandé.
function bailLLM(args) {
  const props = args?.response_json_schema?.properties || {};
  if ('pages_count' in props) return { text: BAIL_TEXT, pages_count: 3 };
  if ('reason' in props && 'type' in props) return { type: 'bail_alur', confidence: 0.9, reason: 'bail de location ALUR' };
  if ('extracted_data' in props) return {
    extracted_data: { tenant_name: 'Dupont', landlord_name: 'Durand', rent_excluding_charges: 850, charges: 50, deposit: 900, date_start: '2026-01-01' },
    confidence_per_field: { tenant_name: 0.95, rent_excluding_charges: 0.9 },
  };
  return {};
}

function makeDoc(owner, overrides = {}) {
  return active.current.asServiceRole.entities.DocumentImport.create({
    owner_id: owner,
    user_id: 'u-' + owner,
    patrimony_id: owner,
    file_url: 'https://cdn.test/' + (overrides.file_name || 'doc.pdf'),
    file_name: overrides.file_name || 'doc.pdf',
    file_size: overrides.file_size ?? 1024,
    mime_type: 'application/pdf',
    source: 'upload_web',
    status: 'uploaded',
    created_date: overrides.created_date || new Date().toISOString(),
    ...overrides,
  });
}

function clientFor(owner, { plan = 'pro', status = 'trialing', created_date, llm } = {}) {
  const c = makeClient({
    user: {
      id: 'u-' + owner, email: owner, full_name: owner,
      patrimony_id: owner, patrimony_role: 'OWNER',
      plan, subscription_status: status,
      created_date: created_date || '2025-01-01',
    },
  });
  if (llm) c.integrations.Core.InvokeLLM.mockImplementation(llm);
  return c;
}

describe('Ingestion IA — ingestDocument', () => {
  beforeEach(() => { active.current = clientFor(OWNER_A, { llm: bailLLM }); });

  it('happy path — bail classé + extrait + awaiting_review + coût cohérent', async () => {
    const doc = await makeDoc(OWNER_A);
    const { status, data } = await run(ingestHandler, { document_import_id: doc.id });
    expect(status).toBe(200);
    expect(data.classification).toBe('bail_alur');
    expect(data.confidence).toBeCloseTo(0.9, 1);
    expect(data.record.status).toBe('awaiting_review');
    expect(data.record.ocr_text).toContain('CONTRAT');
    expect(data.record.extracted_data.tenant_name).toBe('Dupont');
    // 3 pages × 3 cents (vision, pas de MISTRAL_API_KEY) = 9 cents
    expect(data.cost_cents).toBe(9);
    expect(data.record.cost_cents).toBe(9);
  });

  it('fichier corrompu — échec extraction → status failed, message clair', async () => {
    active.current = clientFor(OWNER_A, { llm: async () => { throw new Error('corrupt file'); } });
    const doc = await makeDoc(OWNER_A, { file_name: 'corrompu.pdf' });
    const { status, data } = await run(ingestHandler, { document_import_id: doc.id });
    expect(status).toBe(422);
    expect(data.error).toMatch(/non traitable/);
    const rec = active.current.all('DocumentImport').find((r) => r.id === doc.id);
    expect(rec.status).toBe('failed');
    expect(rec.error_message).toMatch(/non traitable/);
  });

  it('PDF chiffré/protégé — texte vide → refus explicite', async () => {
    active.current = clientFor(OWNER_A, { llm: async () => ({ text: '', pages_count: 0 }) });
    const doc = await makeDoc(OWNER_A, { file_name: 'crypt.pdf' });
    const { status, data } = await run(ingestHandler, { document_import_id: doc.id });
    expect(status).toBe(422);
    expect(data.error).toMatch(/chiffré|non extractible/);
    const rec = active.current.all('DocumentImport').find((r) => r.id === doc.id);
    expect(rec.status).toBe('failed');
  });

  it('document > 20 pages — traité + warning + coût proportionnel', async () => {
    active.current = clientFor(OWNER_A, {
      llm: (args) => {
        const props = args?.response_json_schema?.properties || {};
        if ('pages_count' in props) return { text: BAIL_TEXT, pages_count: 25 };
        if ('reason' in props) return { type: 'quittance_loyer', confidence: 0.8, reason: 'quittance' };
        if ('extracted_data' in props) return { extracted_data: { period: '2026-01', total: 900 }, confidence_per_field: {} };
        return {};
      },
    });
    const doc = await makeDoc(OWNER_A);
    const { status, data } = await run(ingestHandler, { document_import_id: doc.id });
    expect(status).toBe(200);
    expect(data.pages_count).toBe(25);
    expect(data.record.pages_count).toBe(25);
    expect(data.record.error_message).toMatch(/20 pages/);
    // 25 pages × 3 cents = 75 cents
    expect(data.cost_cents).toBe(75);
  });

  it('isolation multi-tenant — A ne voit jamais les docs de B', async () => {
    const c = clientFor(OWNER_A, { llm: bailLLM });
    active.current = c;
    const docB = await c.asServiceRole.entities.DocumentImport.create({
      owner_id: OWNER_B, user_id: 'u-' + OWNER_B, patrimony_id: OWNER_B,
      file_url: 'https://cdn.test/b.pdf', file_name: 'b.pdf', file_size: 1024,
      mime_type: 'application/pdf', source: 'upload_web', status: 'uploaded',
    });
    const { status } = await run(ingestHandler, { document_import_id: docB.id });
    expect(status).toBe(404);
  });

  it('rate limit — starter à 3/mois, 4e ingestion → 429', async () => {
    const c = clientFor(OWNER_A, { plan: 'starter', status: 'none', created_date: '2024-01-01', llm: bailLLM });
    active.current = c;
    const recent = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      await c.asServiceRole.entities.DocumentImport.create({
        owner_id: OWNER_A, user_id: 'u-' + OWNER_A, patrimony_id: OWNER_A,
        file_url: 'x', file_name: 'd.pdf', file_size: 1, source: 'upload_web',
        status: 'awaiting_review', created_date: recent,
      });
    }
    const doc = await makeDoc(OWNER_A, { created_date: recent });
    const { status, data } = await run(ingestHandler, { document_import_id: doc.id });
    expect(status).toBe(429);
    expect(data.error).toMatch(/Limite mensuelle/);
    expect(data.plan).toBe('starter');
    expect(data.limit).toBe(3);
  });

  it('sécurité — fichier > 20 Mo → 413', async () => {
    const doc = await makeDoc(OWNER_A, { file_size: 21 * 1024 * 1024, file_name: 'big.pdf' });
    const { status, data } = await run(ingestHandler, { document_import_id: doc.id });
    expect(status).toBe(413);
    expect(data.error).toMatch(/20 Mo/);
  });

  it('auth — sans user → 401 ; sans document_import_id → 400', async () => {
    active.current = makeClient({ user: null });
    expect((await run(ingestHandler, { document_import_id: 'x' })).status).toBe(401);
    active.current = clientFor(OWNER_A, { llm: bailLLM });
    expect((await run(ingestHandler, {})).status).toBe(400);
  });

  it('RGPD — IBAN/CB/SSN masqués dans ocr_text', async () => {
    const llm = (args) => {
      const props = args?.response_json_schema?.properties || {};
      if ('pages_count' in props) return {
        text: 'BAIL IBAN FR76 1234 5678 9012 3456 7890 123 CB 4242 4242 4242 4242 SSN 1 12 2 75 116 304 9999',
        pages_count: 1,
      };
      if ('reason' in props) return { type: 'bail_alur', confidence: 0.9, reason: 'bail' };
      if ('extracted_data' in props) return { extracted_data: { tenant_name: 'X' }, confidence_per_field: {} };
      return {};
    };
    active.current = clientFor(OWNER_A, { llm });
    const doc = await makeDoc(OWNER_A);
    const { status, data } = await run(ingestHandler, { document_import_id: doc.id });
    expect(status).toBe(200);
    const ocr = data.record.ocr_text;
    expect(ocr).not.toContain('FR76 1234 5678');
    expect(ocr).not.toContain('4242 4242 4242 4242');
    expect(ocr).toMatch(/IBAN/); // le mot reste, le numéro est masqué
  });
});