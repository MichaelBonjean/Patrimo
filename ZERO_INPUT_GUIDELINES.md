# ZERO INPUT — Principe produit Patrimo

> Faire le maximum automatiquement, demander le minimum nécessaire.

## 1. Principe

Avant d'ajouter un champ, un bouton ou une étape demandant une action
utilisateur, vérifier successivement si l'information peut être :

1. **extraite d'un document** (OCR / classification IA → pipeline *Document First*) ;
2. **obtenue d'une donnée déjà connue** (bien/lot/bail lié, snapshot, propriétaire) ;
3. **déduite** (règles métier : statut de bail depuis dates, DPE bloquant l'indexation,mensualité depuis capital/taux/durée…) ;
4. **calculée** (cashflow, NOI, rendements, service de la dette, IRL…) ;
5. **obtenue via une API** (IRL/ILC/ILAT publics, géocodage adresse, SIRET/SIREN) ;
6. **récupérée depuis la banque** (relevé → BankTransaction → rapprochement) ;
7. **mémorisée à partir d'une décision précédente** (préférence, règle, dernier choix).

La saisie manuelle n'est utilisée **qu'en dernier recours**.

## 2. Priorités (ordre strict)

1. **Fiabilité** — jamais enregistrer une donnée incertaine comme certaine.
2. **Automatisation** — réduire la saisie tant que la fiabilité est garantie.
3. **Simplicité** — moins de champs, moins d'étapes, moins de friction.

> *Zero Input* **ne signifie pas** « tout enregistrer automatiquement » :
> la **validation humaine reste obligatoire** dès qu'un risque existe
> (montant financier, identité d'un locataire, clause contractuelle, donnée
> fiscale…). L'IA propose, l'humain valide — sauf confiance élevée prouvée et
> réversible.

## 3. Règle de revue produit

Toute nouvelle fonctionnalité ou tout nouveau champ expose, dans sa
description de PR / sa fiche de spec :

- la **liste des champs** demandés à l'utilisateur ;
- pour **chaque champ**, la **justification** expliquant pourquoi aucune des
  7 sources ci-dessus ne peut le fournir de façon fiable ;
- le **niveau de confiance requis** pour une auto-application éventuelle
  (et le seuil en dessous duquel la validation humaine s'impose).

Si un champ peut être satisfait par l'une des sources ci-dessus, l'automatiser
est **obligatoire** ; la PR ne doit accepter une saisie que si toutes les
voies d'automatisation ont été écartées et motivées.

### Checklist (à coller dans la spec)

```
- [ ] Ce champ ne peut pas être extrait d'un document ?    → justifier
- [ ] Ce champ ne peut pas être déduit d'une donnée connue ? → justifier
- [ ] Ce champ ne peut pas être calculé ?                   → justifier
- [ ] Ce champ ne peut pas être obtenu via une API publique ? → justifier
- [ ] Ce champ ne peut pas être rapproché depuis la banque ? → justifier
- [ ] Ce champ ne peut pas être mémorisé d'un choix antérieur ? → justifier
- [ ] Si auto-appliqué : seuil de confiance ≥ ___ et réversibilité confirmée
```

## 4. Audit des principaux workflows

Format : **champs demandés → automatisables → restant manuel → justification.**

### 4.1 Onboarding (`src/pages/Onboarding.jsx`)

Actuellement un parcours guidé en 8 étapes (premier bien → import Excel biens →
lots → prêts → baux → transactions → rapprochement → dashboard).

- **Demandé** : nom du premier bien, catégorie, ville, prix (via `QuickPropertyForm`) ;
  choix du prêt (montant, taux, durée, assurance) ; déclenchements d'imports.
- **Automatisable** : le « premier bien » lui-même peut être créé **à partir
  d'un seul document d'acte de vente** notarié (adresse, prix, notaire, date
  d'acquisition) via le pipeline *Document First* — aujourd'hui utilisé côté
  coffre, pas encore branché en première étape d'onboarding. Le prêt peut être
  extrait d'une **offre de prêt bancaire** (déjà classée par l'IA).
- **Restant manuel** : aucune information de structure commerciale/fiscale
  devrait être demandée à l'arrivée ; **le seul choix humain irréductible** est
  la **structure de détention** et le **régime fiscal** (intention du bailleur,
  non déductible d'un document).
- **Justification** : choix de structuration = décision juridique personnelle ;
  aucun document ne la révèle de façon fiable (un acte décrit l'existant, pas
  l'intention fiscale).
- **Recommandation** : onboarding = « déposez votre acte de vente + votre
  offre de prêt », valider 2 enrichissements IA, puis dashboard. La création
  manuelle du premier bien devient un repli.

### 4.2 Création d'un bien (`PropertyFormFields.jsx` + `property.schema.js`)

~40 champsv : identité, structure/fiscalité, acquisition, financement, charges
annuelles, contacts, notes.

- **Demandé** : nom, catégorie, surface, adresse, CP, ville, structure, régime
  fiscal, tous les montants d'acquisition, tout le bloc prêt, toutes les
  charges annuelles, 3 contacts, notes.
- **Automatisable** :
  - *Adresse / ville / CP / coordonnées* : géocodage inverse depuis un
    *acte de vente* (déjà extrait par *Document First*) ou input minimal
    « adresse complète » → API de geocoding → CP/ville déduits.
  - *Acquisition* (prix, notaire, agence, travaux, date) : issus de l'acte
    notarié.
  - *Financement* (montant, taux, durée, mensualité, assurance, différé, date
    début) : issus de l'offre de prêt + tableau d'amortissement.
  - *Charges annuelles* (taxe foncière, PNO, copro, gestion, comptable) :
    issues de factures / appels de fonds / taxe (déjà classés par l'IA), ou
    **récupérées depuis la banque** (moyenne glissante des transactions de la
    catégorie correspondante).
  - *Mensualité* : **calculée** du prêt (capital + taux + durée + différé) —
    ne doit jamais être demandée si ces 3 conditions sont remplies.
  - *Contacts notaire/syndic/gestionnaire* : extraits des documents associés.
  - *SCI* : sélection d'un template déjà mémorisé (`SCITemplate`) — déjà
    partiellement automatisé (auto-remplissage au choix).
- **Restant manuel** :
  - **Nom du bien** (libellé libre du bailleur — pure préférence).
  - **Structure de détention** + **régime fiscal** (intention, cf. 4.1).
  - **Valeur estimée actuelle** (subjective, non documentée).
- **Justification** : tout le bloc acquisition + financement + charges +
  contacts est documenté ou bancaire ; aucune saisie manuelle ne devrait y
  subsister hors repli. Le nom est un choix esthétique du bailleur.

### 4.3 Création d'un lot (`lot.schema.js`, `QuickTenantForm` via eager)

Champs : désignation, code, étage, typologie, surface, type de bail, loyer HC,
charges, caution, coordonnées locataire, dates d'entrée/sortie, DPE/GES,
consommation, meublé, accès, vacant.

- **Demandé** : l'ensemble ci-dessus.
- **Automatisable** :
  - *Typologie / surface* : depuis **DPE** (classification + surface).
  - *DPE/GES / consommation / date DPE* : extraits du **diagnostic DPE**.
  - *Bail (date d'effet, type, loyer HC, charges, caution, meublé, jour
    d'échéance)* : extraits du **bail (bail_alur)** — le cas d'usage
    central du pipeline *Document First*.
  - *Locataire (nom, email, téléphone, entrée)* : extraits du bail ;
    sortie = déduite du bail suivant s'il existe.
  - *Meublé* : déduit du `lease_type` (Meublé / Bail mobilité / Saisonnier).
  - *Vacant* : **déduit** (aucun bail actif sur le lot → vacant).
  - *Code/accès* : reste libre (non présent dans un document normalisé).
- **Restant manuel** : désignation (libellé du bailleur), accès/immeuble si
  non documentés.
- **Justification** : la grande majorité est **document-driven** (bail + DPE).
  Les champs legacy `tenant_name/rent_excluding_charges/…` sur Lot sont
  **dépréciés** (cf. décisions du projet) : la source unique est `Lease`.
  Aucune création de lot manuelle ne devrait exiger loyers/locataires
  séparément du bail.

### 4.4 Création d'un bail (`LeaseForm.jsx`)

- **Demandé** : type, date d'effet, date de fin, loyer HC, charges, caution,
  jour d'échéance, fréquence, indexation (type + référence + dates de
  révision), locataires (nom + dates + email + téléphone), meublé, notes.
- **Automatisable** :
  - Type, dates, loyer HC, charges, caution, indexation, référence d'index :
    **extraits du bail** (`bail_alur`).
  - `furnished` : **déduit** du `lease_type`.
  - **Statut (futur/actif/termine/resilie)** : déjà **calculé** par
    `computeLeaseStatus` (dates + statut explicite).
  - **Prochaine révision** : déjà **calculée** (anniversaire du bail +
    dernière révision) — ne devrait jamais être demandée.
  - Locataire (nom/contacts) : extrait du bail. Email/ téléphone restent
    sujets à validation (légitimité de contact, opt-in).
- **Restant manuel** : validation des données extraites par l'IA
  (surtout montants et identité, sensibles), corrections éventuelles,
  notes/clauses particulières (libre).
- **Justification** : le bail est un document formel ; sa création doit
  prioritairement résulter d'un import + validation, pas d'une saisie à
  blanc. Le statut et la prochaine révision sont calculés — ne pas les
  demander.

### 4.5 Prêt / Loan (`QuickLoanForm.jsx` + machine de prêt)

- **Demandé** : bien concerné, montant, taux, durée, date de début, assurance
  mensuelle.
- **Automatisable** :
  - Montant, taux, durée, date de début, assurance : **extraits de l'offre de
    prêt** (`offre_pret_bancaire`) et du **tableau d'amortissement**
    (`tableau_amortissement`).
  - **Mensualité hors assurance** : **calculée** (capital + taux + durée +
    différé) — déjà géré par le moteur de prêt (`loanEngine`). Ne pas la
    demander si les 4 conditions sont présentes.
  - **Capital restant dû** : calculé à partir du tableau d'amortissement +
  date courante. Ne pas demander.
  - Assurance du prêt : sourçable depuis l'offre ou les transactions
    bancaires (`loan_insurance`).
- **Restant manuel** : associer le prêt à un bien quand le prêt couvre
  plusieurs biens (choix de répartition), et valider les chiffres extraits.
- **Justification** : offres de prêt et tableaux d'amortissement existent
  systématiquement. La mensualité et le CRD sont des calculs purs.

### 4.6 Paiement / Payment (`PaymentDialog.jsx`)

- **Demandé** : date, montant, type de payeur, moyen, nom payeur, référence,
  notes.
- **Automatisable** :
  - La quasi-totalité est **récupérée depuis la banque** (BankTransaction →
    rapprochement), avec **catégorisation IA** + reconnaissance du payeur
    (libellé bancaire). Le moteur `recordPayment` répartit déjà
    automatiquement sur les échéances les plus anciennes.
  - `payer_type` : déductible du libellé (CAF / locataire) via règles.
  - `method` : déduite du libellé bancaire (virement/sépacialement Mobile).
  - `payment_date` : la **vraie date** de l'opération bancaire (jamais le 1er
    du mois) — déjà la politique en place.
- **Restant manuel** : paiements en espèces / chèques non bancarisés
  (saisie ponctuelle), et correction du rapprochement automatique quand
  ambiguïté.
- **Justification** : tout paiement encaissé passe par la banque. Le
  dialogue manuel ne doit s'afficher que pour les cas hors banque ou pour
  corriger/affecter — pas pour la saisie systématique.

### 4.7 Charges (`ChargeRegularization` + `VentilationEditor.jsx`)

- **Demandé** : ventilation par catégorie de charges récupérables (catégorie
  + montant + note), justificatifs.
- **Automatisable** :
  - `provisions_collected` (provisions encaissées sur l'année) : **calculées**
    à partir des `RentDue.charges` (déjà automatisé).
  - `recoverable_total` + ventilation : **extraits des factures / appels de
    fonds de copropriété** (`ag_copropriete`) et des factures (eaux, ordures,
    entretien) — cas d'usage central du pipeline *Document First*.
  - TEOM : souvent identifiable sur l'avis de taxe foncière.
  - `solde` / `direction` : **calculés** (récupérable − provisions).
- **Restant manuel** : rattacher chaque facture à la bonne catégorie quand
  l'IA hésite ; joindre / valider les justificatifs (obligation légale
  transparence charges) ; valider le solde avant affectation locative.
- **Justification** : le calcul pur (solde, direction, provisions) ne doit
  jamais être demandé. La ventilation reste humaine car elle engage le
  locataire financièrement — validation obligatoire même si proposée.

### 4.8 Détenteurs (`HoldersSettings.jsx`)

- **Demandé** : personnes morales (nom, type, SIRET, capital, création,
  banque, email), personnes physiques (nom, email, téléphone, adresse),
  liens d'appartenance (parent → membre × pourcentage).
- **Automatisable** :
  - Personnes morales : **mémorisées** via `SCITemplate` (déjà possible) et
    surtout **extraits des `sci_statuts_kbis`** (statuts + Kbis).
  - SIRET / capital / date création / banque : issus du Kbis / des statuts.
  - Personnes physiques : identifiables dans l'**acte de vente**, les statuts
    de SCI et le bail (locataires ≠ détenteurs : ne pas confondre).
  - Lien d'appartenance + parts : extraits des **statuts** de la SCI.
- **Restant manuel** : les parts réelles peuvent diverger de la répartition
  légale (conventions de quasi-usufruit, nu-propriété). Valider les
  pourcentements issus de l'extraction.
- **Justification** : un portefeuille détenu en SCI/SARL dispose
  systématiquement de statuts + Kbis — la saisie d'une structure à la main
  doit être l'exception (configuration initiale avant réception des statuts).

### 4.9 Documents (`Documents.jsx` + pipeline *Document First*)

- **Demandé** : téléversement du fichier uniquement (le reste est validé, pas
  saisi).
- **Automatisable** :
  - **Classification** (bail, acte, prêt, DPE, charge, taxe, relevé, Kbis…),
    **extraction** des champs par type, **proposition de commit** vers les
    entités cibles (Property/Lot/Lease/Transaction/Document), **score de
    confiance par champ**, **détection des champs sensibles** à valider :
    déjà implémenté (`ingestDocument` + `proposeDocumentCommit` + review UI).
  - *Risques*, *liens vers entités*, *meta-document* : proposés par l'IA.
- **Restant manuel** : **validation des champs sensibles** (recommandé
  obligatoire ci-dessous : loyer, montant, identité locataire, dates de bail,
  valeurs financières, données fiscales). La saisie manuelle n'intervient que
  pour **corriger** une proposition erronée.
- **Justification** : principe « l'IA propose, l'humain valide ». La confiance
  élevée sur des champs non-sensibles peut être auto-appliquée ;
  **jamais** sur un montant financier, une identité, une date d'effet
  contractuelle ou une donnée fiscale sans relecture.

### 4.10 Import bancaire (`UnifiedImporter.jsx` + pipeline CSV)

- **Demandé** : type d'import (banque / CAF / Excel / document / manuel),
  fichier(s), + pour la saisie manuelle : date, montant, bien, lot,
  catégorie, description.
- **Automatisable** :
  - Format **détecté** (CSV banque vs CAF vs Excel) + parsing RFC 4180
    (BOM, séparateurs, guillemets) — déjà en place.
  - **Dédoublonnage** par empreinte SHA-256 (`fingerprints`) — déjà en place.
  - **Catégorisation IA** de chaque ligne + **rattachement au bien/lot**
    via règles + matching libellé (`BankRule`, `aiCategorize`) — en place.
  - Lignes validées → `Transaction` catégorisée + `BankTransaction`
    rapprochée — en place.
  - **Matching paiements → échéances** automatique (fonctionne sur date /
    montant / libellé, sans action manuelle).
- **Restant manuel** :
  - le **choix du type d'import** reste explicite (intention de l'utilisateur) ;
  - corriger les lignes « à vérifier » (catégorie incertaine) ;
  - affecter une ligne à un bien quand le libellé est ambigu ;
  - la **saisie manuelle** reste un repli exclusif (opérations non bancarisées,
  création d'une opération hors import).
- **Justification** : la mécanique de détection + catégorisation + rapprochement
  supprime la quasi-saisie. La saisie manuelle « une opération » ne doit pas
  disparaître (espèces, chèque non encaissé, régularisation comptable) mais
  reste rare.

## 5. Champs NEVER auto-appliquer (validation humaine obligatoire)

| Domaine | Champs | Raison |
|---|---|---|
| Loyer / bail | `rent_excluding_charges`, `charges`, `deposit`, `date_start`, `date_end`, identité locataire | engagent financièrement + juridiquement |
| Paiement | montant affecté, échéance visée | oriente la dette locative |
| Fiscal | taxe foncière, provisions, révision IRL appliquée | impacted sur déclarations |
| Charge régul. | ventilation récupérable, solde | facturé au locataire |
| Détention | parts (`share_percent`), SIRET | répartition propriété, redevance |
| Structure | `holding_structure`, `tax_regime` | intention juridique/fiscale du bailleur |

Ces champs peuvent être **proposés** par l'IA, jamais **auto-committés** en
confiance initiale. Un seuil ≥ 0,95 + relecture visuelle sur 1 essai ne
justifie pas une auto-application définitive — la donnée reste engagée et
nécessite une validation.

## 6. Note de mise en œuvre

- Les moteurs de calcul (statut bail, prochaine révision, mensualité, CRD,
  provisions, solde de charge) sont **déjà** centralisés (`lease.js`,
  `loanEngine`, `financeEngine`, `chargeRegularization`, `rentIndexEngine`).
- Le pipeline *Document First* (`documentCommit.ts/js` + `ingestDocument` +
  `proposeDocumentCommit` + `commitDocumentImport`) couvre déjà l'extraction +
  la proposition pour Property/Lot/Lease/Transaction/Document.
- À renforcer : brancher **l'enrichissement de PropertyFormFields** depuis
  un `DocumentImport` classé (`acte_vente_notarie`, `offre_pret_bancaire`,
  `tableau_amortissement`) pour pré-remplir les blocs acquisition / prêt /
  charges, plutôt que d'exiger une saisie à 40 champs.
- À renforcer : remplacer la **première étape d'onboarding** par un « drop de
  l'acte de vente » qui crée le bien + le prêt en un seul flux validé.