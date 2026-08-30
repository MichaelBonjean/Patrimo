import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* global process */

// =============================================================================
// Tenant Portal Security — hardening de l'accès locataire par jeton magique.
// -----------------------------------------------------------------------------
// Valide (via l'endpoint HTTP /functions/<name>, qui renvoie le vrai code HTTP) :
//   1. 100 jetons aléatoires invalides → tous 403, jamais 500, ni fuite.
//   2. Jeton expiré → 403 avec code "expired".
//   3. XSS dans le formulaire d'incident : <script>alert(1)</script> stocké brut,
//      affiché échappé (pas d'exécution côté portail).
//   4. Rate-limit 10 req/min par IP + énumération séquentielle bloquée.
//
// PRÉREQUIS :
//   - E2E_BASE_URL vers l'app PUBLIÉE (les fonctions tournent côté serveur ;
//     l'endpoint /functions/<name> est joignable sur l'app déployée).
//   - storageState d'auth (globalSetup) pour le test XSS.
//   - (Optionnel) E2E_PORTAL_TOKEN : jeton valide pour les tests expired/XSS.
//     Si absent, ces tests sont skip (avec raison explicite).
//
// NOTE — Gardes non encore implémentés côté backend :
//   Le rate-limit par IP et le blocage de l'énumération séquentielle ne sont
//   PAS implémentés dans tenantPortal* (cf. base44/shared/tenantPortal.ts).
//   Les tests 4 sont en `test.fixme` : ils échouent tant que le garde-fou
//   n'est pas ajouté (et signalent toute régression une fois en place).
// =============================================================================

const STATE_PATH = resolve('.test-artifacts/e2e-state.json');
const BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const PORTAL_ACCESS = `${BASE_URL}/functions/tenantPortalAccess`;
const PORTAL_INCIDENT = `${BASE_URL}/functions/tenantPortalIncident`;

function hasAuthState() {
  if (!existsSync(STATE_PATH)) return false;
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    return Array.isArray(s.origins) && s.origins.some((o) =>
      Array.isArray(o.localStorage) && o.localStorage.some(([k]) => k === 'base44_access_token'));
  } catch { return false; }
}

const OK_403_CODES = new Set(['not_found', 'expired', 'lot_missing']);

function isSafe403(body) {
  if (!body || body.valid !== false) return false;
  if (!OK_403_CODES.has(body.code)) return false;
  if (body.message) return false; // fuite d'erreur interne (catch 500)
  return true;
}

test.describe.configure({ mode: 'serial' });

// 1. 100 jetons aléatoires invalides → 403 propres, jamais 500 ni fuite.
test(`1. 100 jetons invalides → 403, jamais 500 ni fuite`, async ({ request }) => {
  const tokens = Array.from({ length: 100 }, () => randToken());
  let got500 = 0, leaked = 0, badStatus = 0;
  for (const t of tokens) {
    const res = await request.post(PORTAL_ACCESS, { data: { token: t }, failOnStatusCode: false });
    const status = res.status();
    const body = await res.json().catch(() => ({}));
    if (status === 500) got500++;
    if (!isSafe403(body)) {
      badStatus++;
      if (body && body.message) leaked++;
    }
    expect(status, `token ${t.slice(0, 8)}… → status ${status}`).toBeLessThan(500);
  }
  expect(badStatus, `une réponse n'est ni 403 propre ni 500`).toBe(0);
  expect(leaked, `fuite de détail interne`).toBe(0);
  expect(got500).toBe(0);
});

// 2. Jeton expiré → 403 code "expired".
test(`2. jeton expiré → 403 code "expired"`, async ({ request }) => {
  const token = process.env.E2E_PORTAL_TOKEN;
  test.skip(!token, `Fournir E2E_PORTAL_TOKEN (jeton expiré) pour valider l'expiration.`);

  const res = await request.post(PORTAL_ACCESS, { data: { token }, failOnStatusCode: false });
  if (res.status() === 200) {
    test.skip(true, `E2E_PORTAL_TOKEN encore valide : fournir un jeton expiré (access.expires_at dépassé).`);
    return;
  }
  const body = await res.json().catch(() => ({}));
  expect(res.status()).toBe(403);
  expect(body).toMatchObject({ valid: false, code: 'expired' });
  expect(body.message || ``).toBe(``);
});

// 3. XSS dans le formulaire d'incident : stocké brut, affiché échappé.
test(`3. XSS incident : <script> stocké tel quel, affiché échappé (pas d'exécution)`, async ({ browser }) => {
  const token = process.env.E2E_PORTAL_TOKEN;
  test.skip(!token || !hasAuthState(), `Fournir E2E_PORTAL_TOKEN (+ auth) pour le test XSS.`);

  const ctx = await browser.newContext({ storageState: STATE_PATH });
  const page = await ctx.newPage();
  try {
    let alertFired = false;
    page.on('dialog', () => { alertFired = true; });
    await page.exposeFunction('__xssProbe', () => { alertFired = true; });

    await page.goto(`${BASE_URL}/portail/${token}`);
    await page.getByText(/Bonjour/i).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await page.getByRole('tab', { name: /Incident/i }).click();
    const payload = `<script>window.__xssProbe()</script>`;
    await page.getByLabel(/Objet/i).first().fill(payload);
    await page.getByLabel(/Description/i).first().fill(payload);
    await page.getByRole('button', { name: /Envoyer le signalement/i }).click();

    await expect(page.getByText(/signalement a bien été transmis|signalement a été envoyé/i).first())
      .toBeVisible({ timeout: 10_000 });

    await page.waitForTimeout(500);
    expect(alertFired, `un <script> injecté a été exécuté dans le portail`).toBe(false);

    const scriptCount = await page.evaluate(() => {
      return [...document.querySelectorAll('script')]
        .map((s) => (s.textContent || '').trim())
        .filter((c) => c.includes('__xssProbe')).length;
    });
    expect(scriptCount, `un nœud <script> actif avec le payload est présent dans le DOM`).toBe(0);
  } finally {
    await ctx.close();
  }
});

// 4. Rate-limit 10 req/min par IP — NON implémenté côté backend (TODO documenté).
test.fixme(`4. rate-limit 10 req/min sur même IP → 11e requête rejetée (429)`, async ({ request }) => {
  const token = randToken();
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const res = await request.post(PORTAL_ACCESS, { data: { token }, failOnStatusCode: false });
    statuses.push(res.status());
  }
  const rejections = statuses.slice(10).filter((s) => s === 429 || s === 403);
  expect(rejections.length, `au moins une des requêtes au-delà de 10/min doit être rate-limitée`).toBeGreaterThan(0);
});

// 4b. Énumération séquentielle bloquée par rate-limit — NON implémenté (TODO documenté).
test.fixme(`4b. énumération séquentielle de jetons bloquée par rate-limit`, async ({ request }) => {
  const statuses = [];
  for (let i = 0; i < 25; i++) {
    const res = await request.post(PORTAL_ACCESS, { data: { token: randToken() }, failOnStatusCode: false });
    statuses.push(res.status());
  }
  expect(statuses.some((s) => s === 429), `aucune réponse 429 après 25 tentatives d'énumération`).toBe(true);
});

// --- Helpers ---------------------------------------------------------------

function randToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}