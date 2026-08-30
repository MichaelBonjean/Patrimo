import React from 'react';
import LegalShell from '@/components/legal/LegalShell';
import { EDITOR } from '@/lib/legalDocs';

const CATS = [
  {
    name: 'Identité du bailleur (compte)',
    nature: 'Nom, prénom, email, rôle patrimoine, préférences d\u2019affichage.',
    finalite: 'Création et gestion du compte, facturation, accès au Service.',
    base: 'Exécution du contrat (art. 6.1.b) et obligation légale comptable.',
    duree: 'Durée d\u2019utilisation + 3 ans après clôture, puis purge.',
    destin: 'Base44 (hébergeur/processor), Stripe (paiements).',
  },
  {
    name: 'Coordonnées des locataires',
    nature: 'Nom, email, téléphone, adresse du logement (saisie par le bailleur).',
    finalite: 'Gestion des baux, quittances, recouvrement, portail locataire.',
    base: 'Exécution du contrat + intérêt légitime de gestion locative.',
    duree: '3 ans après la fin du bail (prescription locative), puis purge automatique.',
    destin: 'Base44, locataires via le portail (sur invitation du bailleur).',
  },
  {
    name: 'Données financières (IBAN / relevés)',
    nature: 'IBAN (si import bancaire saisi), opérations bancaires agrégées, paiements affectés.',
    finalite: 'Rapprochement des loyers, suivi de trésorerie, rapports comptables.',
    base: 'Exécution du contrat + intérêt légitime.',
    duree: '10 ans après la fin du contrat (obligations comptables), puis purge.',
    destin: 'Base44. L\u2019IBAN n\u2019est jamais transmis hors du sous-traitant d\u2019hébergement.',
  },
  {
    name: 'Documents (coffre)',
    nature: 'Bails, états des lieux, quittances, DPE, assurances, actes, factures, relevés.',
    finalite: 'Conservation contractuelle, alertes d\u2019expiration, portail locataire.',
    base: 'Exécution du contrat + obligations légales de conservation.',
    duree: 'Selon la nature (10 ans comptables, durée du bail + 3 ans pour les documents locatifs), puis purge.',
    destin: 'Base44 (stockage chiffré).',
  },
  {
    name: 'Données d\u2019usage et de journalisation',
    nature: 'Journaux d\u2019audit, actions sensibles, identifiants de session.',
    finalite: 'Sécurité, traçabilité, conformité, prévention de la fraude.',
    base: 'Intérêt légitime de sécurité + obligations légales.',
    duree: '12 mois pour les logs d\u2019accès, durée légale pour l\u2019audit patrimonial.',
    destin: 'Base44.',
  },
  {
    name: 'Cookies',
    nature: 'Cookies techniques de session uniquement.',
    finalite: 'Maintien de la session et des préférences d\u2019affichage.',
    base: 'Consentement implicite (essentiels) — aucun cookie de suivi n\u2019est déposé.',
    duree: 'Durée de la session, supprimés à la déconnexion.',
    destin: 'Base44. Aucun tiers publicitaire ou d\u2019analyse.',
  },
];

export default function Confidentialite() {
  return (
    <LegalShell docKey="confidentialite" title="Politique de confidentialité" maxWidth="3xl">
      <p>
        La présente politique décrit la manière dont <strong>{EDITOR.editor_name}</strong> (ci-après « l\u2019éditeur »)
        traite les données personnelles des utilisateurs et de leurs locataires dans le cadre du Service Patrimo.
        L\u2019éditeur est responsable du traitement ; la plateforme <strong>{EDITOR.host.name}</strong> agit en
        qualité de sous-traitant (voir le <a href="/dpa">contrat de sous-traitance</a>).
      </p>

      <h2>1. Catégories de données traitées</h2>
      <table className="legal-table">
        <thead>
          <tr><th>Catégorie / Nature</th><th>Finalité</th><th>Base légale</th><th>Durée de conservation</th><th>Destinataires</th></tr>
        </thead>
        <tbody>
          {CATS.map((c) => (
            <tr key={c.name}>
              <td><strong>{c.name}</strong><br />{c.nature}</td>
              <td>{c.finalite}</td>
              <td>{c.base}</td>
              <td>{c.duree}</td>
              <td>{c.destin}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>2. Sous-traitants et transferts</h2>
      <ul>
        <li><strong>{EDITOR.host.name}</strong> — hébergement et stockage des données ({EDITOR.host.country}). Un <a href="/dpa">contrat de sous-traitance (DPA)</a> est en place.</li>
        <li><strong>Stripe</strong> — traitement des paiements, en qualité de sous-traitant, conformément à ses propres certifications (PCI-DSS).</li>
        <li>Aucune donnée n\u2019est vendue ni cédée à un tiers à des fins commerciales.</li>
      </ul>

      <h2>3. Vos droits</h2>
      <p>Conformément aux articles 15 à 22 du RGPD, vous disposez des droits suivants :</p>
      <ul>
        <li><strong>Accès</strong> — obtenir une copie de vos données (bouton « Télécharger toutes mes données » dans Facturation).</li>
        <li><strong>Rectification</strong> — corriger des données inexactes.</li>
        <li><strong>Effacement</strong> (« droit à l\u2019oubli ») — demander la suppression de votre compte et de vos données (bouton « Supprimer mon compte » dans Facturation, purge sous 30 jours).</li>
        <li><strong>Portabilité</strong> — recevoir vos données dans un format structuré (export JSON).</li>
        <li><strong>Opposition</strong> — au traitement fondé sur l\u2019intérêt légitime.</li>
        <li><strong>Retrait du consentement</strong> — pour les traitements fondés sur le consentement, à tout moment.</li>
      </ul>
      <p>
        Pour exercer ces droits, contactez le DPO : <strong>{EDITOR.dpo_email}</strong>. Vous pouvez également
        introduire une réclamation auprès de la CNIL (<a href="https://www.cnil.fr" target="_blank" rel="noreferrer">www.cnil.fr</a>).
      </p>

      <h2>4. Sécurité</h2>
      <ul>
        <li>Données chiffrées en transit (TLS) et au repos sur l\u2019infrastructure d\u2019hébergement.</li>
        <li>Isolation multi-utilisateurs (chaque bailleur ne voit que ses propres données).</li>
        <li>Journaux d\u2019audit des actions sensibles (création, modification, suppression).</li>
      </ul>

      <h2>5. Conservation et purge</h2>
      <p>
        À l\u2019issue des durées ci-dessus, les données sont purgées automatiquement. Une suppression anticipée peut
        être demandée à tout moment via le bouton « Supprimer mon compte » : un délai de rétention de 30 jours
        s\u2019applique (récupération possible), au-delà duquel la purge devient définitive.
      </p>
    </LegalShell>
  );
}