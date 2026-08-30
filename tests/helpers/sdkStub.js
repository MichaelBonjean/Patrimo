// Stub de résolution pour `npm:@base44/sdk@0.8.40` sous Vitest.
// Le module réel est un runtime serveur (Deno) non résolvable par le resolver
// Vite de Vitest. Les specs d'intégration mockent ce module via `vi.mock(...)`,
// qui prend le dessus et fournit le client in-memory actif ; cet alias sert
// uniquement à ce que l'import-analysis de Vite réussisse.
export function createClientFromRequest() {
  throw new Error('createClientFromRequest doit être mocké par vi.mock dans les specs');
}