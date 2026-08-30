/**
 * Templates transactionnels d'email.
 *
 * Chaque template expose renderEmailTemplate(key, vars) -> { subject, html, text }.
 * Le rendu se fait CÔTÉ SERVEUR (jamais de HTML arbitraire provenant du client),
 * les variables sont échappées HTML pour éviter toute injection.
 *
 * Templates :
 *  - quittance              : envoi d'une quittance / reçu de loyer (+ PDF en PJ)
 *  - rent_reminder          : rappel amiable / 2ᵉ relance de loyer impayé (+ PDF en PJ)
 *  - mise_en_demeure        : mise en demeure amiable (+ PDF en PJ)
 *  - tenant_portal_invitation : invitation à l'espace locataire self-service
 */

export const EMAIL_TEMPLATE_KEYS = [
  'quittance',
  'rent_reminder',
  'mise_en_demeure',
  'tenant_portal_invitation',
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

function euro(n: unknown): string {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function wrap(bodyHtml: string, preheader: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Patrimo</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
      <div style="background:#1d4ed8;color:#fff;padding:18px 20px;">
        <div style="font-size:18px;font-weight:700;letter-spacing:.2px;">Patrimo</div>
        <div style="font-size:11px;opacity:.85;margin-top:2px;">Gestion locative & rentabilité</div>
      </div>
      <div style="padding:22px 20px;font-size:14px;line-height:1.55;">${bodyHtml}</div>
      <div style="padding:14px 20px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;line-height:1.5;">
        Cet email a été émis automatiquement par l'application Patrimo. Si vous n'en attendiez pas, vous pouvez l'ignorer.
      </div>
    </div>
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f1f5f9;">${esc(preheader)}</div>
  </div>
</body></html>`;
}

interface Rendered { subject: string; html: string; text: string; }

export function renderEmailTemplate(key: string, v: Record<string, any>): Rendered {
  switch (key) {
    case 'quittance': {
      const partial = v.kind === 'partial';
      const titre = partial ? 'Reçu de loyer (paiement partiel)' : 'Quittance de loyer';
      const period = v.period_label || '';
      const rows = [
        ['Logement', `${v.property_name || ''}${v.lot_designation ? ` — ${v.lot_designation}` : ''}`],
        ['Loyer hors charges', euro(v.rent_hc)],
        ['Charges', euro(v.charges)],
        ...(Number(v.additional_amount) > 0 ? [['Provisions / frais', euro(v.additional_amount)]] : []),
        ['Total dû', euro(v.total_due)],
        ['Total payé', euro(v.paid_amount)],
        ...(partial ? [['Reste à payer', euro(v.balance)]] : []),
      ];
      const htmlTable = rows.map((r) => `<tr><td style="padding:4px 0;color:#475569;">${esc(r[0])}</td><td style="padding:4px 0;text-align:right;font-weight:600;">${esc(r[1])}</td></tr>`).join('');
      const body = `
        <p style="margin:0 0 12px;">Bonjour ${esc(v.tenant_name || '')},</p>
        <p style="margin:0 0 16px;">Veuillez trouver votre <strong>${esc(titre.toLowerCase())}</strong> pour <strong>${esc(period)}</strong> en pièce jointe.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">${htmlTable}</table>
        <p style="margin:16px 0 0;">Cordialement,<br><strong>${esc(v.landlord_name || 'Votre bailleur')}</strong></p>`;
      const text = `Bonjour ${v.tenant_name || ''},\n\nVeuillez trouver votre ${titre.toLowerCase()} pour ${period} en pièce jointe.\n${rows.map((r) => `- ${r[0]} : ${r[1]}`).join('\n')}\n\nCordialement,\n${v.landlord_name || 'Votre bailleur'}`;
      return { subject: `${titre} — ${period}`, html: wrap(body, `Quittance ${period}`), text };
    }
    case 'rent_reminder': {
      const Num = v.relance_number === 2 ? '2ᵉ relance' : 'Rappel';
      const body = `
        <p style="margin:0 0 12px;">Bonjour ${esc(v.tenant_name || '')},</p>
        <p style="margin:0 0 14px;">Je vous adresse ce ${esc(Num.toLowerCase())} concernant l'échéance de loyer <strong>${esc(v.period_label || '')}</strong> pour le logement situé ${esc(v.property_name || '')}${v.lot_designation ? ` — ${esc(v.lot_designation)}` : ''}.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:4px 0;color:#475569;">Échéance due</td><td style="padding:4px 0;text-align:right;font-weight:600;">${euro(v.amount_due)}</td></tr>
          <tr><td style="padding:4px 0;color:#475569;">Reste à régler</td><td style="padding:4px 0;text-align:right;font-weight:600;color:#b91c1c;">${euro(v.outstanding)}</td></tr>
          <tr><td style="padding:4px 0;color:#475569;">Échéance du</td><td style="padding:4px 0;text-align:right;">${esc(v.due_date || '')}</td></tr>
        </table>
        <p style="margin:14px 0;">Il s'agit vraisemblablement d'un simple oubli. Je vous remercie de procéder au règlement dans les meilleurs délais. Le courrier détaillé est joint en pièce jointe.</p>
        <p style="margin:14px 0 0;">Cordialement,<br><strong>${esc(v.landlord_name || 'Votre bailleur')}</strong></p>`;
      const text = `Bonjour ${v.tenant_name || ''},\n\n${Num} — loyer impayé ${v.period_label || ''} (${v.property_name || ''}${v.lot_designation ? ` — ${v.lot_designation}` : ''}).\nÉchéance due : ${euro(v.amount_due)}\nReste à régler : ${euro(v.outstanding)}\nÉchéance du : ${v.due_date || ''}\n\nVeuillez procéder au règlement dans les meilleurs délais. Courrier détaillé en pièce jointe.\n\nCordialement,\n${v.landlord_name || 'Votre bailleur'}`;
      return { subject: `${Num} — loyer ${v.period_label || ''}`, html: wrap(body, `Rappel loyer ${v.period_label || ''}`), text };
    }
    case 'mise_en_demeure': {
      const body = `
        <p style="margin:0 0 12px;">Bonjour ${esc(v.tenant_name || '')},</p>
        <p style="margin:0 0 14px;">Par la présente, je vous mets en demeure de me régler la somme de <strong style="color:#b91c1c;">${euro(v.outstanding)}</strong>, correspondant au solde de la dette locative du mois de <strong>${esc(v.period_label || '')}</strong> pour le logement situé ${esc(v.property_name || '')}${v.lot_designation ? ` — ${esc(v.lot_designation)}` : ''}.</p>
        <p style="margin:0 0 14px;">Vous disposez d'un délai de <strong>huit (8) jours</strong> à compter de la réception de la présente pour procéder à cette régularisation. La mise en demeure détaillée est jointe en pièce jointe.</p>
        <p style="font-size:11px;color:#64748b;margin-top:18px;border-top:1px solid #e2e8f0;padding-top:10px;">Démarche amiable du bailleur — ce n'est pas un acte de procédure. Le commandement de payer relève de la compétence exclusive d'un commissaire de justice.</p>
        <p style="margin:14px 0 0;">Veuillez agréer mes salutations distinguées,<br><strong>${esc(v.landlord_name || 'Votre bailleur')}</strong></p>`;
      const text = `Bonjour ${v.tenant_name || ''},\n\nMise en demeure amiable de régulariser la somme de ${euro(v.outstanding)} (dette locative ${v.period_label || ''}, ${v.property_name || ''}${v.lot_designation ? ` — ${v.lot_designation}` : ''}).\nDélai de 8 jours. Courrier détaillé en pièce jointe.\n\nDémarche amiable — pas un acte de procédure.\n\nVeuillez agréer mes salutations distinguées,\n${v.landlord_name || 'Votre bailleur'}`;
      return { subject: `Mise en demeure amiable — dette locative ${v.period_label || ''}`, html: wrap(body, 'Mise en demeure amiable'), text };
    }
    case 'tenant_portal_invitation': {
      const body = `
        <p style="margin:0 0 12px;">Bonjour ${esc(v.tenant_name || '')},</p>
        <p style="margin:0 0 16px;">Vous disposez désormais d'un accès à votre <strong>espace locataire self-service</strong> pour consulter vos quittances, l'historique de vos paiements et mettre à jour vos coordonnées.</p>
        <p style="text-align:center;margin:18px 0;">
          <a href="${esc(v.link || '')}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:600;padding:11px 22px;border-radius:8px;font-size:14px;">Accéder à mon espace</a>
        </p>
        <p style="font-size:12px;color:#64748b;margin:8px 0 0;">Lien valable ${esc(v.expires_days || '90')} jours, renouvelé automatiquement à chaque visite.<br>${esc(v.link || '')}</p>
        <p style="margin:18px 0 0;">Cordialement,<br><strong>${esc(v.landlord_name || 'Votre bailleur')}</strong></p>`;
      const text = `Bonjour ${v.tenant_name || ''},\n\nVous disposez d'un accès à votre espace locataire self-service (quittances, paiements, coordonnées).\n\nLien (valable ${v.expires_days || '90'} jours) :\n${v.link || ''}\n\nCordialement,\n${v.landlord_name || 'Votre bailleur'}`;
      return { subject: 'Votre accès espace locataire', html: wrap(body, 'Accès espace locataire'), text };
    }
    default:
      throw new Error(`Template inconnu: ${key}`);
  }
}