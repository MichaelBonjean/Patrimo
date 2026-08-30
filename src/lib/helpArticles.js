// Base de connaissances d'aide — 10 articles fréquents (Markdown).
// Chaque article : id, title, category, excerpt, body (markdown).

export const HELP_ARTICLES = [
  {
    id: 'premier-bien',
    title: 'Ajouter mon premier bien',
    category: 'Premiers pas',
    excerpt: 'Créez votre premier bien (lot ou immeuble) pour démarrer le suivi des loyers et du cash-flow.',
    body: `## Ajouter mon premier bien

Un **bien** dans Patrimo représente soit un logement unique (lot), soit un immeuble regroupant plusieurs lots.

### Étapes
1. Allez dans **Mes biens** puis cliquez sur **Ajouter un bien**.
2. Renseignez le nom, l'adresse et la ville.
3. Ajoutez la **structure de détention** (indivision, SCI…) si pertinent.
4. Sur la fiche du bien, créez un **lot** (le logement loué) puis un **bail** (le contrat avec le locataire).

> 💡 Le cash-flow ne se calcule qu'une fois le bail rattaché à un lot.`,
  },
  {
    id: 'import-bankin',
    title: 'Importer un relevé Bankin (ou un CSV bancaire)',
    category: 'Banque',
    excerpt: 'Importez un fichier exporté de Bankin ou de votre banque pour rapprocher automatiquement vos loyers.',
    body: `## Importer un relevé bancaire

Patrimo accepte les exports **CSV** de Bankin, de votre banque, ou toute structure tabulaire.

### Marche à suivre
1. Ouvrez **Banque → Importer un fichier**.
2. Déposez le CSV. L'assistant détecte les colonnes (date, montant, libellé).
3. **Mappez** les colonnes puis validez.
4. Les transactions brutes sont catégorisées et affectées à un bien/lot.

### Dédoublonnage
Chaque ligne est fingerprintée (compte + date + montant + libellé). Les doublons exacts sont écartés automatiquement.`,
  },
  {
    id: 'quittances',
    title: 'Générer mes quittances',
    category: 'Loyers',
    excerpt: 'Émettez une quittance de loyer PDF pour un ou plusieurs paiements encaissés.',
    body: `## Générer une quittance

Une quittance atteste du paiement d'un loyer pour une période donnée.

1. Allez dans **Loyers → Quittances**.
2. Sélectionnez l'échéance concernée (mois + lot).
3. Cliquez **Générer la quittance** : un PDF A4 portrait est produit.
4. **Envoyer par email** au locataire si son adresse est renseignée.

> Une quittance **partielle** est émise si le loyer n'est qu'à moitié payé.`,
  },
  {
    id: 'indicateurs',
    title: 'Comprendre mes indicateurs',
    category: 'Analyse',
    excerpt: 'Cash-flow, rendement brut/net, DSCR, LTV : ce que chaque ratio signifie et comment l interpréter.',
    body: `## Comprendre mes indicateurs

- **Cash-flow mensuel** = loyers encaissés − charges − mensualité de prêt. Négatif = effort d'apport.
- **Rendement brut** = loyer annuel HC ÷ prix d'achat.
- **Rendement net** = (loyers − charges − foncière − prêt) ÷ prix d'achat.
- **DSCR** (Debt Service Coverage Ratio) = NOI annuel ÷ annuité de prêt. > 1,25 = sain.
- **LTV** (Loan-to-Value) = capital restant dû ÷ valeur. Plafond bancaire ~70 %.

> Le simulateur fiscal reste **indicatif** : il ne remplace pas votre expert-comptable.`,
  },
  {
    id: 'equipe',
    title: 'Ajouter un membre de mon équipe',
    category: 'Équipe',
    excerpt: 'Invitez un associé, un comptable ou un gestionnaire avec le rôle adapté.',
    body: `## Ajouter un membre d'équipe

Depuis **Réglages → Équipe**, invitez un collaborateur par email.

### Rôles disponibles
- **Propriétaire** — accès total.
- **Admin** — tout sauf facturation.
- **Associé** — lecture + écriture, pas de gestion d'équipe.
- **Comptable** — accès financier et fiscal uniquement.
- **Lecture seule** — consulte sans modifier.

L'invité reçoit un email de connexion ; il voit uniquement les données de votre patrimoine.`,
  },
  {
    id: 'paiement-manuel',
    title: 'Enregistrer un paiement manuel',
    category: 'Loyers',
    excerpt: 'Saisissez un encaissement quand il ne provient pas d un import bancaire.',
    body: `## Enregistrer un paiement

1. **Loyers → Compte locataire**, ouvrez l'échéance concernée.
2. Cliquez **Encaisser** puis saisissez montant, date et moyen de paiement.
3. Le paiement est affecté à l'échéance (ou réparti si plusieurs sont dues).

Le statut de l'échéance passe automatiquement à *payé*, *partiel* ou *trop-perçu*.`,
  },
  {
    id: 'impaye',
    title: 'Gérer un impayé (relances)',
    category: 'Recouvrement',
    excerpt: 'Suivez le workflow de relance amiable jusqu à la mise en demeure.',
    body: `## Gérer un impayé

Dès qu'une échéance n'est pas réglée à temps, Patrimo crée un **impayé** et calcule les jours de retard.

### Étapes de relance
1. **Rappel amiable** (J+5) — message courtois.
2. **2ᵉ relance** (J+15).
3. **Mise en demeure amiable** (J+30) — LRAR.
4. **Dossier professionnel** (avocat/huissier).

À chaque étape, un document est généré et horodaté dans l'historique. La régularisation clôture l'impayé.`,
  },
  {
    id: 'regularisation-charges',
    title: 'Faire la régularisation annuelle des charges',
    category: 'Loyers',
    excerpt: 'Comparez provisions encaissées et charges récupérables pour régulariser le locataire.',
    body: `## Régularisation des charges

Une fois par an, comparez :
- les **provisions** que le locataire a versées ;
- les **charges récupérables** réellement engagées (TEOM, ascenseur, eau…).

### Résultat
- **Solde dû par le locataire** → nouvelle échéance.
- **Solde à rembourser** → avoir.

Ouvrez **Loyers → Régularisation des charges**, sélectionnez l'année et le bail, saisissez la ventilation, puis validez.`,
  },
  {
    id: 'cloture-mois',
    title: 'Clôturer mon mois',
    category: 'Banque',
    excerpt: 'Verrouillez la période passée pour figer la comptabilité et générer le bilan mensuel.',
    body: `## Clôturer un mois

La clôture fige la période : plus aucune transaction ne peut être modifiée.

1. **Banque → Clôture**, choisissez le mois écoulé.
2. Vérifiez le résumé (attendu, encaissé, impayés, cash-flow).
3. **Clôturer** — un snapshot est enregistré.

> Toute clôture est **historisée** ; une réouverture est possible et tracée dans le journal.`,
  },
  {
    id: 'compte-donnees',
    title: 'Supprimer mon compte / exporter mes données',
    category: 'RGPD',
    excerpt: 'Téléchargez vos données ou demandez la suppression de votre compte sous 30 jours.',
    body: `## Données & suppression (RGPD)

### Exporter
**Facturation → Télécharger toutes mes données** génère un fichier JSON de votre patrimoine (art. 20 RGPD, portabilité).

### Supprimer
**Facturation → Supprimer mon compte** ouvre un délai de **30 jours**. Un email de confirmation avec un lien d'annulation vous est envoyé. À l'issue, l'intégralité de vos données est **définitivement purgée** (art. 17 RGPD).

Pour toute question : le bouton **Support** en bas à droite, ou **bonjour@patrimo.fr**.`,
  },
];