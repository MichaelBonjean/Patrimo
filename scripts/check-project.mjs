#!/usr/bin/env node
// =============================================================================
// check-project.mjs — Gardien de cohérence structurelle Patrimo.
// -----------------------------------------------------------------------------
//   1. Valide la syntaxe JSON/JSONC de toutes les entités (base44/entities/*.jsonc)
//      et de tous les workflows (base44/workflows/*.jsonc).
//   2. Vérifie que chaque dossier base44/functions/<name> possède un entry.ts
//      non vide avec un `export default`.
//
// Sortie : exit ≠ 0 si au moins un problème de cohérence est détecté.
// =============================================================================

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;

// --- 1. JSON / JSONC ---------------------------------------------------------

function stripJsonc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')        // blocs /* … */
    .replace(/(^|[^:])\/\/.*$/gm, '$1')      // lignes // (sans casser http://)
    .replace(/,(\s*[}\]])/g, '$1');          // virgules traînées
}

function validateJsoncDir(dir, label) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (!/\.(jsonc|json)$/.test(f)) continue;
    const p = join(dir, f);
    try {
      JSON.parse(stripJsonc(readFileSync(p, 'utf8')));
    } catch (e) {
      failures++;
      console.error(`✗ ${label} JSON invalide : ${p} — ${e.message}`);
    }
  }
}

validateJsoncDir('base44/entities', 'entité');
validateJsoncDir('base44/workflows', 'workflow');

// --- 2. Fonctions backend ----------------------------------------------------

const fnDir = 'base44/functions';
if (existsSync(fnDir)) {
  for (const name of readdirSync(fnDir)) {
    const p = join(fnDir, name);
    if (!statSync(p).isDirectory()) continue;
    const entry = join(p, 'entry.ts');
    if (!existsSync(entry)) {
      failures++;
      console.error(`✗ Fonction backend sans entry.ts : ${p}`);
      continue;
    }
    const content = readFileSync(entry, 'utf8');
    if (!content.trim()) {
      failures++;
      console.error(`✗ entry.ts vide : ${entry}`);
    }
    if (!/export\s+default/.test(content)) {
      failures++;
      console.error(`✗ entry.ts sans export default : ${entry}`);
    }
  }
}

if (failures > 0) {
  console.error(`\n✗ check-project : ${failures} problème(s) de cohérence détecté(s).`);
  process.exit(1);
}
console.log('✓ check-project : JSONC entités/workflows valides + fonctions backend cohérentes.');