import React from 'react';
import LegalShell from '@/components/legal/LegalShell';
import { EDITOR } from '@/lib/legalDocs';

export default function Cgu() {
  return (
    <LegalShell docKey="cgu" title="Conditions Générales d'Utilisation">
      <h2>1. Éditeur du service</h2>
      <p>
        Le service Patrimo (ci-après « le Service ») est édité par{' '}
        <strong>{EDITOR.editor_name}</strong>, {EDITOR.legal_form} au capital de {EDITOR.capital},
        immatriculée au RCS de {EDITOR.rcs}, SIRET {EDITOR.siret}, dont le siège social est situé {EDITOR.address}.
      </p>
      <p>Contact : {EDITOR.email} — {EDITOR.phone}.</p>
      <p>
        Le Service est hébergé par <strong>{EDITOR.host.name}</strong> ({EDITOR.host.legal_form},
        {EDITOR.host.country}). Voir les <a href="/mentions-legales">mentions légales</a>.
      </p>

      <h2>2. Objet</h2>
      <p>
        Patrimo est un cockpit de pilotage permettant à un bailleur de centraliser et suivre la rentabilité
        de son patrimoine immobilier locatif : biens, lots, baux, loyers, comptes locataires, recouvrement,
        flux bancaires, fiscalité et coffre documentaire.
      </p>

      <h2>3. Prix — durée — résiliation</h2>
      <p>
        Le Service est proposé sous forme d'abonnement mensuel sans engagement, selon les tarifs en vigueur
        affichés sur la page <a href="/pricing">Tarifs</a> (plans Starter, Pro, Business). Un essai gratuit
        de 14 jours sans carte bancaire peut être offert aux nouveaux utilisateurs.
      </p>
      <ul>
        <li><strong>Durée</strong> : l'abonnement est conclu pour une durée indéterminée, à compter de l'acceptation des présentes.</li>
        <li><strong>Résiliation</strong> : l'utilisateur peut résilier à tout moment depuis le portail client Stripe (« Gérer mon abonnement »). La résiliation prend effet à la fin de la période déjà payée.</li>
        <li><strong>Modification des prix</strong> : toute modification tarifaire est notifiée au moins 30 jours avant son application.</li>
      </ul>

      <h2>4. Obligations de l'utilisateur</h2>
      <ul>
        <li>Communiquer des informations exactes et licites sur son patrimoine et ses locataires.</li>
        <li>Respecter les obligations légales propres au bailleur (déclaration des loyers, DPE, assurance, régularisation annuelle des charges).</li>
        <li>Ne pas utiliser le Service à des fins illicites, ni tenter d'en compromettre la sécurité.</li>
        <li>Conserver la confidentialité de ses identifiants de connexion.</li>
      </ul>

      <h2>5. Obligations de l'éditeur</h2>
      <ul>
        <li>Fournir un accès au Service conforme à sa documentation, avec un principe de continuité de service.</li>
        <li>Assurer la sécurité et la confidentialité des données selon les modalités de la <a href="/confidentialite">Politique de confidentialité</a>.</li>
        <li>Maintenir le Service dans une obligation de moyens, et non de résultat.</li>
      </ul>

      <h2>6. Limitation de responsabilité</h2>
      <p>
        Le Service est un outil d'aide au pilotage. Les calculs financiers, fiscaux et juridiques produits par
        le Service — notamment le <strong>simulateur fiscal</strong> (estimation de l'imposition, micro-foncier/BIC,
        abattements, charges déductibles) — sont <strong>purement indicatifs</strong> et fondés sur les données
        saisies par l'utilisateur ainsi que sur des barèmes en vigueur à la date de calcul. Ils ne constituent
        en aucun cas un conseil fiscal, comptable, notarial ou juridique et ne se substituent pas à l'avis
        d'un professionnel agréé (expert-comptable, notaire, avocat).
      </p>
      <p>
        L'utilisateur reste seul responsable des déclarations adressées à l'administration et des décisions
        prises sur la base des informations fournies par le Service. L'éditeur ne saurait être tenu
        responsable des errements fiscaux, préjudices ou amendes résultant d'une utilisation des résultats
        du Service à des fins déclaratives sans validation par un professionnel.
      </p>
      <p>
        La responsabilité de l'éditeur ne peut être engagée pour : panne d'accès liée au réseau de
        l'utilisateur ou à l'hébergeur, perte de données résultant d'un défaut de sauvegarde imputable à
        l'utilisateur, ou utilisation non conforme aux présentes CGU.
      </p>

      <h2>7. Propriété intellectuelle</h2>
      <p>
        Le Service, ses éléments graphiques et son code restent la propriété de l'éditeur. L'utilisateur ne
        dispose que d'un droit d'usage personnel, non exclusif et révocable.
      </p>

      <h2>8. Litiges — médiation — droit applicable</h2>
      <p>
        Les présentes CGU sont régies par le droit français. En cas de litige, une solution amiable sera
        recherchée en priorité. À défaut, le litige sera soumis aux tribunaux compétents du ressort du siège
        social de l'éditeur.
      </p>
      <p>
        Conformément à l'article L.612-1 du Code de la consommation, l'utilisateur — consommateur ou
        non-professionnel — peut recourir gratuitement à un médiateur de la consommation en ligne
        (<a href="https://www.economie.gouv.fr/medation-conso" target="_blank" rel="noreferrer">economie.gouv.fr/medation-conso</a>).
      </p>
    </LegalShell>
  );
}