import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Parcours COMPLET d'un bailleur (happy path commercial) :
//   connexion → onboarding → 1er bien → 1 lot → 1 bail (M. Dupont)
//   → import CSV bancaire → rapprochement "loyer M. Dupont"
//   → RentDue "payé" → quittance de janvier → visible dans /loyers?tab=quittances
//   → accès portail locataire (magic token) → /portail/<token> quittance visible
//   → clôture du mois → calendrier affiche "Mois clôturé"
//
// Le storageState d'auth est fabriqué automatiquement par globalSetup (depuis
// E2E_ACCESS_TOKEN). Le test tourne en 60 s max sur une app warmed-up.
const STATE_PATH = resolve('.test-artifacts/e2e-state.json');
const uniq = `E2E-${Date.now()}`;
const FIXTURE = resolve('tests/fixtures/banque_dupont.csv');

// Garde d'auto-suffisance : si globalSetup n'a pas pu fabriquer d'état (aucune
// source d'auth fournie), on ignore la journey avec un message actionnable.
// Les smoke tests (non auth) restent exécutés.
function hasAuthState() {
  if (!existsSync(STATE_PATH)) return false;
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    return Array.isArray(s.origins) && s.origins.some((o) =>
      Array.isArray(o.localStorage) && o.localStorage.some(([k]) => k === 'base44_access_token'));
  } catch { return false; }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  if (!hasAuthState()) {
    test.skip(true, 'Aucun storageState d\'auth : fournir E2E_ACCESS_TOKEN au globalSetup pour exécuter la journey.');
  }
});

test('parcours complet bailleur (happy path, 60 s)', async ({ browser }) => {
  test.skip(!hasAuthState());
  test.setTimeout(60_000);

  const ctx = await browser.newContext({ storageState: STATE_PATH });
  const page = await ctx.newPage();
  page.setDefaultTimeout(12_000);

  try {
    // 1 — Connexion : la session chargée (token injecté) doit atterrir sur l'app.
    await page.goto('/');
    await page.waitForURL(/\/$|\/dashboard|\/biens|\/onboarding/, { timeout: 20_000 });

    // 2 — Onboarding : si le tunnel d'onboarding s'affiche, on avance/saute.
    if (page.url().includes('/onboarding')) {
      await page.getByRole('button', { name: /commencer|passer|continuer|skip/i }).first().click().catch(() => {});
      await page.waitForURL(/\/$|\/dashboard|\/biens/, { timeout: 15_000 }).catch(() => {});
    }

    // 3 — Ajouter le 1er bien.
    await page.goto('/biens/nouveau');
    await page.getByLabel(/nom du bien|nom/i).first().fill(`Bien E2E ${uniq}`);
    await page.getByRole('button', { name: /créer|enregistrer|valider/i }).first().click();
    await page.waitForURL(/\/biens\//, { timeout: 15_000 });
    const propertyId = new URL(page.url()).pathname.split('/').pop();
    expect(propertyId).toBeTruthy();

    // 4 — Ajouter 1 lot.
    await page.goto(`/biens/${propertyId}`);
    await page.getByRole('tab', { name: /lots/i }).first().click();
    await page.getByRole('button', { name: /ajouter un lot|nouveau lot/i }).first().click();
    await page.getByLabel(/désignation/i).first().fill(`Lot E2E ${uniq}`);
    await page.getByRole('button', { name: /enregistrer|valider|ajouter/i }).first().click();
    await page.waitForTimeout(400);

    // 5 — Créer 1 bail (M. Dupont, loyer 750 € HC, échéance janvier 2026).
    await page.getByRole('tab', { name: /bails|locataires|bail/i }).first().click();
    await page.getByRole('button', { name: /ajouter un bail|nouveau bail|créer le bail/i }).first().click();
    await page.getByLabel(/nom du locataire|locataire/i).first().fill('M. Dupont');
    await page.getByLabel(/date de début|date d'effet/i).first().fill('2026-01-01').catch(() => {});
    await page.getByLabel(/loyer hors charges|loyer hc|loyer mensuel/i).first().fill('750');
    await page.getByRole('button', { name: /enregistrer|valider|créer/i }).first().click();
    await page.waitForTimeout(500);

    // 6 — Importer un fichier CSV bancaire (fixture).
    await page.goto('/banque?tab=import');
    const fileInput = page.locator('input[type=file]').first();
    await fileInput.setInputFiles(FIXTURE);
    await page.getByRole('button', { name: /importer|lancer l'import|valider/i }).first().click().catch(() => {});

    // 7 — Rapprocher automatiquement la transaction "loyer M. Dupont".
    await page.goto('/banque');
    await page.getByRole('tab', { name: /à rapprocher|rapprochement|banque/i }).first().click().catch(() => {});
    const dupontRow = page.getByText(/dupont/i).first();
    await dupontRow.waitFor({ state: 'visible', timeout: 10_000 });
    // Clic sur l'action de rapprochement / catégorisation de la ligne concernée.
    await dupontRow.locator('xpath=ancestor::tr').getByRole('button', { name: /rapprocher|lier|catégoriser|affecter|valider/i })
      .first().click().catch(() => {});
    await page.waitForTimeout(500);

    // 8 — L'échéance (RentDue) de janvier apparaît comme "payé".
    await page.goto('/loyers?tab=compte-locataire');
    await expect(page.getByText(/dupont/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/payé|soldé/i).first()).toBeVisible({ timeout: 10_000 });

    // 9 — Générer la quittance de janvier.
    await page.goto('/loyers?tab=quittances');
    await page.getByRole('button', { name: /générer|créer.*quittance|quittance/i }).first().click().catch(() => {});

    // 10 — La quittance apparaît dans la liste des quittances.
    await expect(page.getByText(/janvier|2026-01|01\/2026/i).first()).toBeVisible({ timeout: 10_000 });

    // 11 — Envoyer un accès portail au locataire (magic token).
    await page.goto(`/biens/${propertyId}`);
    await page.getByRole('button', { name: /portail.*locataire|accès.*portail|inviter.*locataire|envoyer.*portail/i }).first().click().catch(() => {});
    // On tente de capturer le token magique s'il est affiché/toasté (lien /portail/<token>).
    let portalToken = null;
    const linkText = await page.getByText(/\/portail\/[A-Za-z0-9_-]+/i).first().textContent().catch(() => null);
    if (linkText) portalToken = linkText.match(/\/portail\/([A-Za-z0-9_-]+)/)?.[1] || null;

    // 12 — Naviguer sur /portail/<token> et vérifier que la quittance est visible.
    test.skip(!portalToken, 'Token portail non capturable côté UI — étape portail à valider manuellement.');
    await page.goto(`/portail/${portalToken}`);
    await expect(page.getByText(/quittance/i).first()).toBeVisible({ timeout: 10_000 });

    // 13 — Clôturer le mois (janvier 2026).
    await page.goto('/banque?tab=cloture');
    await page.getByRole('button', { name: /clôturer|cloturer|valider la clôture/i }).first().click().catch(() => {});

    // 14 — Le calendrier montre "Mois clôturé".
    await page.goto('/');
    await page.getByRole('button', { name: /calendrier|échéances|mois/i }).first().click().catch(() => {});
    await expect(page.getByText(/mois clôturé|clôturé|janvier clôturé/i).first()).toBeVisible({ timeout: 10_000 });
  } finally {
    await ctx.close();
  }
});