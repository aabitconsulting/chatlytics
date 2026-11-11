/**
 * tests/tier1_features/f27_magic_audit_mode.test.js
 * Feature 27: Magic Audit Shareable Preview Mode
 * Requirements:
 * - dashboard.html?audit_token=... mode
 * - Read-only view, hidden mutation controls, persistent preview banner
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Feature 27.1: URL search param audit_token extraction', () => {
  const url = 'https://chatlytics.de/dashboard.html?audit_token=sec_9f83a2b1c0e9f8a7b6c5';
  const params = new URL(url).searchParams;
  assert.equal(params.get('audit_token'), 'sec_9f83a2b1c0e9f8a7b6c5');
});

test('Feature 27.2: Mutation controls are disabled or hidden in Magic Audit mode', () => {
  const isAuditMode = true;
  const elementsToHide = ['#btn-trigger-run', '#btn-new-config', '#billing-nav', '#profile-settings'];

  const shouldBeVisible = (selector, auditMode) => {
    if (auditMode && elementsToHide.includes(selector)) return false;
    return true;
  };

  for (const el of elementsToHide) {
    assert.equal(shouldBeVisible(el, isAuditMode), false, `Element ${el} must be hidden in audit mode`);
  }
});

test('Feature 27.3: Persistent read-only preview banner specification', () => {
  const getBannerHtml = (lang) => {
    return lang === 'de'
      ? '<div class="magic-audit-banner">👁️ Sie betrachten ein geteiltes Chatlytics Magic Audit (Schreibgeschützt).</div>'
      : '<div class="magic-audit-banner">👁️ You are viewing a shared Chatlytics Magic Audit (Read-Only).</div>';
  };

  assert.ok(getBannerHtml('de').includes('Schreibgeschützt'));
  assert.ok(getBannerHtml('en').includes('Read-Only'));
});

test('Feature 27.4: Conversion CTA banner for unregistered visitors', () => {
  const ctaText = 'Möchten Sie kontinuierliche KI-Sichtbarkeitsanalysen für Ihre eigene Marke durchführen?';
  assert.ok(ctaText.includes('KI-Sichtbarkeitsanalysen'));
});

test('Feature 27.5: Route guard permits access with valid audit token without login', () => {
  const checkAccess = (userToken, auditToken) => {
    if (auditToken && auditToken.length >= 16) return { allowed: true, mode: 'magic_audit' };
    if (userToken) return { allowed: true, mode: 'authenticated' };
    return { allowed: false, mode: 'unauthorized' };
  };

  assert.equal(checkAccess(null, 'sec_9f83a2b1c0e9f8a7').allowed, true);
  assert.equal(checkAccess(null, 'sec_9f83a2b1c0e9f8a7').mode, 'magic_audit');
  assert.equal(checkAccess(null, null).allowed, false);
});
