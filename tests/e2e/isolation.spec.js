import { test, expect } from '@playwright/test';

// SÉCURITÉ E2E — scénario USER_A / USER_B (isolation multi-utilisateurs).
//
// Vérifie que USER_A ne peut voir, via l'interface, aucune donnée de USER_B :
//   - USER_A crée un bien ;
//   - USER_B se connecte dans un second contexte et ne voit PAS ce bien
//     dans son tableau de bord (la liste des biens doit l'exclure).
//
// Prérequis : deux états de session distincts
//   E2E_USER_A_STORAGE=/chemin/a.json
//   E2E_USER_B_STORAGE=/chemin/b.json
// Sans ces deux variables, le scénario est ignoré (test.skip).
const A = process.env.E2E_USER_A_STORAGE;
const B = process.env.E2E_USER_B_STORAGE;
const uniq = `ISO-${Date.now()}`;

test.beforeAll(() => {
  test.skip(!A || !B, 'E2E_USER_A_STORAGE / E2E_USER_B_STORAGE manquants : scénario USER_A/USER_B ignoré.');
});

test('USER_A crée un bien que USER_B ne peut pas voir (isolation)', async ({ browser }) => {
  test.skip(!A || !B);

  // 1) USER_A crée un bien identifiable.
  const ctxA = await browser.newContext({ storageState: A });
  const pageA = await ctxA.newPage();
  await pageA.goto('/biens/nouveau');
  await pageA.getByLabel(/nom du bien|nom/i).first().fill(`ISO-A ${uniq}`);
  await pageA.getByRole('button', { name: /créer|créer le bien|enregistrer|valider/i }).first().click();
  await pageA.waitForURL(/\/biens\//, { timeout: 15000 });

  // 2) USER_B se connecte et liste ses biens.
  const ctxB = await browser.newContext({ storageState: B });
  const pageB = await ctxB.newPage();
  await pageB.goto('/biens');
  await pageB.waitForLoadState('networkidle');
  // Le bien d'A ne doit JAMAIS apparaître dans la liste de B.
  await expect(pageB.getByText(`ISO-A ${uniq}`)).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});