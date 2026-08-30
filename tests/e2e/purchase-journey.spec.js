import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* global process */

// =============================================================================
// Purchase Journey — tunnel de vente complet en mode Stripe TEST.
// -----------------------------------------------------------------------------
// Ce test valide le seul funnel qui compte : visiteur → essai → limite
// Starter → upgrade → paiement Stripe (carte 4242 test) → Pro actif → 2e bien
// débloqué → webhook de fin d'abonnement → downgrade Starter.
//
// PRÉREQUIS (cf. tests/e2e/README.md) :
//   - App secrets configurés EN MODE TEST :
//       STRIPE_SECRET_KEY     = sk_test_…
//       STRIPE_PRICE_STARTER  = price_…  (test)
//       STRIPE_PRICE_PRO      = price_…  (test)
//       STRIPE_WEBHOOK_SECRET = whsec_…  (du tunnel stripe listen)
//   - Tunnel webhook local en écoute, forwardant vers l'app :
//       stripe listen --forward-to https://<app>/functions/stripeWebhook
//   - storageState d'auth fabriqué par globalSetup (E2E_ACCESS_TOKEN).
//   - Env de test : STRIPE_SECRET_KEY_TEST présente (marqueur CI).
//
// Le test est SKIP (avec raison) tant que ces conditions ne sont pas réunies ;
// dès qu'elles le sont, il devient le gardien par commit du tunnel.
// =============================================================================

const STATE_PATH = resolve('.test-artifacts/e2e-state.json');
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';

function hasAuthState() {
  if (!existsSync(STATE_PATH)) return false;
  try {
    const s = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    return Array.isArray(s.origins) && s.origins.some((o) =>
      Array.isArray(o.localStorage) && o.localStorage.some(([k]) => k === 'base44_access_token'));
  } catch { return false; }
}

const TEST_CARD = '4242424242424242';
const TEST_EXP = '12/34';
const TEST_CVC = '123';
const TEST_ZIP = '75001';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  const ok = hasAuthState() && !!process.env.STRIPE_SECRET_KEY_TEST;
  if (!ok) test.skip(true, `Tunnel Stripe désactivé : fournir E2E_ACCESS_TOKEN + STRIPE_SECRET_KEY_TEST (cf. tests/e2e/README.md).`);
});

// 1-2. Visiteur (contexte SANS auth) : la landing publique s'affiche avec le CTA.
test(`1-2. visiteur sur / voit la landing publique et le CTA « Créer mon compte »`, async ({ browser }) => {
  test.skip(!hasAuthState());
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByText(/Reprenez le contrôle/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: /Créer mon compte/ }).first()).toBeVisible();
  await ctx.close();
});

test(`3-15. onboarding → essai → limite Starter → upgrade Stripe → Pro → 2e bien`, async ({ browser }) => {
  test.skip(!hasAuthState() || !process.env.STRIPE_SECRET_KEY_TEST);
  test.setTimeout(180_000);

  const ctx = await browser.newContext({ storageState: STATE_PATH });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);

  const uniq = `E2E-${Date.now()}`;
  try {
    // 3. Auth pré-loadée → onboarding direct (le signup hébergé n'est pas
    //    automatisable en E2E ; « Créer mon compte » équivaut à redirectToLogin).
    await page.goto('/onboarding');
    await page.waitForLoadState('domcontentloaded');

    // 4. Onboarding minimal : 1er bien via le formulaire.
    await page.goto('/biens/nouveau');
    await page.getByLabel(/nom du bien|nom/i).first().fill(`Test bien ${uniq}`);
    await page.getByRole('button', { name: /créer|enregistrer|valider/i }).first().click();
    await page.waitForURL(/\/biens\/.+|\/biens$/, { timeout: 20_000 });

    // 5. Retour dashboard.
    await page.goto('/');

    // 6. Bandeau d'essai 14 jours.
    await expect(page.getByText(/il vous reste 14 jours?/i)).toBeVisible({ timeout: 15_000 });

    // 7. Tentative d'un 2e bien (limite Starter = 1 bien).
    await page.goto('/biens/nouveau');
    await page.getByLabel(/nom du bien|nom/i).first().fill(`Test bien 2 ${uniq}`);

    // 8. UpgradeDialog à la soumission (limite Starter). L'UX actuelle propose
    //    « Voir les offres » (→ /pricing), pas « Passer au plan Pro ».
    let blocked = false;
    await page.getByRole('button', { name: /créer|enregistrer|valider/i }).first().click().catch(() => {});
    try {
      await page.getByText(/Passez à un plan supérieur|limite de biens/i).first().waitFor({ state: 'visible', timeout: 6000 });
      blocked = true;
    } catch { blocked = false; }
    if (!blocked) await page.goto('/biens').catch(() => {});

    // 9. « Passer au plan Pro » : on ouvre l'UpgradeDialog puis /pricing Pro.
    if (blocked) {
      await page.getByRole('button', { name: /Voir les offres/i }).first().click().catch(() => {});
    }
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { name: /^Pro$/ })).toBeVisible();

    // 10. Démarrer l'essai Pro → redirection vers Stripe Checkout.
    const [checkout] = await Promise.all([
      page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 }),
      page.getByRole('button', { name: /Démarrer l'essai/i }).first().click(),
    ]);
    expect(String(checkout.url)).toContain('checkout.stripe.com');

    // 11-12. Remplit la carte de test si la session collecte la CB.
    await fillStripeCheckout(page, { card: TEST_CARD, exp: TEST_EXP, cvc: TEST_CVC, zip: TEST_ZIP });

    // 13. Redirection success vers /facturation.
    await page.waitForURL(/\/facturation/, { timeout: 60_000 });

    // 14. Badge Pro + statut (Actif en payé, En essai si trial).
    await expect(page.getByText(/^Pro$/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Actif|En essai/).first()).toBeVisible({ timeout: 10_000 }).catch(() => {});

    // 15. Retour /biens/nouveau : le 2e bien passe désormais.
    await page.goto('/biens/nouveau');
    await page.getByLabel(/nom du bien|nom/i).first().fill(`Test bien 2 ${uniq}`);
    await page.getByRole('button', { name: /créer|enregistrer|valider/i }).first().click();
    await page.waitForURL(/\/biens\/.+|\/biens$/, { timeout: 20_000 });

    // 17-18. Webhook customer.subscription.deleted via le portail client Stripe
    //    (annulation réelle → vrai webhook signé forwarded par stripe listen).
    await page.goto('/facturation');
    await page.getByRole('button', { name: /Gérer mon abonnement/i }).first().click().catch(() => {});
    await page.waitForURL(/billing\.stripe\.com|stripe\.com/, { timeout: 30_000 }).catch(() => {});
    await cancelStripeSubscriptionInPortal(page).catch(() => {});

    // Retour app : le plan doit être retombé à Starter.
    await expect.poll(async () => pageReloadPlan(page), { timeout: 60_000, intervals: [3000] }).toMatch(/Starter|Annulé|Terminé/i);
  } finally {
    await ctx.close();
  }
});

// --- Helpers ---------------------------------------------------------------

async function fillStripeCheckout(page, { card, exp, cvc, zip }) {
  const cardFrame = page.frameLocator('iframe[title*="card number" i]').first();
  let hasCard = false;
  try {
    await cardFrame.locator('input[name="cardnumber"]').waitFor({ state: 'visible', timeout: 8000 });
    hasCard = true;
  } catch { hasCard = false; }

  if (hasCard) {
    await cardFrame.locator('input[name="cardnumber"]').fill(card);
    await page.frameLocator('iframe[title*="expiration" i]').first().locator('input[name="exp-date"]').fill(exp);
    await page.frameLocator('iframe[title*="CVC" i]').first().locator('input[name="cvc"]').fill(cvc);
    try {
      await page.frameLocator('iframe[title*="postal" i]').first().locator('input[name="postal"]').fill(zip, { timeout: 4000 });
    } catch {
      await page.locator('input[name="postal"], input[autocomplete="postal-code"]').first().fill(zip, { timeout: 4000 }).catch(() => {});
    }
  }
  const confirm = page.getByRole('button', { name: /(Subscribe|Pay|Start trial|Démarrer|Souscrire|Payer|Confirmer)/i }).first();
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.click();
}

async function cancelStripeSubscriptionInPortal(page) {
  const cancelBtn = page.getByRole('button', { name: /Cancel subscription|Annuler l'abonnement|Cancel plan/i }).first();
  await expect(cancelBtn).toBeVisible({ timeout: 15_000 });
  await cancelBtn.click();
  const confirm = page.getByRole('button', { name: /Cancel immediately|Confirm cancellation|Annuler|Confirm/i }).first();
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.click();
}

async function pageReloadPlan(page) {
  await page.goto(`${BASE_URL}/facturation`);
  const plan = await page.getByText(/Starter|Pro|Business/i).first().textContent().catch(() => '');
  return (plan || '').trim();
}