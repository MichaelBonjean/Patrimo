import React from 'react';
import LegalShell from '@/components/legal/LegalShell';
import { Button } from '@/components/ui/button';
import { Printer, FileDown } from 'lucide-react';
import { EDITOR } from '@/lib/legalDocs';

// DPA modèle — à faire valider par un avocat avant signature.
export default function Dpa() {
  const print = () => window.print();
  return (
    <LegalShell docKey="dpa" title="Contrat de sous-traitance (DPA)" maxWidth="3xl">
      <div className="flex gap-2 mb-4 print:hidden">
        <Button variant="outline" size="sm" onClick={print} className="gap-2"><Printer className="w-4 h-4" /> Imprimer</Button>
        <Button variant="outline" size="sm" onClick={print} className="gap-2"><FileDown className="w-4 h-4" /> Télécharger en PDF</Button>
      </div>

      <p className="text-sm text-muted-foreground italic mb-4">
        Modèle type ( inspiration AFNOR / CNIL). Ce document est un <strong>modèle</strong> de conformité
        minimale à faire relire et adapter par un avocat spécialisé data avant toute mise en ligne effective.
      </p>

      <h2>Entre les soussignés</h2>
      <p><strong>Le Responsable du traitement</strong> : {EDITOR.editor_name}, {EDITOR.legal_form}, SIRET {EDITOR.siret}, sise {EDITOR.address}, ci-après « le Responsable ».</p>
      <p><strong>Le Sous-traitant</strong> : {EDITOR.host.name}, {EDITOR.host.legal_form}, {EDITOR.host.country}, ci-après « le Sous-traitant ».</p>

      <h2>Article 1 — Objet</h2>
      <p>
        Le présent contrat a pour objet d\u2019encadrer le traitement par le Sous-traitant des données personnelles
        pour le compte et selon les instructions du Responsable, dans le cadre du Service Patrimo.
      </p>

      <h2>Article 2 — Nature, finalités et durée du traitement</h2>
      <p>
        Le Sous-traitant traite les données nécessaires à l\u2019exécution du Service (hébergement compute,
        base de données, stockage de fichiers). Les finalités détaillées figurent dans la
        <a href="/confidentialite"> Politique de confidentialité</a>. La durée de conservation respecte les durées
        contractuelles et légales ainsi définies.
      </p>

      <h2>Article 3 — Instructions du Responsable</h2>
      <p>
        Le Sous-traitant traite les données uniquement sur instruction documentée du Responsable, y compris en
        matière de transferts internationaux. Aucune utilisation des données à d\u2019autres fins n\u2019est autorisée.
      </p>

      <h2>Article 4 — Obligations du Sous-traitant (art. 28 RGPD)</h2>
      <ul>
        <li>Garantir la confidentialité des données (personnel habilité, engagements de confidentialité).</li>
        <li>Maintenir des mesures techniques et organisationnelles de sécurité (chiffrement, contrôle d\u2019accès, journalisation).</li>
        <li>Respecter les conditions relatives aux sous-traitants ultérieurs (approbation préalable).</li>
        <li>Assister le Responsable pour la réponse aux demandes d\u2019exercice de droits.</li>
        <li>Notifier au Responsable toute violation de données dans les meilleurs délais et au plus tard 72 heures après en avoir pris connaissance.</li>
        <li>Soutenir le Responsable dans la réalisation des analyses d\u2019impact (DPIA) le cas échéant.</li>
      </ul>

      <h2>Article 5 — Sécurité</h2>
      <p>
        Le Sous-traitant applique les mesures appropriées : chiffrement en transit (TLS) et au repos,
        cloisonnement logique des clients, sauvegardes, monitoring, gestion des vulnérabilités et plan de
        continuité d\u2019activité.
      </p>

      <h2>Article 6 — Habilité et transferts</h2>
      <p>
        Le personnel habilité est soumis à des obligations de confidentialité. En cas de transfert hors UE/EEE,
        le Sous-traitant s\u2019assure de l\u2019existence de garanties appropriées (clauses contractuelles types,
        décision d\u2019adéquation).
      </p>

      <h2>Article 7 — Audit</h2>
      <p>
        Le Responsable peut, sous préavis raisonnable et sans perturbation, vérifier la conformité du
        Sous-traitant (attestations tierces, rapports de sécurité).
      </p>

      <h2>Article 8 — Notification de violation</h2>
      <p>
        En cas de violation de données à caractère personnel, le Sous-traitant notifie le Responsable sans
        retard inutile, en décrivant la nature, les conséquences et les mesures prises/à prendre.
      </p>

      <h2>Article 9 — Suppression / restitution en fin de contrat</h2>
      <p>
        À la fin du contrat, le Sous-traitant restitue les données au Responsable et en supprime toute copie,
        sauf obligation légale de conservation le justifiant.
      </p>

      <h2>Article 10 — Sous-traitants ultérieurs</h2>
      <p>
        Le Sous-traitant informe le Responsable de tout changement concernant l\u2019ajout ou le remplacement
        d\u2019un sous-traitant ultérieur, laissant au Responsable la possibilité d\u2019y opposer un motif légitime.
      </p>

      <h2>Article 11 — Droit applicable et litiges</h2>
      <p>Le présent contrat est soumis au droit français. Les litiges relèvent des tribunaux du ressort du Responsable.</p>

      <h2>Signatures</h2>
      <p>Le Responsable : [nom, date, signature] — Le Sous-traitant : [nom, date, signature]</p>
    </LegalShell>
  );
}