import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { createCustomer, createCheckoutSession as stripeCheckout } from '../../shared/stripeApi.ts';

const PLANS = ['starter', 'pro', 'business'] as const;

/**
 * Crée une session Stripe Checkout (mode abonnement) pour un plan donné.
 * Payload: { plan: 'starter'|'pro'|'business', promo_code?: string (id de promotion_code) }
 * Retourne: { url } — URL d'hébergement Stripe à ouvrir côté front.
 *
 * - Crée un Customer Stripe si l'utilisateur n'en a pas.
 * - Démarre un essai de 14 jours SANS CB (payment_method_collection=if_required).
 * - Rattache user_id + email au subscription_data.metadata (lu par le webhook).
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const plan = String(body.plan || '');
    const promoCode = body.promo_code ? String(body.promo_code) : '';
    if (!PLANS.includes(plan as any)) {
      return Response.json({ error: 'plan invalide (starter|pro|business)' }, { status: 400 });
    }

    const secret = secrets.get('STRIPE_SECRET_KEY');
    if (!secret) return Response.json({ error: 'Stripe non configuré (STRIPE_SECRET_KEY)' }, { status: 500 });
    const priceId = secrets.get(`STRIPE_PRICE_${plan.toUpperCase()}`) || '';
    if (!priceId) return Response.json({ error: `Prix Stripe non configuré (STRIPE_PRICE_${plan.toUpperCase()})` }, { status: 500 });

    const svc = base44.asServiceRole;
    let customerId = '';
    // 1. Customer existant (Subscription déjà créée par un webhook précédent)
    const existing: any[] = await svc.entities.Subscription.filter({ user_id: user.id });
    const sub = existing && existing[0];
    if (sub && sub.stripe_customer_id) customerId = sub.stripe_customer_id;
    if (!customerId && (user as any).stripe_customer_id) customerId = (user as any).stripe_customer_id;
    // 2. Sinon on crée le customer
    if (!customerId) {
      const customer = await createCustomer(secret, {
        email: user.email,
        name: user.full_name,
        userId: user.id,
      });
      customerId = customer.id;
    }
    // 3. On persiste le customer_id sur le User (réutilisé par le portal)
    await svc.entities.User.update(user.id, { stripe_customer_id: customerId });
    // 4. Stub de Subscription si inexistant (sera complété par le webhook)
    if (!sub) {
      await svc.entities.Subscription.create({
        user_id: user.id,
        owner_id: user.email,
        plan,
        stripe_customer_id: customerId,
        status: 'none',
      });
    }

    const origin = req.headers.get('origin') || new URL(req.url).origin;
    const successUrl = `${origin}/facturation?checkout=success`;
    const cancelUrl = `${origin}/facturation?checkout=cancel`;

    const session = await stripeCheckout(secret, {
      priceId,
      customerId,
      userId: user.id,
      email: user.email,
      successUrl,
      cancelUrl,
      trialDays: 14,
      promoCode: promoCode || undefined,
    });

    return Response.json({ url: session.url });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}