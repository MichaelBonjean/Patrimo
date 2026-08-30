import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeClient, run } from '../../helpers/serverContext.js';

const SECRETS = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_x',
  STRIPE_PRICE_STARTER: 'price_starter',
  STRIPE_PRICE_PRO: 'price_pro',
  STRIPE_PRICE_BUSINESS: 'price_business',
};

const active = vi.hoisted(() => ({ current: null }));

vi.mock('npm:@base44/sdk@0.8.40', () => ({
  createClientFromRequest: () => active.current,
}));

vi.mock('base44:runtime', () => ({
  secrets: { get: (name) => SECRETS[name] },
}));

const stripeMock = vi.hoisted(() => ({
  verify: true,
  subs: {},
  reset() { this.verify = true; this.subs = {}; },
}));

vi.mock('../../../base44/shared/stripeApi.ts', () => ({
  verifyStripeSignature: async () => stripeMock.verify,
  retrieveSubscription: async (secret, id) => stripeMock.subs[id] || null,
  isoFromUnix: (ts) => (ts ? new Date(ts * 1000).toISOString() : ''),
  createCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
}));

import stripeWebhookHandler from '../../../base44/functions/stripeWebhook/entry.ts';

const DAY = 86400000;
const USER_ID = 'usr_1';
const USER_EMAIL = 'land@patrimo.test';
const seedUser = { id: USER_ID, role: 'user', email: USER_EMAIL, created_date: '2025-01-01', plan: 'starter', subscription_status: 'none' };

function evt(type, object) {
  return { id: 'evt_' + Math.random().toString(36).slice(2), type, data: { object } };
}

function call(event) {
  return run(stripeWebhookHandler, event, { 'stripe-signature': 't=1,v1=fake' });
}

describe('stripeWebhook', () => {
  let client;
  beforeEach(() => {
    stripeMock.reset();
    client = makeClient({ seed: { User: [seedUser] }, user: seedUser });
    active.current = client;
  });

  it('checkout.session.completed → abonnement actif (Pro)', async () => {
    const subId = 'sub_1';
    stripeMock.subs[subId] = {
      id: subId, customer: 'cus_1', status: 'active',
      current_period_end: Math.floor((Date.now() + 30 * DAY) / 1000),
      items: { data: [{ price: { id: 'price_pro' } }] },
      metadata: { user_id: USER_ID, email: USER_EMAIL },
      cancel_at: null, canceled_at: null, trial_end: null,
    };
    const event = evt('checkout.session.completed', { client_reference_id: USER_ID, subscription: subId });

    const { status, data } = await call(event);
    expect(status).toBe(200);
    expect(data.received).toBe(true);

    const subs = client.all('Subscription');
    expect(subs.length).toBe(1);
    expect(subs[0].plan).toBe('pro');
    expect(subs[0].status).toBe('active');
    expect(subs[0].stripe_subscription_id).toBe(subId);

    const users = client.all('User');
    expect(users[0].plan).toBe('pro');
    expect(users[0].subscription_status).toBe('active');
  });

  it('invoice.payment_failed > 7j de retard → downgrade starter immédiat', async () => {
    client._records('Subscription').push({
      id: 'rec_1', user_id: USER_ID, owner_id: USER_EMAIL, plan: 'pro',
      stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_2', status: 'active',
    });
    client._records('User')[0].plan = 'pro';
    client._records('User')[0].subscription_status = 'active';

    stripeMock.subs['sub_2'] = {
      id: 'sub_2', customer: 'cus_1', status: 'past_due',
      current_period_end: Math.floor((Date.now() - 8 * DAY) / 1000),
      items: { data: [{ price: { id: 'price_pro' } }] },
    };

    const { status } = await call(evt('invoice.payment_failed', { customer: 'cus_1', subscription: 'sub_2' }));
    expect(status).toBe(200);

    const users = client.all('User');
    expect(users[0].plan).toBe('starter');
    expect(users[0].subscription_status).toBe('none');
    expect(client.all('Subscription')[0].status).toBe('ended');
  });

  it('invoice.payment_failed < 7j → reste en past_due (grace)', async () => {
    client._records('Subscription').push({
      id: 'rec_1', user_id: USER_ID, plan: 'pro',
      stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_2', status: 'active',
    });
    client._records('User')[0].plan = 'pro';
    client._records('User')[0].subscription_status = 'active';

    stripeMock.subs['sub_2'] = {
      id: 'sub_2', customer: 'cus_1', status: 'past_due',
      current_period_end: Math.floor((Date.now() - 2 * DAY) / 1000),
      items: { data: [{ price: { id: 'price_pro' } }] },
    };

    await call(evt('invoice.payment_failed', { customer: 'cus_1', subscription: 'sub_2' }));
    expect(client.all('User')[0].plan).toBe('pro');
    expect(client.all('User')[0].subscription_status).toBe('past_due');
  });

  it('customer.subscription.deleted (période passée) → downgrade starter', async () => {
    client._records('Subscription').push({
      id: 'rec_1', user_id: USER_ID, plan: 'pro',
      stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_3', status: 'active',
    });
    client._records('User')[0].plan = 'pro';
    client._records('User')[0].subscription_status = 'active';

    const sub = {
      id: 'sub_3', customer: 'cus_1', status: 'canceled',
      current_period_end: Math.floor((Date.now() - 1 * DAY) / 1000),
      metadata: { user_id: USER_ID }, cancel_at: null, canceled_at: Math.floor(Date.now() / 1000),
    };
    const { status } = await call(evt('customer.subscription.deleted', sub));
    expect(status).toBe(200);
    expect(client.all('User')[0].plan).toBe('starter');
    expect(client.all('User')[0].subscription_status).toBe('none');
  });

  it('customer.subscription.deleted (période future) → canceled, garde l\'accès', async () => {
    client._records('Subscription').push({
      id: 'rec_1', user_id: USER_ID, plan: 'pro',
      stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_4', status: 'active',
    });
    client._records('User')[0].plan = 'pro';
    client._records('User')[0].subscription_status = 'active';

    const future = Math.floor((Date.now() + 15 * DAY) / 1000);
    const sub = {
      id: 'sub_4', customer: 'cus_1', status: 'canceled',
      current_period_end: future, metadata: { user_id: USER_ID },
      cancel_at: future, canceled_at: Math.floor(Date.now() / 1000),
    };
    await call(evt('customer.subscription.deleted', sub));
    expect(client.all('User')[0].plan).toBe('pro');
    expect(client.all('User')[0].subscription_status).toBe('canceled');
  });

  it('signature invalide → 400 (rien n\'est écrit)', async () => {
    stripeMock.verify = false;
    const { status } = await call(evt('checkout.session.completed', {}));
    expect(status).toBe(400);
    expect(client.all('Subscription').length).toBe(0);
  });
});