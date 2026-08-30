import { defineConfig, devices } from '@playwright/test';

// Configuration Playwright pour les tests E2E de Patrimo.
//
// Prérequis :
//   1. Lancer le serveur local : `npm run dev` (Vite, http://localhost:5173)
//   2. Installer les navigateurs : `npx playwright install --with-deps chromium`
//   3. Pour les tests nécessitant une session authentifiée, fournir l'état de
//      stockage (cookies/localStorage d'une session connectée) via :
//        E2E_STORAGE_STATE=/chemin/vers/storageState.json
//      Sans cette variable, les specs marquées `requireAuth` sont ignorées
//      (test.skip) — les smoke tests non authentifiés s'exécutent toujours.
//   4. URL de base via E2E_BASE_URL (défaut : http://localhost:5173).
//
// Lancement : `npm run test:e2e`
export default defineConfig({
  testDir: './tests/e2e',
  // Fabrique automatiquement le storageState d'auth avant l'exécution (token-based) —
  // la journey n'est plus skippée par un E2E_STORAGE_STATE manquant.
  globalSetup: './tests/e2e/setup/globalSetup.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    headless: true,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // State d'auth fabriqué par globalSetup (token-based). Concerne tous les
    // tests ; les smoke non auth ne sont pas impactés (état vide si pas de token).
    storageState: '.test-artifacts/e2e-state.json',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  // Démarrage automatique du serveur local si E2E_START_SERVER=1
  ...(process.env.E2E_START_SERVER
    ? {
        webServer: {
          command: 'npm run dev',
          url: process.env.E2E_BASE_URL || 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }
    : {}),
});