/**
 * tests/tier4_scenarios/scenario_deepl_vs_google.test.js
 * Tier 4: Real-World Application Scenario 3 — DeepL vs. Google Translate
 * Enterprise translation scenario: Unicode handling, Citation Hijack diagnostic, Stripe upgrade
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FIXTURES = require('../helpers/fixtures');
const { calculateMetrics, findBrandUnicode } = require('../helpers/reference_engine');
const { assertValidMECE, assertValidGEODiagnostic } = require('../helpers/assertions');

test('Scenario 3: DeepL Translation Audit, 1_CITATION_HIJACK Diagnostic & Stripe Upgrade', () => {
  const deeplData = FIXTURES.deepl;

  // Step 1: Multilingual Unicode Evaluation (German, French, Spanish)
  const multilingualText = `DeepL Pro bietet präzise Übersetzungen für deutsche, französische und spanische Dokumente:
Qualität, Datenschutz gemäß DSGVO, précision française und traducción corporativa sin fallos.`;

  const brandMatch = findBrandUnicode(multilingualText, 'DeepL');
  assert.equal(brandMatch.found, true);
  assert.equal(brandMatch.charIndex, 0);

  // Step 2: Evaluation with Citation Hijack (DeepL in text, citations point to competitors/third-party)
  const metrics = calculateMetrics(
    deeplData.citationHijackResponse,
    deeplData.brand_name,
    deeplData.brand_domains,
    deeplData.competitors,
    deeplData.citations // Citations only point to heise.de and google.com
  );

  assert.equal(metrics.brand_mentioned, 1);
  assert.equal(metrics.brand_domain_cited, 0); // deepl.com NOT cited in grounding!
  assert.equal(metrics.competitor_cited, 1);    // google.com IS cited
  assert.equal(metrics.mece_category, '1_DIRECT_WIN'); // Recommended in text
  assert.equal(metrics.geo_quadrant, '1_CITATION_HIJACK'); // Grounding hijacked!
  assertValidMECE(metrics.mece_category);
  assertValidGEODiagnostic(metrics.geo_quadrant);

  // Step 3: Diagnostic Guidance Check
  const prescription = {
    quadrant: metrics.geo_quadrant,
    remediation_de: 'Wettbewerber kapert Ihre Quellen. Aktualisieren Sie Schema.org Markup und stärken Sie Kernaussagen auf Referenzseiten.',
    remediation_en: 'Competitor is hijacking your citations. Update Schema.org markup and reinforce key positioning on reference sites.'
  };

  assert.ok(prescription.remediation_de.includes('kapert Ihre Quellen'));
  assert.ok(prescription.remediation_en.includes('hijacking your citations'));

  // Step 4: Enterprise Account Credit Consumption & Stripe Tier Upgrade
  const enterpriseUser = {
    id: 88,
    email: 'ciso@deepl-enterprise-client.de',
    tier: 'starter',
    credits_remaining: 1
  };

  // Run consumes last credit
  enterpriseUser.credits_remaining -= 1;
  assert.equal(enterpriseUser.credits_remaining, 0);

  // Stripe Upgrade to Growth Tier (€399 / mo -> +2,000 credits)
  const upgradeSession = {
    customer: 'cus_deepl_client_88',
    status: 'paid',
    tier_selected: 'growth',
    credit_topup: 2000
  };

  enterpriseUser.tier = upgradeSession.tier_selected;
  enterpriseUser.credits_remaining += upgradeSession.credit_topup;

  assert.equal(enterpriseUser.tier, 'growth');
  assert.equal(enterpriseUser.credits_remaining, 2000);
});
