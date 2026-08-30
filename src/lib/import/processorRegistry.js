import { genericBankProcessor } from './processors/genericBankProcessor';
import { cafProcessor } from './processors/cafProcessor';
import { manualProcessor } from './processors/manualProcessor';

/**
 * Processor interface (each processor is a plain object):
 *   id, label, acceptFiles, acceptExtensions[]
 *   async detect(input)        -> confidence 0..1 (0 = not mine)
 *   async parse(input, ctx)    -> { records, columns }
 *   defaultMapping(record, ctx)-> mapping { include, category, propertyId, lotId, type, month, year, note }
 *   async transform(records, mappings, ctx) -> transaction[]
 *   async commit(transactions, ctx) -> { created }
 * input = { file, text } for files ; { record } for manual.
 */

const registry = [];

export function registerProcessor(p) { registry.push(p); }
export function getProcessors() { return registry; }

export async function detectProcessor(input) {
  let best = null;
  let bestScore = 0;
  for (const p of registry) {
    if (p.acceptFiles === false) continue;
    try {
      const score = await p.detect(input);
      if (score > bestScore) { bestScore = score; best = p; }
    } catch {
      /* a failing detector simply cannot claim the file */
    }
  }
  return bestScore > 0 ? best : null;
}

registerProcessor(cafProcessor);
registerProcessor(genericBankProcessor);
registerProcessor(manualProcessor);