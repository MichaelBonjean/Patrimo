#!/usr/bin/env node
// =============================================================================
// check-tests.mjs — Gardien de la qualité des tests Patrimo.
// -----------------------------------------------------------------------------
// Détecte les tests MORTS ou IGNORÉS SILENCIEUSEMENT dans la suite Vitest/Playwright :
//
//   ✗xit / xdescribe  : tests expurgés jamais exécutés (toujours morts)
//   ✗it.todo / test.todo : tests déclarés mais jamais lancés (silencieux)
//   ✗.skip() / .fixme()  : ignore sans raison/guard (silencieux)
//
// Les .skip(...) / .fixme(...) avec un argument (guard env ou raison) sont
// ACCEPTÉS : ils apparaissent explicitement dans le rapport (visibles, comptés).
//
// Sortie : exit ≠ 0 si au moins un test critique estmort/silencieux.
// =============================================================================

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.spec\.(js|ts|jsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

const ROOTS = ['tests/unit', 'tests/integration', 'tests/security', 'tests/e2e'];
const specs = ROOTS.flatMap((d) => walk(d));

let failures = 0;

for (const f of specs) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((ln, i) => {
    const lineNo = i + 1;
    // 1. Patterns TOUJOURS morts (jamais exécutés par Vitest)
    if (/\bxit\s*\(|\bxdescribe\s*\(/.test(ln)) {
      failures++;
      console.error(`✗ ${f}:${lineNo} — xit/xdescribe : test expurgé, jamais exécuté`);
    }
    if (/\bit\.todo\s*\(|\btest\.todo\s*\(|\bdescribe\.todo\s*\(/.test(ln)) {
      failures++;
      console.error(`✗ ${f}:${lineNo} — it.todo/test.todo/describe.todo : test mort déclaré (convertir en it.skip motivé ou implémenter)`);
    }
    // 2. Ignore SILENCIEUX (sans raison ni guard)
    if (/\.(skip|fixme)\s*\(\s*\)/.test(ln)) {
      failures++;
      console.error(`✗ ${f}:${lineNo} — .skip()/.fixme() sans raison : test ignoré silencieusement`);
    }
  });
}

if (failures > 0) {
  console.error(`\n✗ ${failures} test(s) mort(s) ou ignoré(s) silencieusement — build bloqué.`);
  console.error(`  Corriger : implémenter le test, ou convertir en .skip(<raison>) explicite.`);
  process.exit(1);
}
console.log(`✓ check-tests : ${specs.length} fichiers spec scannés — aucun test mort ni skip silencieux.`);