import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { createPortalSession as stripePortal } from '../../shared/stripeApi.ts';

/**
 * Crée une session Stripe Customer Portal pour que l'utilisateur gère
 * son abonnement (changer de carte, voir factures, annuler).
 * Retourne: { url } — à ouvrir côté front (BillingSettings).
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const secret = secrets.get('STRIPE_SECRET_KEY');
    if (!secret) return Response.json({ error: 'Stripe non configuré (STRIPE_SECRET_KEY)' }, { status: 500 });

    let customerId = (user as any).stripe_customer_id || '';
    if (!customerId) {
      const subs: any[] = await base44.asServiceRole.entities.Subscription.filter({ user_id: user.id });
      if (subs && subs[0]) customerId = subs[0].stripe_customer_id || '';
    }
    if (!customerId) return Response.json({ error: 'Aucun abonnement Stripe à gérer' }, { status: 404 });

    const returnUrl = req.headers.get('origin') || new URL(req.url).origin;
    const session = await stripePortal(secret, { customerId, returnUrl: `${returnUrl}/facturation` });

    return Response.json({ url: session.url });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}