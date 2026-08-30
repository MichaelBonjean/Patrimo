import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Configuration Vitest pour le projet Patrimo.
//
// - environment : jsdom (React Testing Library)
// - alias  : '@' -> ./src (cohérent avec le résolveur Vite de l'app)
// -include : tests unitaires + intégration + sécurité.
//   Les tests E2E sont gérés par Playwright (tests/e2e), hors Vitest.
//
// Lancement automatique avant build de production :
//   "prebuild": "vitest run tests/unit tests/integration tests/security"
// (n'empêche pas un `vite build` manuel sans tests)
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Les fonctions back-end importent le runtime serveur Deno via le
      // spécifier `npm:@base44/sdk@0.8.40`, non résolvable par le resolver Vite
      // de Vitest. On l'aliase vers un stub local ; chaque spec remplace
      // ensuite ce module par un client in-memory via `vi.mock(...)`.
      'npm:@base44/sdk@0.8.40': fileURLToPath(new URL('./tests/helpers/sdkStub.js', import.meta.url)),
      // `base44:runtime` (secrets, waitUntil) n'est pas résolvable par Vite à
      // l'analyse d'import ; on l'aliase vers un stub local que les specs
      // remplacent ensuite via vi.mock('base44:runtime') selon leurs besoins.
      'base44:runtime': fileURLToPath(new URL('./tests/helpers/runtimeStub.js', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: [
      'tests/unit/**/*.spec.js',
      'tests/integration/**/*.spec.js',
      'tests/security/**/*.spec.js',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['base44/shared/**/*.ts', 'src/lib/**/*.js'],
      exclude: ['**/*.test.*', 'tests/**', 'src/lib/import/processors/**'],
    },
  },
});