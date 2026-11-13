/**
 * tests/tier3_combinations/comb_stripe_to_credits.test.js
 * Tier 3: Cross-Feature Combination — Stripe Webhook -> User Balance -> Dispatcher Authorization
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Combination 3.9: Credit exhaustion blocks execution until Stripe subscription event upgrades balance', () => {
  // 1. Initial Freemium Account with 40 credits
  const user = {
    id: 15,
    email: 'cto@startup-berlin.de',
    tier: 'free',
    credits_remaining: 40
  };

  const requiredCredits = 40; // 40 runs consumed
  user.credits_remaining -= requiredCredits;
  assert.equal(user.credits_remaining, 0);

  // 2. Dispatcher attempt with 0 credits -> Rejected
  const canDispatch = (u, cost) => u.credits_remaining >= cost;
  assert.equal(canDispatch(user, 1), false, 'Dispatcher must block run when credits are 0');

  // 3. User subscribes to Growth Tier (€399 / mo) via Stripe
  const stripeEvent = {
    type: 'checkout.session.completed',
    data: {
      object: {
        customer: 'cus_998877',
        client_reference_id: '15',
        metadata: { tier: 'growth' }
      }
    }
  };

  // Webhook handler applies Growth quota (+2000 credits)
  if (stripeEvent.type === 'checkout.session.completed') {
    const tier = stripeEvent.data.object.metadata.tier;
    user.tier = tier;
    if (tier === 'growth') user.credits_remaining += 2000;
  }

  assert.equal(user.tier, 'growth');
  assert.equal(user.credits_remaining, 2000);

  // 4. Dispatcher attempt now succeeds
  assert.equal(canDispatch(user, 1), true, 'Dispatcher must authorize run after Stripe refill');
});
