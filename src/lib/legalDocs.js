// Métadonnées des documents légaux + informations éditeur/hébergeur.
//=date d'effet = date de mise en service. Le hash est un identifiant de version
// stable (à incrémenter à chaque révision) affiché en bas de chaque page légale.

export const LEGAL_DOCS = {
  cgu: { slug: 'cgu', version: '2026-08-25', hash: 'sha256:cgu-v1-2026-08-25', title: "Conditions Générales d'Utilisation" },
  mentions: { slug: 'mentions-legales', version: '2026-08-25', hash: 'sha256:mentions-v1-2026-08-25', title: 'Mentions légales' },
  confidentialite: { slug: 'confidentialite', version: '2026-08-25', hash: 'sha256:conf-v1-2026-08-25', title: 'Politique de confidentialité' },
  dpa: { slug: 'dpa', version: '2026-08-25', hash: 'sha256:dpa-v1-2026-08-25', title: 'Contrat de sous-traitance (DPA)' },
};

// Informations éditeur — à compléter par l'exploitant avant mise en ligne.
// Les valeurs entre crochets DOIVENT être renseignées (avocat / dirigeant).
export const EDITOR = {
  product: 'Patrimo',
  editor_name: '[À COMPLÉTER — raison sociale éditrice du service]',
  legal_form: '[À COMPLÉTER — SAS / SARL / EI…]',
  siret: '[À COMPLÉTER — 14 chiffres]',
  rcs: '[À COMPLÉTER — ville + numéro RCS]',
  capital: '[À COMPLÉTER — montant du capital social]',
  address: '[À COMPLÉTER — adresse du siège social]',
  email: 'contact@[À-COMPLÉTER].fr',
  phone: '[À COMPLÉTER]',
  director_publication: '[À COMPLÉTER — nom du directeur de la publication]',
  host: {
    name: 'Base44 Ltd',
    legal_form: 'Société éditrice de la plateforme Base44',
    country: 'Israël',
    address: '[À COMPLÉTER — adresse de l\u2019hébergeur]',
  },
  dpo_email: 'dpo@patrimo.fr',
};