// Client Stripe minimal (REST + Web Crypto) partagé par les fonctions
// createCheckoutSession / createPortalSession / stripeWebhook.
//
// On utilise fetch + crypto.subtle (Web-standard, compatible runtime Worker)
// plutôt que le SDK Stripe — pas de dépendance npm et comportement identique.
// Toute la logique Stripe vit ici ; les entry.ts ne font que l'orchestration.

const STRIPE_BASE = 'https://api.stripe.com/v1';

function formEncode(obj: Record<string, any>): string {
  const parts: string[] = [];
  const visit = (val: any, key: string) => {
    if (val === null || val === undefined || val === '') return;
    if (Array.isArray(val)) {
      val.forEach((v, i) => visit(v, `${key}[${i}]`));
    } else if (typeof val === 'object') {
      for (const k of Object.keys(val)) visit((val as any)[k], `${key}[${k}]`);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`);
    }
  };
  for (const k of Object.keys(obj)) visit(obj[k], k);
  return parts.join('&');
}

async function stripeRequest(
  secret: string,
  path: string,
  params: Record<string, any>,
  method: 'POST' | 'GET' = 'POST'
): Promise<any> {
  const headers = {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  let url = `${STRIPE_BASE}${path}`;
  const init: RequestInit = { method, headers };
  if (method === 'GET') {
    const qs = formEncode(params);
    if (qs) url += `?${qs}`;
  } else {
    init.body = formEncode(params);
  }
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok || (data && data.error)) {
    const msg = (data && data.error && (data.error.message || data.error.type)) || `Stripe HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function createCustomer(
  secret: string,
  opts: { email?: string; name?: string; userId: string }
): Promise<any> {
  return stripeRequest(secret, '/customers', {
    email: opts.email || '',
    name: opts.name || '',
    'metadata[user_id]': opts.userId,
  });
}

export async function createCheckoutSession(
  secret: string,
  opts: {
    priceId: string;
    customerId: string;
    userId: string;
    email?: string;
    successUrl: string;
    cancelUrl: string;
    trialDays?: number;
    promoCode?: string;
  }
): Promise<any> {
  const params: Record<string, any> = {
    mode: 'subscription',
    'line_items[0][price]': opts.priceId,
    'line_items[0][quantity]': 1,
    customer: opts.customerId,
    client_reference_id: opts.userId,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    allow_promotion_codes: true,
    payment_method_collection: 'if_required',
    'subscription_data[metadata][user_id]': opts.userId,
    'subscription_data[metadata][email]': opts.email || '',
  };
  if (opts.trialDays && opts.trialDays > 0) {
    params['subscription_data[trial_period_days]'] = opts.trialDays;
  }
  if (opts.promoCode) {
    params['discounts[0][promotion_code]'] = opts.promoCode;
  }
  return stripeRequest(secret, '/checkout/sessions', params);
}

export async function createPortalSession(
  secret: string,
  opts: { customerId: string; returnUrl: string }
): Promise<any> {
  return stripeRequest(secret, '/billing_portal/sessions', {
    customer: opts.customerId,
    return_url: opts.returnUrl,
  });
}

export async function retrieveSubscription(
  secret: string,
  subscriptionId: string
): Promise<any> {
  return stripeRequest(secret, `/subscriptions/${subscriptionId}`, {
    'expand[]': 'items.data.price.product',
  }, 'GET');
}

// Vérification de signature Stripe (t=... & v1=...) via Web Crypto (SubtleCrypto).
// Retourne true uniquement si la signature est valide ET fraîche (< 5 min).
export async function verifyStripeSignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!signature || !secret || !rawBody) return false;
  const parts: Record<string, string> = {};
  for (const seg of signature.split(',')) {
    const idx = seg.indexOf('=');
    if (idx > 0) parts[seg.slice(0, idx).trim()] = seg.slice(idx + 1).trim();
  }
  const tStr = parts['t'];
  const v1 = parts['v1'];
  if (!tStr || !v1) return false;
  const t = parseInt(tStr, 10);
  if (!Number.isFinite(t)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > 300) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return diff === 0;
}

// Convertit un timestamp Stripe (secondes) en ISO, '' si absent.
export function isoFromUnix(ts: number | undefined | null): string {
  if (!ts || !Number.isFinite(ts)) return '';
  return new Date(ts * 1000).toISOString();
}