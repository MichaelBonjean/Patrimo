import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STATE_PATH = resolve('.test-artifacts/e2e-state.json');

function hasAuthState() {
  if (!existsSync(STATE_PATH)) return false;
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    return Array.isArray(s.origins) && s.origins.some((o) =>
      Array.isArray(o.localStorage) && o.localStorage.some(([k]) => k === 'base44_access_token'));
  } catch { return false; }
}

// Smoke test — toujours exécuté (aucune auth requise).
// Vérifie que l'application démarre et que la page d'accueil/login répond.
test('l’application démarre et renvoie une page', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status(), 'la page / doit répondre').toBeLessThan(500);
  // Le serveur Vite sert l'app (HTML), puis le client hydrate React.
  await expect(page).toHaveTitle(/.+/);
});

test('le manifeste et la ressource principale sont servis', async ({ page }) => {
  const res = await page.goto('/');
  expect(res).not.toBeNull();
  // Le script principal de l'app doit être présent dans le DOM.
  const mainScript = page.locator('script[type="module"][src^="/src/main"]');
  await expect(mainScript).toHaveCount(1);
});

// "/" sert la Landing publique pour les visiteurs non authentifiés.
test('visiteur non authentifié sur / voit la landing publique', async ({ browser }) => {
  const ctx = await browser.newContext(); // aucun storageState → pas de jeton
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByText(/Reprenez le contrôle/)).toBeVisible({ timeout: 15_000 });
  await ctx.close();
});

// "/" sert le Dashboard pour les utilisateurs authentifiés.
test('utilisateur authentifié sur / voit le tableau de bord', async ({ browser }) => {
  test.skip(!hasAuthState(), "Pas de storageState d'auth : fournir E2E_ACCESS_TOKEN au globalSetup.");
  const ctx = await browser.newContext({ storageState: STATE_PATH });
  const page = await ctx.newPage();
  await page.goto('/');
  // Le heading dépend du portefeuille : "Tableau de bord" (vide) ou
  // "Cockpit investisseur" (biens présents). Les deux attestent du dashboard.
  await expect(page.getByRole('heading', { name: /Tableau de bord|Cockpit investisseur/ })).toBeVisible({ timeout: 20_000 });
  await ctx.close();
});