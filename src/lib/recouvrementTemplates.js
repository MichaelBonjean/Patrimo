/**
 * Modèles juridiques centralisés pour le recouvrement des loyers impayés.
 *
 * Toute la rédaction des courriers et mentions légales vit ICI pour pouvoir
 * être mise à jour facilement en un seul endroit.
 *
 * Terminologie : on n'emploie JAMAIS « quittance impayée ». On parle de
 *  - loyer impayé
 *  - échéance impayée
 *  - dette locative
 *
 * Distinction d'acteurs :
 *  - « bailleur »    : document RÉDIGÉ par le bailleur lui-même (courriers).
 *  - « professionnel »: acte nécessitant un commissaire de justice ou un avocat.
 *
 * Le logiciel NE génère JAMAIS un commandement de payer (acte réservé au
 * commissaire de justice). Il assemble un dossier de transmission destiné à
 * un professionnel compétent — pas l'acte lui-même.
 */

const MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
export function monthLabel(num) { return MONTHS[(Number(num) || 0) - 1] || ''; }
export function periodLabel(period) {
  if (!period) return '';
  const [y, m] = period.split('-').map(Number);
  return m ? `${monthLabel(m)} ${y}` : period;
}
export function formatEuro(n) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
}
export function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('fr-FR');
}

/** Étapes du workflow de recouvrement. */
export const STAGES = [
  { key: 'echeance_impayee', label: 'Échéance non réglée', short: 'Échéance', kind: 'system', order: 0,
    help: "Détectée automatiquement : l'échéance est échue et présente un solde débiteur sur le compte locataire." },
  { key: 'rappel_amiable', label: 'Rappel amiable', short: 'Rappel', kind: 'bailleur', order: 1,
    help: "Premier courrier du bailleur, sur un ton courtois. Rappel simple." },
  { key: 'deuxieme_relance', label: 'Deuxième relance', short: '2ᵉ relance', kind: 'bailleur', order: 2,
    help: "Second courrier du bailleur, plus ferme." },
  { key: 'mise_en_demeure_amiable', label: 'Mise en demeure amiable', short: 'Mise en demeure', kind: 'bailleur', order: 3,
    help: "Dernière démarche amiable avant transmission à un professionnel." },
  { key: 'dossier_professionnel', label: 'Dossier à transmettre à un professionnel compétent', short: 'Dossier', kind: 'professionnel', order: 4,
    help: "Transmission du dossier de dette locative à un commissaire de justice ou un avocat.",
    disclaimer: true },
];

export const END_STAGES = [
  { key: 'régularisé', label: 'Dette régularisée', short: 'Régularisé', kind: 'system', order: 5 },
  { key: 'abandonné', label: 'Dette abandonnée', short: 'Abandonné', kind: 'system', order: 6 },
];

export const ALL_STAGES = [...STAGES, ...END_STAGES];
export const STAGE_BY_KEY = Object.fromEntries(ALL_STAGES.map((s) => [s.key, s]));
export const STAGE_KEYS = ALL_STAGES.map((s) => s.key);

export function stageOf(status) { return STAGE_BY_KEY[status] || STAGE_BY_KEY.echeance_impayee; }
export function stageOrder(status) { return stageOf(status).order ?? 0; }

export function nextStage(status) {
  const idx = STAGES.findIndex((s) => s.key === status);
  if (idx < 0) return STAGES[1]?.key || 'rappel_amiable';
  return STAGES[idx + 1]?.key || 'dossier_professionnel';
}

/** Étiquette d'acteur pour l'historique. */
const ACTOR_FOR_DOC = {
  rappel_amiable: 'bailleur',
  deuxieme_relance: 'bailleur',
  mise_en_demeure_amiable: 'bailleur',
  dossier_professionnel: 'bailleur',
  note: 'bailleur',
};
export function actorOf(stage) {
  if (stage === 'echeance_impayee' || stage === 'régularisé' || stage === 'abandonné' || stage === 'paiement') return 'systeme';
  return ACTOR_FOR_DOC[stage] || 'bailleur';
}

/** Mention légale commune à TOUS les courriers bailleur. */
export const COURRIER_FOOTER = [
  'Courrier établi par le bailleur. Document informatif et amiable — ce n\'est pas un acte de procédure.',
  'Le commandement de payer et les actes de saisie relèvent de la compétence exclusive d\'un commissaire de justice.',
];

/** Avertissement affiché sur l'étape « dossier à transmettre ». */
export const DISCLAIMER_PROFESSIONNEL =
  "Le logiciel assemble un dossier de transmission destiné à un professionnel compétent (commissaire de justice ou avocat). " +
  "Il ne rédige pas — et ne prétend pas rédiger — un commandement de payer ni aucun acte de procédure, qui relèvent de la compétence exclusive d'un commissaire de justice. " +
  "La suite de la procédure (commandement, saisie, audience) s'effectue par ce professionnel.";

/**
 * Construit le contexte réutilisable par les modèles de courriers et dossier.
 * @param {object} args { impaye, lease, property, lot, landlordName, landlordEmail, landlordAddress }
 */
export function buildContext(args) {
  const { impaye, lease, property, lot, landlordName, landlordEmail, landlordAddress } = args;
  const tenant = (lease?.tenants || [])[0] || {};
  const tenantAddr = [property?.address, property?.postal_code, property?.city].filter(Boolean).join(' ');
  return {
    landlordName: landlordName || 'Votre bailleur',
    landlordEmail: landlordEmail || '',
    landlordAddress: landlordAddress || '',
    tenantName: impaye?.tenant_name || tenant?.name || '',
    tenantEmail: tenant?.email || impaye?.tenant_email || '',
    tenantAddress: tenantAddr,
    propertyName: property?.name || impaye?.property_name || '',
    lotDesignation: lot?.designation || impaye?.lot_designation || '',
    periodLabel: periodLabel(impaye?.period),
    dueDate: impaye?.due_date || '',
    totalDue: impaye?.expected_amount || 0,
    initialAmount: impaye?.initial_amount || impaye?.expected_amount || 0,
    paidAmount: impaye?.paid_amount || 0,
    outstanding: impaye?.outstanding_amount ?? impaye?.missing_amount ?? 0,
    lateDays: impaye?.late_days || 0,
    firstUnpaidDate: impaye?.first_unpaid_date || impaye?.due_date || '',
  };
}

/** Rappel amiable — premier courrier. */
export function buildRappelAmiable(ctx) {
  return {
    title: 'Rappel — échéance de loyer impayée',
    subject: `Rappel — loyer ${ctx.periodLabel}`,
    intro: ['Madame, Monsieur,'],
    body: [
      `Je vous adresse ce courrier en qualité de bailleur du logement situé ${ctx.tenantAddress}${ctx.lotDesignation ? ` (${ctx.lotDesignation})` : ''}.`,
      `Je constate à ce jour que l'échéance de loyer correspondant au mois de ${ctx.periodLabel} reste impayée.`,
      '',
      `• Échéance due : ${formatEuro(ctx.totalDue)}`,
      ctx.paidAmount > 0 ? `• Déjà réglé : ${formatEuro(ctx.paidAmount)}` : null,
      `• Reste à régler : ${formatEuro(ctx.outstanding)}`,
      '',
      "Il s'agit selon toute vraisemblance d'un simple oubli. Je vous remercie de bien vouloir procéder au règlement du solde restant dans les meilleurs délais, et reste à votre disposition pour en discuter si une difficulté se présente.",
    ].filter(Boolean),
    signatory: ['Bien cordialement,', ctx.landlordName],
    footerNote: COURRIER_FOOTER,
  };
}

/** Deuxième relance — plus ferme. */
export function buildDeuxiemeRelance(ctx) {
  return {
    title: 'Deuxième relance — loyer impayé',
    subject: `Deuxième relance — loyer ${ctx.periodLabel}`,
    intro: ['Madame, Monsieur,'],
    body: [
      `Je reviens vers vous concernant l'échéance de loyer du mois de ${ctx.periodLabel} pour le logement situé ${ctx.tenantAddress}${ctx.lotDesignation ? ` (${ctx.lotDesignation})` : ''}, qui reste impayée.`,
      `Malgré mon précédent courrier, la somme de ${formatEuro(ctx.outstanding)} reste due sur les ${formatEuro(ctx.totalDue)} attendus.`,
      '',
      'Pour rappel, l\'article 7 de la loi n° 89-462 du 6 juillet 1989 fait obligation au locataire d\'acquitter le loyer et les charges aux termes convenus.',
      "Je vous invite à procéder au règlement du solde sous huitaine. Toute difficulté persistante peut être évoquée avec moi afin d'envisager un échéancier si la situation le justifie.",
      `À défaut de règlement, je serai contraint(e) d'envisager la transmission du dossier à un professionnel compétent.`,
    ],
    signatory: ['Cordialement,', ctx.landlordName],
    footerNote: COURRIER_FOOTER,
  };
}

/** Mise en demeure amiable — dernière démarche amiable. */
export function buildMiseEnDemeureAmiable(ctx) {
  return {
    title: 'Mise en demeure amiable de régulariser',
    subject: `Mise en demeure amiable — dette locative ${ctx.periodLabel}`,
    intro: ['Madame, Monsieur,'],
    body: [
      `Par la présente, je vous mets en demeure de me régler la somme de ${formatEuro(ctx.outstanding)}, correspondant au solde de la dette locative du mois de ${ctx.periodLabel} pour le logement situé ${ctx.tenantAddress}${ctx.lotDesignation ? ` (${ctx.lotDesignation})` : ''}.`,
      '',
      `Vous disposez d'un délai de huit (8) jours à compter de la réception de la présente pour procéder à cette régularisation.`,
      "À défaut de règlement dans ce délai, je serai contraint(e) de transmettre le dossier de la dette locative à un professionnel compétent (commissaire de justice ou avocat) pour la suite des démarches, sans nouvelle intervention de ma part.",
      '',
      "La présente mise en demeure est une démarche amiable. Elle ne constitue pas un acte de procédure : le commandement de payer relève de la compétence exclusive d'un commissaire de justice.",
    ],
    signatory: ['Veuillez agréer, Madame, Monsieur, mes salutations distinguées.', ctx.landlordName],
    footerNote: COURRIER_FOOTER,
  };
}

/** Sélectionne le modèle d'étape. */
export function buildDocumentFor(stage, ctx) {
  switch (stage) {
    case 'rappel_amiable': return buildRappelAmiable(ctx);
    case 'deuxieme_relance': return buildDeuxiemeRelance(ctx);
    case 'mise_en_demeure_amiable': return buildMiseEnDemeureAmiable(ctx);
    default: return null;
  }
}

export const METHOD_LABELS = {
  email: 'Email', courrier_lrar: 'Courrier LRAR', manuel: 'Manuel',
  generé: 'PDF généré', telechargement: 'Téléchargement', transmission: 'Transmission', paiement: 'Paiement', note: 'Note',
};
export const ACTOR_LABELS = { bailleur: 'Document bailleur', professionnel: 'Intervention d\'un professionnel', systeme: 'Système' };