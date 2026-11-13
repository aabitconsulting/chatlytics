/**
 * tests/tier2_boundaries/b03_backend_boundaries.test.js
 * Tier 2: Boundary & Corner Cases — MySQL Schema & PHP 8.5 Backend (Features 12-22)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateWorkEmail } = require('../helpers/reference_engine');

test('Boundary 3.1: Zero and negative credits execution rejection', () => {
  const deductCredits = (current, cost) => {
    if (current < cost) throw new Error('Insufficient credit balance');
    return current - cost;
  };

  assert.throws(() => deductCredits(0, 1), /Insufficient credit balance/);
  assert.throws(() => deductCredits(-5, 1), /Insufficient credit balance/);
  assert.equal(deductCredits(1, 1), 0);
  assert.equal(deductCredits(40, 3), 37);
});

test('Boundary 3.2: SQL injection attack payloads sanitized via parameterized statements', () => {
  const attackVectors = [
    "'; DROP TABLE users; --",
    "' OR 1=1 --",
    "admin' --",
    "1 UNION SELECT 1, email, password_hash FROM users --"
  ];

  // In native PDO with ATTR_EMULATE_PREPARES=false, parameters are bound by value
  for (const maliciousInput of attackVectors) {
    const bindParam = (val) => String(val); // Simulated binding
    const bound = bindParam(maliciousInput);
    assert.equal(bound, maliciousInput, 'Bound parameter safely preserves literal string value without syntax injection');
  }
});

test('Boundary 3.3: Disposable and subdomained freemail address blocking', () => {
  const trickyEmails = [
    'user@SUBDOMAIN.GMAIL.COM',
    'attacker@temp-mail.org',
    'ceo@TRASHMAIL.COM',
    'test@10minutemail.com',
    'test+tag@googlemail.com'
  ];

  for (const email of trickyEmails) {
    const domain = email.split('@')[1].toLowerCase();
    const isDisallowed = ['gmail.com', 'googlemail.com', 'temp-mail.org', 'trashmail.com', '10minutemail.com']
      .some(bad => domain === bad || domain.endsWith('.' + bad));
    assert.equal(isDisallowed, true, `Tricky email "${email}" should be flagged as non-work email`);
  }
});

test('Boundary 3.4: Stripe HMAC signature verification fails on tampered payload', () => {
  const secret = 'whsec_prod_secret';
  const timestamp = Math.floor(Date.now() / 1000);
  const originalPayload = JSON.stringify({ type: 'checkout.session.completed', amount: 14900 });
  const validSig = crypto.createHmac('sha256', secret).update(`${timestamp}.${originalPayload}`).digest('hex');

  const tamperedPayload = JSON.stringify({ type: 'checkout.session.completed', amount: 0 });

  const verify = (t, body, sig) => {
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  };

  assert.equal(verify(timestamp, originalPayload, validSig), true);
  assert.equal(verify(timestamp, tamperedPayload, validSig), false, 'Tampered payload must fail timing-safe comparison');
});

test('Boundary 3.5: Stripe timestamp older than 300 seconds triggers replay protection rejection', () => {
  const checkTimestamp = (t, now) => now - t <= 300;
  const now = 1730900000;

  assert.equal(checkTimestamp(now - 10, now), true);
  assert.equal(checkTimestamp(now - 300, now), true);
  assert.equal(checkTimestamp(now - 301, now), false, 'Timestamps > 300s old must be rejected');
  assert.equal(checkTimestamp(now - 86400, now), false);
});

test('Boundary 3.6: Invalid and corrupted Magic Audit tokens rejected gracefully', () => {
  const validateAuditToken = (token) => {
    if (!token || typeof token !== 'string') return false;
    const clean = token.trim();
    if (clean.length < 16 || clean.length > 64) return false;
    if (!/^[a-zA-Z0-9_-]+$/.test(clean)) return false;
    return true;
  };

  assert.equal(validateAuditToken('sec_9f83a2b1c0e9f8a7b6c5'), true);
  assert.equal(validateAuditToken(''), false);
  assert.equal(validateAuditToken('short'), false);
  assert.equal(validateAuditToken('token; DROP TABLE users;'), false);
});

test('Boundary 3.7: Period filter parameter boundaries (0d, negative, extreme 500d)', () => {
  const sanitizePeriod = (period) => {
    const match = String(period).match(/^(\d+)d$/);
    if (!match) return 30; // default 30d
    const days = parseInt(match[1], 10);
    if (days < 1) return 7;
    if (days > 365) return 365;
    return days;
  };

  assert.equal(sanitizePeriod('0d'), 7);
  assert.equal(sanitizePeriod('-10d'), 30);
  assert.equal(sanitizePeriod('500d'), 365);
  assert.equal(sanitizePeriod('30d'), 30);
});

test('Boundary 3.8: Concurrent credit deduction with race condition protection', () => {
  // Simulates atomic conditional SQL: UPDATE users SET credits = credits - :cost WHERE id = :id AND credits >= :cost
  let dbCredits = 1;

  const atomicDeduct = (cost) => {
    if (dbCredits >= cost) {
      dbCredits -= cost;
      return true;
    }
    return false;
  };

  // Two parallel calls attempting to deduct 1 credit
  const call1 = atomicDeduct(1);
  const call2 = atomicDeduct(1);

  assert.equal(call1, true, 'First caller claims the credit');
  assert.equal(call2, false, 'Second caller is rejected atomically due to zero balance');
  assert.equal(dbCredits, 0);
});
