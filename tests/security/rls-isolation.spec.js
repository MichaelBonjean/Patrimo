import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// SÉCURITÉ — vérification statique des règles RLS sur toutes les entités.
//
// Le mécanisme d'isolation multi-utilisateurs de Patrimo repose sur :
//   1. un champ `owner_id` présent sur chaque entité métier ;
//   2. une règle RLS par opération (create/read/update/delete) qui restreint
//      l'accès aux enregistrements dont `data.owner_id === {{user.email}}`.
//
// Ce test parcourt base44/entities/*.jsonc et garantit que ces deux garde-fous
// sont présents sur CHAQUE entité. Une entité oubliée = fuite de données !
//
// Exceptions légitimes (clé partagée par patrimoine, gérée en RBAC, pas par owner_id) :
//   - User : intégrée au platform, gérée à part.
//   - PatrimonyMember : table d'appartenance elle-même (clé = patrimony_id = email du OWNER).
//   - AuditLog : journal d'audit partagé du patrimoine (clé = patrimony_id, isAdmin-géré).
// Ces entités isolent via patrimony_id ({{user.data.patrimony_id}}) et non owner_id.

const entitiesDir = join(process.cwd(), 'base44', 'entities');

const EXEMPT = new Set(['User.jsonc', 'PatrimonyMember.jsonc', 'AuditLog.jsonc']);

function stripJsonc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

const files = readdirSync(entitiesDir).filter((f) => f.endsWith('.jsonc') && !EXEMPT.has(f));

describe('SÉCURITÉ — RLS multi-utilisateurs (isolation totale)', () => {
  for (const file of files) {
    const raw = readFileSync(join(entitiesDir, file), 'utf8');
    const schema = JSON.parse(stripJsonc(raw));
    const name = file.replace(/\.jsonc$/, '');

    describe(`Entité ${name}`, () => {
      it('possède un champ owner_id', () => {
        expect(schema.properties?.owner_id, `${name} doit définir owner_id`).toBeDefined();
      });

      it('définit une règle RLS pour create/read/update/delete sur owner_id', () => {
        const rls = schema.rls;
        expect(rls, `${name} doit définir rls`).toBeDefined();
        for (const op of ['create', 'read', 'update', 'delete']) {
          expect(rls[op], `${name} doit définir rls.${op}`).toBeDefined();
          if (!rls[op]) continue;
          const ruleStr = JSON.stringify(rls[op]);
          expect(ruleStr, `${name} rls.${op} doit filtrer sur data.owner_id`).toContain('data.owner_id');
          expect(ruleStr, `${name} rls.${op} doit comparer à {{user.email}}`).toContain('{{user.email}}');
        }
      });
    });
  }
});