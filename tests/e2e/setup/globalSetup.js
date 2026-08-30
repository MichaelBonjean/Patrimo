/**
 * globalSetup Playwright — fabrique le storageState d'authentification de manière
 * auto-suffisante, sans exiger un fichier E2E_STORAGE_STATE déjà exporté à la main.
 *
 * Mécanisme supporté par Base44 : l'app lit son jeton de session depuis la clé
 * localStorage `base44_access_token` (cf. src/lib/app-params.js). On injecte donc
 * ce jeton dans le localStorage de l'origine de l'app, puis on exporte le
 * storageState résultant dans .test-artifacts/e2e-state.json, directement
 * réutilisé par la suite E2E.
 *
 * Sources du jeton, par ordre de priorité :
 *   1. E2E_STORAGE_STATE : chemin vers un storageState déjà exporté (rétro-compat).
 *   2. E2E_ACCESS_TOKEN  : jeton de session Base44 d'un utilisateur de test
 *      (e2e-test@immogestion.local, à inviter une fois dans l'app en tant que
 *      bailleur). Correspond exactement au paramètre `access_token` que Base44
 *      propage dans l'URL à la connexion.
 *   3. E2E_LOGIN_EMAIL / E2E_LOGIN_PASSWORD : repli par UI (login hébergé Base44).
 *      Fournis au cas où un formulaire email/mot de passe serait exposé.
 *
 * Si aucune source n'est disponible, on n'écrit PAS le fichier et on émet un
 * avertissement actionnable : les smoke tests (non auth) restent exécutables et
 * la journey est ignorée avec un message clair.
 */
import { mkdirSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

export const STATE_PATH = '.test-artifacts/e2e-state.json';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';

async function buildFromToken(token) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  try {
    // Le localStorage est scopé à l'origine : il faut d'abord y charger une page.
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    await page.evaluate((t) => {
      try {
        window.localStorage.setItem('base44_access_token', t);
        // Clé legacy conservée par app-params (clear_access_token purge `token`).
        window.localStorage.setItem('token', t);
      } catch (_) { /* origine non encore atteinte : la navigation qui suit réessayera */ }
    }, token);
    // Un rechargement permet à AuthContext de readapter la session depuis le jeton.
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
    await context.storageState({ path: STATE_PATH });
  } finally {
    await browser.close();
  }
}

async function buildFromUI(email, password) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Base44 héberge le login : on déclenche l'entrée d'auth si l'app redirige.
    await page.getByRole('button', { name: /se connecter|connexion|s'identifier/i }).first().click().catch(() => {});
    await page.getByLabel(/email|e-mail|identifiant/i).first().fill(email).catch(() => {});
    await page.getByLabel(/mot de passe|password/i).first().fill(password).catch(() => {});
    await page.getByRole('button', { name: /se connecter|connexion|valider|continuer/i }).first().click().catch(() => {});
    await page.waitForURL(/\/$|\/biens|\/dashboard|\/onboarding/, { timeout: 20_000 }).catch(() => {});
    await context.storageState({ path: STATE_PATH });
  } finally {
    await browser.close();
  }
}

export default async function globalSetup() {
  mkdirSync('.test-artifacts', { recursive: true });

  // 1. Rétro-compat : un storageState déjà exporté.
  if (process.env.E2E_STORAGE_STATE && existsSync(process.env.E2E_STORAGE_STATE)) {
    copyFileSync(process.env.E2E_STORAGE_STATE, STATE_PATH);
    // eslint-disable-next-line no-console
    console.log(`[globalSetup] storageState réutilisé depuis ${process.env.E2E_STORAGE_STATE} -> ${STATE_PATH}`);
    return;
  }

  // 2. Jeton d'accès Base44 (mécanisme natif supporté).
  if (process.env.E2E_ACCESS_TOKEN) {
    await buildFromToken(process.env.E2E_ACCESS_TOKEN);
    // eslint-disable-next-line no-console
    console.log(`[globalSetup] storageState fabrique depuis E2E_ACCESS_TOKEN -> ${STATE_PATH}`);
    return;
  }

  // 3. Repli par UI (si Base44 expose un formulaire email/mot de passe).
  if (process.env.E2E_LOGIN_EMAIL && process.env.E2E_LOGIN_PASSWORD) {
    await buildFromUI(process.env.E2E_LOGIN_EMAIL, process.env.E2E_LOGIN_PASSWORD);
    // eslint-disable-next-line no-console
    console.log(`[globalSetup] storageState fabrique par login UI -> ${STATE_PATH}`);
    return;
  }

  // 4. Aucune source : on échoue proprement (sans casser les smoke tests).
  writeFileSync(STATE_PATH, '{"origins":[]}');
  // eslint-disable-next-line no-console
  console.warn(
    '[globalSetup] Aucune source d\'auth fournie (E2E_ACCESS_TOKEN / E2E_STORAGE_STATE / E2E_LOGIN_*).\n' +
    '    → La journey E2E sera ignorée. Pour la lancer :\n' +
    '      E2E_ACCESS_TOKEN=<jeton de session Base44 de e2e-test@immogestion.local> npm run test:e2e',
  );
}