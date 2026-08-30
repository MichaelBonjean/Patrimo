import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Anti-régression de marque : le vieux nom "ImmoGestion" ne doit plus
// apparaître dans le code source, les configs publiques ni les docs.
// En cas de copier-coller futur qui ré-introduirait le vieux nom, ce test
// échoue avec la liste précise des fichiers concernés.
const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'base44', 'public'];
const SCAN_FILES = ['index.html', 'package.json', 'README.md'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'tests', '.test-artifacts']);
const RE = /immogestion/i;

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(p, acc);
    } else {
      acc.push(p);
    }
  }
  return acc;
}

function collect() {
  const files = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
  for (const f of SCAN_FILES) {
    const p = join(ROOT, f);
    if (existsSync(p)) files.push(p);
  }
  return files;
}

describe('Branding — aucun reste de "ImmoGestion"', () => {
  it('src/, base44/, public/, index.html, package.json, README.md ne contiennent pas "immogestion"', () => {
    const offenders = [];
    for (const f of collect()) {
      let content;
      try {
        content = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      if (RE.test(content)) {
        const lines = content
          .split('\n')
          .map((line, i) => ({ n: i + 1, line }))
          .filter(({ line }) => RE.test(line));
        offenders.push({
          file: relative(ROOT, f),
          lines: lines.map(({ n, line }) => `${n}: ${line.trim().slice(0, 160)}`),
        });
      }
    }
    if (offenders.length) {
      const msg = offenders
        .map((o) => `${o.file}\n  ${o.lines.join('\n  ')}`)
        .join('\n\n');
      throw new Error(`Le vieux nom "ImmoGestion" est encore présent dans :\n\n${msg}`);
    }
    expect(offenders).toEqual([]);
  });
});