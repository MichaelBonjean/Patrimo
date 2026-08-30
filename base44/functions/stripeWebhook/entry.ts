import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { verifyStripeSignature, retrieveSubscription, isoFromUnix } from '../../shared/stripeApi.ts';

// Endpoint PUBLIC appelé par Stripe. Aucune auth utilisateur : on valide la
// signature HMAC Stripe puis on agit en service role (bypass RLS) sur
// Subscription + User. On n'écrit JAMAIS sans preuve de signature.

const DAY_MS = 86400000;
const DOWNGRADE_GRACE_DAYS = 7;

function mapStatus(s: string): 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'ended' {
  switch (s) {
    case 'trialing': return 'trialing';
    case 'active': return 'active';
    case 'past_due': return 'past_due';
    case 'canceled': return 'canceled';
    case 'unpaid': return 'past_due';
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused': return 'none';
    default: return 'none';
  }
}

function planFromPriceId(priceId: string): 'starter' | 'pro' | 'business' {
  const starter = secrets.get('STRIPE_PRICE_STARTER') || '__none_starter__';
  const pro = secrets.get('STRIPE_PRICE_PRO') || '__none_pro__';
  const business = secrets.get('STRIPE_PRICE_BUSINESS') || '__none_business__';
  if (priceId === starter) return 'starter';
  if (priceId === pro) return 'pro';
  if (priceId === business) return 'business';
  return 'starter';
}

async function applySubscription(svc: any, sub: any, userIdFallback?: string) {
  const userId = (sub.metadata && sub.metadata.user_id) || userIdFallback || '';
  const email = (sub.metadata && sub.metadata.email) || '';
  const status = mapStatus(sub.status);
  const periodEnd = isoFromUnix(sub.current_period_end);
  const priceId = (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id) || '';
  const plan = planFromPriceId(priceId);

  const recs: any[] = await svc.entities.Subscription.filter({ user_id: userId });
  const rec = recs && recs[0];
  const patch: Record<string, any> = {
    plan, stripe_subscription_id: sub.id, stripe_customer_id: sub.customer,
    price_id: priceId, status, current_period_end: periodEnd,
    cancel_at: isoFromUnix(sub.cancel_at),
    canceled_at: sub.canceled_at ? isoFromUnix(sub.canceled_at) : '',
    trial_ends_at: sub.trial_end ? isoFromUnix(sub.trial_end) : '',
  };
  if (rec) await svc.entities.Subscription.update(rec.id, patch);
  else await svc.entities.Subscription.create({ user_id: userId, owner_id: email, ...patch });

  // Miroir sur le User (lu par le planGate / le bandeau) — service role, bypass RLS.
  const userPatch: Record<string, any> = {
    subscription_status: status === 'ended' ? 'none' : status,
    current_period_end: periodEnd,
    stripe_customer_id: sub.customer,
  };
  if (status === 'active' || status === 'trialing') {
    userPatch.plan = plan;
  } else if (status === 'ended') {
    userPatch.plan = 'starter';
    userPatch.subscription_status = 'none';
  }
  // past_due / canceled : on garde le plan courant (grace / fin de période payée)
  await svc.entities.User.update(userId, userPatch);
}

async function handlePaymentFailed(svc: any, secret: string, invoice: any) {
  const customerId = invoice.customer;
  const subId = invoice.subscription;
  if (!subId) return;

  const recs: any[] = await svc.entities.Subscription.filter({ stripe_customer_id: customerId });
  const rec = recs && recs[0];
  const userId = (rec && rec.user_id) || '';

  const sub = await retrieveSubscription(secret, subId);
  const periodEnd = isoFromUnix(sub.current_period_end);
  const overdueMs = Date.now() - (sub.current_period_end ? sub.current_period_end * 1000 : Date.now());

  if (overdueMs >= DOWNGRADE_GRACE_DAYS * DAY_MS) {
    // Retard >= 7j : downgrade immédiat vers starter.
    if (rec) await svc.entities.Subscription.update(rec.id, { status: 'ended', plan: 'starter', current_period_end: periodEnd, past_due_since: undefined });
    await svc.entities.User.update(userId, { plan: 'starter', subscription_status: 'none', current_period_end: periodEnd });
  } else if (rec) {
    const pastDueSince = rec.past_due_since || isoFromUnix(Math.floor(Date.now() / 1000));
    await svc.entities.Subscription.update(rec.id, { status: 'past_due', current_period_end: periodEnd, past_due_since: pastDueSince });
    await svc.entities.User.update(userId, { subscription_status: 'past_due', current_period_end: periodEnd });
  }
}

async function handleSubscriptionDeleted(svc: any, sub: any) {
  const userId = (sub.metadata && sub.metadata.user_id) || '';
  const periodEndTs = sub.current_period_end || 0;
  const periodPassed = Date.now() >= (periodEndTs ? periodEndTs * 1000 : 0);
  const periodEnd = isoFromUnix(periodEndTs);

  const recs: any[] = await svc.entities.Subscription.filter({ user_id: userId });
  const rec = recs && recs[0];

  if (periodPassed) {
    // Période payée terminée : downgrade vers starter.
    if (rec) await svc.entities.Subscription.update(rec.id, { status: 'ended', plan: 'starter', current_period_end: periodEnd, canceled_at: isoFromUnix(Math.floor(Date.now() / 1000)) });
    await svc.entities.User.update(userId, { plan: 'starter', subscription_status: 'none', current_period_end: periodEnd });
  } else {
    // Annulation demandée mais période encore active : on garde l'accès jusqu'à la fin.
    if (rec) await svc.entities.Subscription.update(rec.id, { status: 'canceled', cancel_at: isoFromUnix(sub.cancel_at), canceled_at: isoFromUnix(sub.canceled_at) });
    await svc.entities.User.update(userId, { subscription_status: 'canceled', current_period_end: periodEnd });
  }
}

export default async function (req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('stripe-signature') || '';
    const webhookSecret = secrets.get('STRIPE_WEBHOOK_SECRET') || '';
    const apiSecret = secrets.get('STRIPE_SECRET_KEY') || '';
    if (!webhookSecret) return Response.json({ error: 'Webhook non configuré (STRIPE_WEBHOOK_SECRET)' }, { status: 500 });

    const ok = await verifyStripeSignature(rawBody, signature, webhookSecret);
    if (!ok) return Response.json({ error: 'Signature invalide' }, { status: 400 });

    const event = JSON.parse(rawBody);
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data && event.data.object;
        if (session && session.subscription && apiSecret) {
          const sub = await retrieveSubscription(apiSecret, session.subscription);
          await applySubscription(svc, sub, session.client_reference_id);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data && event.data.object;
        if (sub) await applySubscription(svc, sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data && event.data.object;
        if (sub) await handleSubscriptionDeleted(svc, sub);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data && event.data.object;
        if (invoice && apiSecret) await handlePaymentFailed(svc, apiSecret, invoice);
        break;
      }
      default:
        // événement non géré — ack pour éviter les retries Stripe.
        break;
    }

    return Response.json({ received: true, type: event.type });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}