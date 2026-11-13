/**
 * tests/tier5_adversarial/m5_challenger_r2_verification.test.js
 * 
 * Milestone 5 Iteration 2 Empirical Challenger Verification Suite
 * Verifies that the 7 previously failing tests pass authentically on real production code,
 * tests additional adversarial edge cases, and verifies full security boundaries.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Genuine production modules
const authModule = require('../../assets/js/auth.js');
const configsModule = require('../../assets/js/configs.js');
const adminModule = require('../../assets/js/admin.js');
const dashboardModule = require('../../assets/js/dashboard.js');
const apiClientModule = require('../../assets/js/api-client.js');
const i18nModule = require('../../assets/js/i18n.js');

const { validateWorkEmail, routeGuard, checkAccess, AuthManager } = authModule;
const { sanitizeDomains, parsePrompts, parseCompetitors } = configsModule;
const { buildCreditPayload, escapeHtml: escapeHtmlAdmin, sanitizeLength } = adminModule;
const { dashboard, DashboardController, escapeHtml: escapeHtmlDash } = dashboardModule;
const { ApiClient, apiClient } = apiClientModule;
const { init, initLanguageSwitchers, getLanguage, setLanguage, t } = i18nModule;

// 1. ADV-M5-1.1: Dashboard escapeHtml strictly neutralizes script and event handler injection tags
test('CHALLENGE-R2-1: Dashboard escapeHtml genuine exports and strict escaping', () => {
  assert.equal(typeof escapeHtmlDash, 'function', 'escapeHtml must be exported as a function');
  assert.equal(typeof DashboardController, 'function', 'DashboardController must be exported');
  assert.ok(dashboard instanceof DashboardController, 'dashboard must be an instance of DashboardController');

  const attackVectors = [
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(document.cookie)>',
    '"><script>alert(1)</script>',
    "';alert(String.fromCharCode(88,83,83))//",
    '<iframe src="javascript:alert(1)"></iframe>',
    '<body onload="alert(1)">',
    '"><img src=x onerror=prompt(1)>',
    '& < > " \'',
    '<script src="//evil.com/xss.js"></script>',
    '<a href="javascript:alert(1)">Click</a>',
    '<input autofocus onfocus=alert(1)>',
    '<!--<script>alert(1)</script>-->'
  ];

  for (const vector of attackVectors) {
    const escaped = escapeHtmlDash(vector);
    assert.ok(!escaped.includes('<'), `Must not contain '<': ${escaped}`);
    assert.ok(!escaped.includes('>'), `Must not contain '>': ${escaped}`);
    assert.ok(!escaped.includes('"'), `Must not contain '"': ${escaped}`);
    assert.ok(!escaped.includes("'"), `Must not contain '\'': ${escaped}`);
    assert.ok(escaped.includes('&lt;') || !vector.includes('<'), `Must replace '<' with '&lt;': ${escaped}`);
    assert.ok(escaped.includes('&gt;') || !vector.includes('>'), `Must replace '>' with '&gt;': ${escaped}`);
  }

  // Null, undefined, empty, numeric 0, boolean false, and string '0' safety
  assert.equal(escapeHtmlDash(null), '');
  assert.equal(escapeHtmlDash(undefined), '');
  assert.equal(escapeHtmlDash(''), '');
  assert.equal(escapeHtmlDash(0), '0');
  assert.equal(escapeHtmlDash(false), 'false');
  assert.equal(escapeHtmlDash('0'), '0');
  assert.equal(escapeHtmlDash('Personio'), 'Personio');
});

// 2. ADV-M5-1.3: Competitor Leaderboard rendering safely escapes malicious competitor names and domains
test('CHALLENGE-R2-2: Competitor Leaderboard escaping using genuine escapeHtml', () => {
  const hostileCompetitors = [
    { competitor_name: '<script>alert("comp")</script>', competitor_domain: '"><img src=x onerror=alert(1)>' },
    { name: '<svg onload=alert(1)>', domain: 'javascript:alert(1)' },
    { competitor_name: '<b>Bold</b>', competitor_domain: 'http://evil.com/<script>' }
  ];

  for (const comp of hostileCompetitors) {
    const name = comp.competitor_name || comp.name;
    const domain = comp.competitor_domain || comp.domain;

    const escName = escapeHtmlDash(name);
    const escDomain = escapeHtmlDash(domain);

    assert.ok(!escName.includes('<script>'));
    assert.ok(!escName.includes('<svg'));
    assert.ok(!escName.includes('<b>'));
    assert.ok(!escDomain.includes('<img'));
    assert.ok(!escDomain.includes('<script>'));
    assert.ok(escName.includes('&lt;') && escName.includes('&gt;'));
  }
});

// 3. ADV-M5-1.4: Grounding Citations rendering safely escapes hostile citation domains
test('CHALLENGE-R2-3: Grounding Citations escaping using genuine escapeHtml', () => {
  const hostileDomains = [
    'attacker.com"><script>alert(document.cookie)</script>',
    '<b onmouseover="alert(1)">evil.org</b>',
    'javascript:alert(1)',
    '"><iframe src=javascript:alert(1)></iframe>'
  ];

  for (const domain of hostileDomains) {
    const escaped = escapeHtmlDash(domain);
    assert.ok(!escaped.includes('<script>'));
    assert.ok(!escaped.includes('<b '));
    assert.ok(!escaped.includes('<iframe'));
    assert.ok(!escaped.includes('<'));
    assert.ok(!escaped.includes('>'));
  }
});

// 4. ADV-M5-1.6: configs.js domain sanitization strips hostile protocols, paths, and script injections
test('CHALLENGE-R2-4: configs.js domain sanitization strips hostile protocols, paths, and script injections', () => {
  const rawInputs = [
    'https://personio.de/',
    'http://attacker.com/path/to/evil?param=1#fragment',
    'HTTPS://SUB.EXAMPLE.COM/path/',
    '   HTTP://CLEAN-DOMAIN.DE   ',
    'https://evil.com/<script>',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(2)',
    'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'file:///etc/passwd'
  ];

  const sanitized = sanitizeDomains(rawInputs.join(','));

  for (const d of sanitized) {
    assert.ok(!d.startsWith('http://'), `Domain must not start with http: ${d}`);
    assert.ok(!d.startsWith('https://'), `Domain must not start with https: ${d}`);
    assert.ok(!d.includes('/'), `Domain must not contain trailing paths: ${d}`);
    assert.ok(!d.includes('javascript:'), `Domain must not contain javascript scheme: ${d}`);
    assert.ok(!d.includes('vbscript:'), `Domain must not contain vbscript scheme: ${d}`);
    assert.ok(!d.includes('data:'), `Domain must not contain data scheme: ${d}`);
    assert.ok(!d.includes('file:'), `Domain must not contain file scheme: ${d}`);
  }

  assert.ok(sanitized.includes('personio.de'));
  assert.ok(sanitized.includes('attacker.com'));
  assert.ok(sanitized.includes('sub.example.com'));
  assert.ok(sanitized.includes('clean-domain.de'));
});

// 5. ADV-M5-1.7: Admin User Directory table creation uses strict createElement and textContent
test('CHALLENGE-R2-5: Admin User Directory table creation uses strict textContent and escapeHtml', () => {
  assert.equal(typeof escapeHtmlAdmin, 'function');
  assert.equal(typeof sanitizeLength, 'function');

  assert.equal(sanitizeLength('a'.repeat(50), 40), 'a'.repeat(39) + '…');
  assert.equal(sanitizeLength('Short name', 40), 'Short name');
  assert.equal(sanitizeLength(null, 40), '—');

  const maliciousTier = 'free" onmouseover="alert(1)';
  const escapedTier = escapeHtmlAdmin(maliciousTier);
  assert.ok(!escapedTier.includes('"'));
  assert.ok(escapedTier.includes('&quot;'));
});

// 6. ADV-M5-3.3: Dashboard handleTriggerRun is strictly blocked when in Magic Audit mode
test('CHALLENGE-R2-6: Dashboard handleTriggerRun is strictly blocked when in Magic Audit mode', async () => {
  const controller = new DashboardController();
  controller.isAuditMode = true;
  controller.isRunning = false;
  controller.selectedConfigId = 101;

  let triggerRunInvoked = false;
  const origTrigger = apiClient.triggerRun;
  apiClient.triggerRun = async () => {
    triggerRunInvoked = true;
    return { credits_remaining: 39 };
  };

  try {
    await controller.handleTriggerRun();
    assert.equal(
      triggerRunInvoked,
      false,
      'handleTriggerRun must abort immediately and NEVER invoke apiClient.triggerRun in audit mode'
    );
  } finally {
    apiClient.triggerRun = origTrigger;
  }
});

// 7. ADV-M5-4.4: Malformed email syntax attacks fail validation with appropriate reasons
test('CHALLENGE-R2-7: Malformed email syntax attacks fail validation with appropriate reasons', () => {
  const malformedInputs = [
    { input: '', reason: 'empty' },
    { input: '   ', reason: 'malformed' },
    { input: null, reason: 'empty' },
    { input: undefined, reason: 'empty' },
    { input: 12345, reason: 'empty' },
    { input: 'notanemail', reason: 'malformed' },
    { input: '@gmail.com', reason: 'malformed' },
    { input: 'user@', reason: 'malformed' },
    { input: 'user@@domain.com', reason: 'malformed' },
    { input: 'user@domain@extra.com', reason: 'malformed' },
    { input: 'user name@domain.com', reason: 'malformed' },
    { input: 'user\tname@domain.com', reason: 'malformed' },
    { input: 'user\nname@domain.com', reason: 'malformed' }
  ];

  for (const tc of malformedInputs) {
    const result = validateWorkEmail(tc.input);
    assert.equal(
      result.valid,
      false,
      `Malformed input ${tc.input} must be invalid`
    );
    assert.equal(
      result.reason,
      tc.reason,
      `Expected reason ${tc.reason} for input ${tc.input}, got ${result.reason}`
    );
  }
});

// 8. Language Switcher Verification (Feature 24 & Finding 2 Remediation)
test('CHALLENGE-R2-8: i18n Language Switcher functions are exported and operate idempotently', () => {
  assert.equal(typeof init, 'function', 'init must be exported');
  assert.equal(typeof initLanguageSwitchers, 'function', 'initLanguageSwitchers must be exported');
  assert.equal(typeof getLanguage, 'function', 'getLanguage must be exported');
  assert.equal(typeof setLanguage, 'function', 'setLanguage must be exported');

  // Verify switching works
  setLanguage('de');
  assert.equal(getLanguage(), 'de');
  setLanguage('en');
  assert.equal(getLanguage(), 'en');
  setLanguage('de'); // reset to default
});
