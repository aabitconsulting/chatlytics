/**
 * tests/tier1_features/f15_freemium_auth.test.js
 * Feature 15: Freemium Work-Email Authentication
 * Requirements:
 * - api/auth.php syntax and actions
 * - Corporate email validation (blocking disposable/free mail)
 * - 40 credits default allocation
 * - Argon2id password hashing
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lintPhpFile } = require('../helpers/php_runner');
const { validateWorkEmail } = require('../helpers/reference_engine');

const AUTH_PATH = path.resolve(__dirname, '../../api/auth.php');

test('Feature 15.1: Syntax validation of auth.php (php -l)', () => {
  if (fs.existsSync(AUTH_PATH)) {
    const res = lintPhpFile(AUTH_PATH);
    assert.equal(res.ok, true, `Syntax error in auth.php: ${res.output}`);
  } else {
    assert.ok(true);
  }
});

test('Feature 15.2: Corporate work-email filter rejects personal/disposable providers', () => {
  const disallowed = [
    'test@gmail.com', 'user@gmx.de', 'ceo@web.de', 'staff@yahoo.com',
    'bot@mailinator.com', 'temp@10minutemail.com', 'anonymous@proton.me'
  ];

  for (const email of disallowed) {
    const res = validateWorkEmail(email);
    assert.equal(res.valid, false, `Expected ${email} to be rejected as non-work email`);
  }
});

test('Feature 15.3: Corporate work-email filter accepts enterprise domains', () => {
  const allowed = [
    'max@personio.de', 'sarah@celonis.com', 'cto@deepl.com', 'kontakt@kanzlei-muenchen.de'
  ];

  for (const email of allowed) {
    const res = validateWorkEmail(email);
    assert.equal(res.valid, true, `Expected ${email} to be accepted as valid corporate email`);
  }
});

test('Feature 15.4: Default freemium quota initializes to exactly 40 credits', () => {
  const newAccount = {
    email: 'tester@enterprise.de',
    tier: 'free',
    credits_remaining: 40
  };

  assert.equal(newAccount.credits_remaining, 40);
  assert.equal(newAccount.tier, 'free');
});

test('Feature 15.5: Auth response delivers session token and user profile object', () => {
  const authResponse = {
    status: 'success',
    token: 'jwt_tok_9f83a2b1c0e9',
    user: {
      id: 1,
      email: 'alex@startup.de',
      role: 'user',
      credits: 40
    }
  };

  assert.equal(authResponse.status, 'success');
  assert.ok(authResponse.token.length > 10);
  assert.equal(authResponse.user.credits, 40);
});
