/**
 * Étape « AI fallback » du pipeline unifié.
 *
 * Principes :
 *  - Les montants, dates et libellés proviennent TOUJOURS du parser déterministe
 *    (la ligne passée en paramètre). L'IA ne fournit que catégorie/bien/lot +
 *    confiance + raison, et renvoie OBLIGATOIREMENT le `row_id` reçu.
 *  - La correspondance se fait par `row_id` : un réordonnancement par le modèle
 *    ne mélange jamais montants et descriptions.
 *  - L'IA ne modifie jamais les données sans validation humaine : une proposition
 *    à confiance insuffisante (« medium » / « low ») passe en `to_verify`. Une
 *    proposition « high » et complète passe en `categorized` MAIS demeure soumise
 *    à la validation finale (commit) par l'utilisateur.
 */

import { base44 } from '@/api/base44Client';
import { resolveKey, TRANSACTION_CATEGORIES } from '@/lib/financeCategories';
import { STATUS } from './pipeline';

function ctxList(ctx) {
  const props = (ctx.properties || []).map((p) => `${p.id}:${p.name}`).join(', ');
  const lots = (ctx.lots || []).map((l) => {
    const tenants = [...(l.tenants || []).map((t) => t.name), l.tenant_name].filter(Boolean);
    return `${l.id}:${l.designation}(bien:${l.property_id})${tenants.length ? ` [locataires: ${tenants.join(', ')}]` : ''}`;
  }).join(' | ');
  const labels = TRANSACTION_CATEGORIES.map((c) => c.label).join(', ');
  return { props, lots, labels };
}

/**
 * Catégorise par IA les lignes encore `imported` (non catégorisées par les règles).
 * Mute les lignes en place (category/property_id/lot_id/confidence/reason/status).
 */
export async function aiCategorize(rows, ctx) {
  const unmatched = rows.filter((r) => r.status === STATUS.IMPORTED && !r.category);
  if (unmatched.length === 0) return { analyzed: 0 };

  const { props, lots, labels } = ctxList(ctx);
  const schema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            row_id: { type: 'string' },
            suggested_category: { type: 'string' },
            suggested_property_id: { type: 'string' },
            suggested_lot_id: { type: 'string' },
            confidence: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
    },
  };

  const payload = unmatched.map((r) => ({
    row_id: r.row_id,
    description: r.description,
    raw_date: r.raw_date,
    amount: r.amount,
    account: r.account,
  }));

  const prompt = `Tu es un expert comptable immobilier français. Pour chaque ligne ci-dessous, propose une catégorisation pour un logiciel de gestion locative.
Renvoie OBLIGATOIREMENT le même "row_id" que celui fourni (ne réordonne pas, ne résume pas).

Biens disponibles: ${props || 'aucun'}
Lots disponibles (avec locataires): ${lots || 'aucun'}
Catégories disponibles (utilise un libellé EXACT de cette liste): ${labels}

Pour chaque ligne: row_id (identique), suggested_category (libellé exact), suggested_property_id, suggested_lot_id, confidence ("high"/"medium"/"low"), reason (max 10 mots).
Si suggested_lot_id est identifié, suggested_property_id doit correspondre au bien du lot.

Lignes (JSON): ${JSON.stringify(payload)}`;

  const res = await base44.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema });
  const items = res?.items || [];

  for (const it of items) {
    const row = unmatched.find((r) => r.row_id === it.row_id);
    if (!row) continue;
    const cat = resolveKey(it.suggested_category);
    row.category = cat || '';
    row.property_id = it.suggested_property_id || '';
    row.lot_id = it.suggested_lot_id || '';
    row.confidence = (it.confidence || 'low').toLowerCase();
    row.reason = it.reason || '';
    const full = cat && row.property_id;
    row.status = full && row.confidence === 'high' ? STATUS.CATEGORIZED : STATUS.TO_VERIFY;
  }
  return { analyzed: unmatched.length };
}

/**
 * Extraction IA d'un relevé bancaire PDF. Pas de parser déterministe possible :
 * les données proviennent de l'IA, donc toutes les lignes passent en `to_verify`
 * (jamais d'auto-commit sans validation humaine).
 */
export async function aiExtractBankPdf(file, ctx) {
  const { file_url } = await base44.integrations.Core.UploadFile({ file });
  const { props, lots, labels } = ctxList(ctx);
  const schema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            raw_date: { type: 'string' },
            amount: { type: 'number' },
            suggested_category: { type: 'string' },
            suggested_property_id: { type: 'string' },
            suggested_lot_id: { type: 'string' },
            type: { type: 'string' },
            confidence: { type: 'string' },
            reason: { type: 'string' },
          },
        },
      },
    },
  };
  const prompt = `Tu es un expert comptable immobilier français. Voici un relevé bancaire en PDF. Extrais TOUTES les transactions et propose une catégorisation.

Biens disponibles: ${props || 'aucun'}
Lots disponibles (avec locataires): ${lots || 'aucun'}
Catégories (libellé exact): ${labels}

Pour chaque transaction: description, raw_date (JJ/MM/AAAA), amount (positif=entrée, négatif=sortie), suggested_category, suggested_property_id, suggested_lot_id, type ("income"/"expense"), confidence ("high"/"medium"/"low"), reason.`;
  const res = await base44.integrations.Core.InvokeLLM({ prompt, file_urls: [file_url], response_json_schema: schema });
  const items = res?.items || [];
  return items.map((it) => makePdfRow(it));
}

function makePdfRow(it) {
  // ligne importée depuis PDF (IA) → to_verify
  return {
    row_id: `pdf-${Math.random().toString(36).slice(2, 8)}`,
    source_type: 'bank',
    raw_date: it.raw_date || '',
    description: it.description || '',
    amount: Math.abs(Number(it.amount) || 0),
    account: '',
    note: it.description || '',
    bank_category: '',
    property_id: it.suggested_property_id || '',
    lot_id: it.suggested_lot_id || '',
    category: resolveKey(it.suggested_category) || '',
    type: it.type === 'expense' ? 'expense' : 'income',
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    include: true,
    status: STATUS.TO_VERIFY,
    confidence: (it.confidence || 'low').toLowerCase(),
    reason: it.reason || 'Extraction PDF par IA',
  };
}