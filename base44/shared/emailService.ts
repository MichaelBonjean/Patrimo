/**
 * EmailService — abstraction transactionnelle multi-fournisseurs.
 *
 * Fournisseurs supportés : Brevo, Resend, Postmark (sélection via EMAIL_PROVIDER).
 *
 *  - Les secrets (clés API) restent côté serveur (base44:runtime secrets).
 *  - Retry contrôlé : 3 tentatives, back-off exponentiel (500ms / 2s / 8s).
 *  - Journalisation : chaque envoi est tracé dans l'entité EmailLog
 *    (statut queued -> sent/failed, message_id, erreur, nb de tentatives).
 *  - Pièces jointes : URLs publiques fetchées côté serveur, encodées base64,
 *    transmises au fournisseur (PDF quittance, courriers de recouvrement…).
 *
 * NB : « delivered » n'est défini que si le fournisseur expose un webhook
 * d'accusé de réception (non couvert ici par défaut — laissé pour Extension).
 */

import { secrets } from 'base44:runtime';

export type EmailStatus = 'queued' | 'sent' | 'failed' | 'delivered';
export const SUPPORTED_PROVIDERS = ['brevo', 'resend', 'postmark'] as const;

export interface AttachmentInput { url: string; filename: string; content_type?: string; }
export interface SendParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: AttachmentInput[];
  template?: string;
  variables?: Record<string, any>;
  owner_id: string;
  is_demo?: boolean;
  related_entity_type?: string;
  related_entity_id?: string;
}
export interface SendResult {
  status: EmailStatus;
  provider: string;
  message_id?: string;
  error?: string;
  log_id?: string;
  attempts: number;
}

const PROVIDER_KEY: Record<string, string> = {
  brevo: 'BREVO_API_KEY',
  resend: 'RESEND_API_KEY',
  postmark: 'POSTMARK_API_KEY',
};
const BACKOFF_MS = [500, 2000, 8000];

function parseFrom(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: '', email: raw.trim() };
}

function contentTypeFor(filename: string): string {
  const ext = (String(filename).split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    csv: 'text/csv', txt: 'text/plain', html: 'text/html',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] || 'application/octet-stream';
}

async function fetchAttachmentBase64(att: AttachmentInput): Promise<{ filename: string; content_type: string; content_base64: string }> {
  const resp = await fetch(att.url);
  if (!resp.ok) throw new Error(`PJ injoignable (${resp.status})`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return {
    filename: att.filename || 'document',
    content_type: att.content_type || contentTypeFor(att.filename || 'document'),
    content_base64: btoa(bin),
  };
}

interface Sender { from: { name: string; email: string }; to: string; subject: string; html: string; text: string; }

async function sendBrevo(apiKey: string, p: Sender, attachs: any[]): Promise<{ status: EmailStatus; message_id?: string }> {
  const body: any = {
    sender: { email: p.from.email, name: p.from.name || p.from.email },
    to: [{ email: p.to }],
    subject: p.subject, htmlContent: p.html, textContent: p.text,
    ...(attachs.length ? { attachment: attachs.map((a) => ({ content: a.content_base64, name: a.filename })) } : {}),
  };
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': apiKey, accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${data.message || data.error || res.statusText}`);
  return { status: 'sent', message_id: data.messageId ? String(data.messageId) : undefined };
}

async function sendResend(apiKey: string, p: Sender, attachs: any[]): Promise<{ status: EmailStatus; message_id?: string }> {
  const body: any = {
    from: p.from.name ? `${p.from.name} <${p.from.email}>` : p.from.email,
    to: [p.to], subject: p.subject, html: p.html, text: p.text,
    ...(attachs.length ? { attachments: attachs.map((a) => ({ filename: a.filename, content: a.content_base64 })) } : {}),
  };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message || data.error || res.statusText}`);
  return { status: 'sent', message_id: data.id };
}

async function sendPostmark(apiKey: string, p: Sender, attachs: any[]): Promise<{ status: EmailStatus; message_id?: string }> {
  const body: any = {
    From: p.from.name ? `${p.from.name} <${p.from.email}>` : p.from.email,
    To: p.to, Subject: p.subject, HtmlBody: p.html, TextBody: p.text,
    ...(attachs.length ? { Attachments: attachs.map((a) => ({ Name: a.filename, Content: a.content_base64, ContentType: a.content_type })) } : {}),
  };
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST', headers: { 'X-Postmark-Server-Token': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Postmark ${res.status}: ${data.Message || data.ErrorCode || res.statusText}`);
  return { status: data.Message && String(data.Message).indexOf('OK') === 0 ? 'sent' : 'queued', message_id: data.MessageID ? String(data.MessageID) : undefined };
}

async function dispatch(provider: string, apiKey: string, p: Sender, attachs: any[]): Promise<{ status: EmailStatus; message_id?: string }> {
  if (provider === 'brevo') return sendBrevo(apiKey, p, attachs);
  if (provider === 'resend') return sendResend(apiKey, p, attachs);
  if (provider === 'postmark') return sendPostmark(apiKey, p, attachs);
  throw new Error(`Fournisseur non supporté: ${provider}`);
}

/**
 * Envoie un email transactionnel avec retry contrôlé + journalisation EmailLog.
 * @param svc  base44.asServiceRole (pour écrire dans EmailLog)
 * @param params voir SendParams
 */
export async function sendEmailWithRetry(svc: any, params: SendParams): Promise<SendResult> {
  const provider = (secrets.get('EMAIL_PROVIDER') || '').toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(provider as any)) {
    return { status: 'failed', provider: provider || 'none', error: 'EMAIL_PROVIDER non configuré (brevo|resend|postmark)', attempts: 0 };
  }
  const apiKey = secrets.get(PROVIDER_KEY[provider]) || '';
  if (!apiKey) return { status: 'failed', provider, error: `Clé API manquante (${PROVIDER_KEY[provider]})`, attempts: 0 };
  const from = parseFrom(secrets.get('EMAIL_FROM') || '');
  if (!from.email) return { status: 'failed', provider, error: 'EMAIL_FROM non configuré', attempts: 0 };

  // Journalisation initiale (queued) — best-effort
  let log_id: string | undefined;
  try {
    const log = await svc.entities.EmailLog.create({
      owner_id: params.owner_id, is_demo: !!params.is_demo,
      to: params.to, subject: params.subject, template: params.template || 'custom',
      variables: params.variables || {},
      attachments: (params.attachments || []).map((a) => ({ url: a.url, filename: a.filename })),
      status: 'queued', provider, attempted_count: 0,
      ...(params.related_entity_type ? { related_entity_type: params.related_entity_type } : {}),
      ...(params.related_entity_id ? { related_entity_id: params.related_entity_id } : {}),
    });
    log_id = log.id;
  } catch (_e) { /* logging best-effort */ }

  // Pré-fetch des pièces jointes (une fois, hors retry)
  let attachs: any[] = [];
  if (params.attachments && params.attachments.length) {
    try {
      for (const a of params.attachments) attachs.push(await fetchAttachmentBase64(a));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (log_id) try { await svc.entities.EmailLog.update(log_id, { status: 'failed', error, attempted_count: 1, error_at: new Date().toISOString() }); } catch (_) {}
      return { status: 'failed', provider, error, log_id, attempts: 1 };
    }
  }

  const sender: Sender = { from, to: params.to, subject: params.subject, html: params.html, text: params.text };
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await dispatch(provider, apiKey, sender, attachs);
      if (log_id) try {
        await svc.entities.EmailLog.update(log_id, {
          status: r.status, message_id: r.message_id || '', attempted_count: attempt, sent_date: new Date().toISOString(),
        });
      } catch (_) {}
      return { status: r.status, provider, message_id: r.message_id, log_id, attempts: attempt };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (log_id) try { await svc.entities.EmailLog.update(log_id, { attempted_count: attempt, error: lastError }); } catch (_) {}
      if (attempt < 3) await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1] || 8000));
    }
  }
  if (log_id) try { await svc.entities.EmailLog.update(log_id, { status: 'failed', error: lastError, attempted_count: 3, error_at: new Date().toISOString() }); } catch (_) {}
  return { status: 'failed', provider, error: lastError, log_id, attempts: 3 };
}