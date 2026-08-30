import React from 'react';
import LegalShell from '@/components/legal/LegalShell';
import { EDITOR } from '@/lib/legalDocs';

export default function MentionsLegales() {
  return (
    <LegalShell docKey="mentions" title="Mentions légales">
      <h2>Éditeur du service</h2>
      <ul>
        <li><strong>Raison sociale</strong> : {EDITOR.editor_name}</li>
        <li><strong>Forme juridique</strong> : {EDITOR.legal_form}</li>
        <li><strong>Capital social</strong> : {EDITOR.capital}</li>
        <li><strong>Siège social</strong> : {EDITOR.address}</li>
        <li><strong>SIRET</strong> : {EDITOR.siret}</li>
        <li><strong>RCS</strong> : {EDITOR.rcs}</li>
        <li><strong>Contact</strong> : {EDITOR.email} — {EDITOR.phone}</li>
      </ul>

      <h2>Directeur de la publication</h2>
      <p>Le directeur de la publication est {EDITOR.director_publication}.</p>

      <h2>Hébergeur</h2>
      <p>
        Le Service est hébergé par <strong>{EDITOR.host.name}</strong> ({EDITOR.host.legal_form}),
        immatriculée et opérant depuis <strong>{EDITOR.host.country}</strong> ({EDITOR.host.address}).
      </p>
      <p>
        L'infrastructure technique de la plateforme d'hébergement (Base44) — compute, base de données,
        stockage de fichiers — repose sur des centres d'hébergement conformes aux exigences du RGPD.
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        L'ensemble des éléments du Service (marque « Patrimo », textes, illustrations, logiciels) est protégé
        par le droit de la propriété intellectuelle. Toute reproduction sans autorisation est interdite.
      </p>

      <h2>Contact</h2>
      <p>
        Pour toute question relative au Service : {EDITOR.email}. Pour les questions relatives aux données
        personnelles : {EDITOR.dpo_email} (DPO).
      </p>
    </LegalShell>
  );
}