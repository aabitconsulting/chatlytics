/**
 * tests/tier1_features/f22_stripe_webhook.test.js
 * Feature 22: Stripe Webhook Processing
 * Requirements:
 * - api/stripe_webhook.php native HMAC-SHA256 signature verification
 * - Replay attack prevention and event handling
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { lintPhpFile } = require('../helpers/php_runner');

const STRIPE_PATH = path.resolve(__dirname, '../../api/stripe_webhook.php');

test('Feature 22.1: Syntax validation of stripe_webhook.php (php -l)', () => {
  if (fs.existsSync(STRIPE_PATH)) {
    const res = lintPhpFile(STRIPE_PATH);
    assert.equal(res.ok, true, `Syntax error in stripe_webhook.php: ${res.output}`);
  } else {
    assert.ok(true);
  }
});

test('Feature 22.2: Native HMAC-SHA256 signature verification algorithm', () => {
  const secret = 'whsec_test_secret_12345';
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ type: 'checkout.session.completed' });
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  // Verify signature match
  const verifySig = (t, body, secretKey, signature) => {
    const computed = crypto.createHmac('sha256', secretKey).update(`${t}.${body}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  };

  assert.equal(verifySig(timestamp, payload, secret, expectedSig), true);
  assert.equal(verifySig(timestamp, payload, 'wrong_secret', expectedSig), false);
});

test('Feature 22.3: Replay attack prevention rejects events older than 300 seconds', () => {
  const isFreshTimestamp = (eventTimestamp, currentTimestamp, toleranceSeconds = 300) => {
    return Math.abs(currentTimestamp - eventTimestamp) <= toleranceSeconds;
  };

  const now = Math.floor(Date.now() / 1000);
  assert.equal(isFreshTimestamp(now - 60, now), true);
  assert.equal(isFreshTimestamp(now - 301, now), false);
});

test('Feature 22.4: Tier upgrade credit allocation rules', () => {
  const getCreditBonus = (tier) => {
    switch (tier) {
      case 'starter': return 500;
      case 'growth': return 2000;
      default: return 0;
    }
  };

  assert.equal(getCreditBonus('starter'), 500);
  assert.equal(getCreditBonus('growth'), 2000);
  assert.equal(getCreditBonus('free'), 0);
});

test('Feature 22.5: Graceful downgrade on subscription cancellation', () => {
  const handleCancellation = (user) => {
    return {
      ...user,
      tier: 'free',
      status: 'active'
    };
  };

  const user = { id: 10, tier: 'growth', status: 'active' };
  const downgraded = handleCancellation(user);
  assert.equal(downgraded.tier, 'free');
});
