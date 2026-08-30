# Suite de tests Patrimo

Infrastructure professionnelle de tests automatiques : **Vitest** (unitaire +
intégration), **React Testing Library** (composants), **Playwright** (E2E).

## Scripts

| Commande | Description |
|---|---|
| `npm test` | Lance Vitest (unit + intégration + sécurité) |
| `npm run test:unit` | Idem, alias explicite |
| `npm run test:watch` | Vitest en mode watch |
| `npm run test:coverage` | Rapport de couverture (`coverage/`) |
| `npm run test:e2e` | Lance Playwright (`tests/e2e`) |
| `npm run build` | Build de production — **lance les tests au préalable** (hook `prebuild`) |

## Organisation

```
tests/
├─ unit/            # moteurs partagés (base44/shared) — 14 domaines
│  ├─ loanEngine.spec.js              # crédits
│  ├─ financeEngine.spec.js           # cash-flow
│  ├─ financeCategories.spec.js       # catégories
│  ├─ taxEngine.spec.js               # fiscalité
│  ├─ rentLedger.spec.js              # loyers / échéances / paiements
│  ├─ impayeDates.spec.js             # impayés (jours de retard)
│  ├─ bankTransactionDedup.spec.js    # dédoublonnage
│  ├─ ownership.spec.js              # SCI / détention
│  ├─ leaseResolve.spec.js           # bails / changement locataire
│  ├─ csvUtils.spec.js                # CSV / formats
│  ├─ dates.spec.js                  # dates (débordement, fin de mois)
│  └─ …
├─ integration/      # moteurs en bout-en-bout (mock service in-memory)
│  ├─ importToTransaction.spec.js        # import bancaire → transaction
│  ├─ paymentToEcheance.spec.js          # paiement → échéance
│  ├─ echeancePayeeToQuittance.spec.js   # échéance payée → quittance
│  ├─ echeancePartielleToImpaye.spec.js  # échéance partielle → impayé
│  └─ changementLocataire.spec.js        # changement locataire
├─ security/
│  └─ rls-isolation.spec.js   # RLS statique sur TOUTES les entités (USER_A/B)
├─ e2e/              # Playwright (navigateur réel)
│  ├─ smoke.spec.js          # toujours exécuté
│  ├─ user-journey.spec.js   # connexion → bien → lot → bail → import → quittance
│  └─ isolation.spec.js      # USER_A / USER_B (isolation UI)
└─ helpers/mockService.js    # faux `asServiceRole` in-memory
```

## Sécurité — isolation USER_A / USER_B

Garantie à deux niveaux :

1. **Statique (`tests/security/rls-isolation.spec.js`)** : chaque entité
   métier doit posséder un champ `owner_id` et une règle RLS par opération
   (`create/read/update/delete`) filtrant sur `data.owner_id === {{user.email}}`.
   Une entité oubliée fait échouer la suite → blocage du build.

2. **Runtime (`base44/functions/runIsolationTests`) + E2E
   (`tests/e2e/isolation.spec.js`)** : le scénario runtime crée des
   enregistrements chez un « autre » propriétaire et vérifie que SELF ne peut ni
   les lire, ni les modifier, ni les supprimer. Le test E2E Playwright reproduit
   le scénario côté UI avec deux contextes navigateur authentifiés.

> Prérequis E2E authentifiés : fournir des états de session Playwright via
> `E2E_STORAGE_STATE`, `E2E_USER_A_STORAGE`, `E2E_USER_B_STORAGE`. Sans ces
> variables, les specs concernées sont **ignorées** (`test.skip`) — les smoke
> tests non authentifiés s'exécutent toujours.
>
> Générer un storageState :
> `npx playwright codegen --save-storage=auth.json <url>`

## Lancement automatique avant build de production

Le hook npm `prebuild` exécute `vitest run tests/unit tests/integration tests/security`
avant `vite build`. Tout test échoué → le build s'arrête : aucune mise en
production possible sans une suite verte.

> Note : le flux de *publication* propre à la plateforme Base44 peut contourner
> `npm run build`. Pour garantir le gate en CI externe, exécutez `npm run
> test:unit && npm run build` dans votre pipeline.

## Prérequis Playwright

```bash
npx playwright install --with-deps chromium
``