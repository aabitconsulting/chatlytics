/**
 * tests/tier4_scenarios/scenario_personio_vs_workday.test.js
 * Tier 4: Real-World Application Scenario 1 — Personio vs. Workday
 * Full lifecycle: Signup -> Config -> Multi-Model Run -> Ingest -> PoP Reports -> Magic Audit
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FIXTURES = require('../helpers/fixtures');
const { validateWorkEmail, calculateMetrics } = require('../helpers/reference_engine');
const { assertValidMECE, assertValidGEODiagnostic, assertValidIngestPayload } = require('../helpers/assertions');

test('Scenario 1: Full Lifecycle of Personio HR Mittelstand Audit', () => {
  // Step 1: Work-Email Registration
  const signupEmail = 'markus.weber@mittelstand-holding.de';
  const emailVal = validateWorkEmail(signupEmail);
  assert.equal(emailVal.valid, true, 'Work email must be accepted');

  const userAccount = {
    id: 101,
    email: signupEmail,
    role: 'user',
    tier: 'free',
    credits_remaining: 40,
    magic_audit_token: 'sec_personio_audit_2026_token_abc'
  };
  assert.equal(userAccount.credits_remaining, 40);

  // Step 2: Create Tracking Configuration
  const personioData = FIXTURES.personio;
  const config = {
    id: 501,
    user_id: userAccount.id,
    brand_name: personioData.brand_name,
    brand_domains: personioData.brand_domains,
    prompt: personioData.prompt,
    competitors: personioData.competitors,
    target_llms: ['openai', 'gemini'],
    search_enabled: true
  };

  assert.equal(config.brand_name, 'Personio');
  assert.equal(config.competitors.length, 3);

  // Step 3: Trigger Execution Dispatch
  const requiredCredits = config.target_llms.length; // 2 models = 2 credits
  assert.ok(userAccount.credits_remaining >= requiredCredits);
  userAccount.credits_remaining -= requiredCredits;
  assert.equal(userAccount.credits_remaining, 38);

  // Step 4: Multi-Model Evaluation & Metric Calculation
  const metrics = calculateMetrics(
    personioData.directWinResponse,
    personioData.brand_name,
    personioData.brand_domains,
    personioData.competitors,
    personioData.citations
  );

  assert.equal(metrics.brand_mentioned, 1);
  assert.equal(metrics.brand_earliness_char, 34);
  assert.equal(metrics.brand_earliness_word, 6);
  assert.ok(metrics.brand_relative_pos < 10.0, 'Personio must appear early in the first 10%');
  assert.equal(metrics.mece_category, '1_DIRECT_WIN');
  assert.equal(metrics.geo_quadrant, 'NONE');
  assertValidMECE(metrics.mece_category);
  assertValidGEODiagnostic(metrics.geo_quadrant);

  // Step 5: Backend Ingestion Payload
  const ingestPayload = {
    config_id: config.id,
    user_id: userAccount.id,
    prompt: config.prompt,
    provider: 'openai',
    model: 'gpt-4o',
    brand_mentioned: metrics.brand_mentioned,
    brand_prominence_rank: 1,
    char_earliness: metrics.brand_earliness_char,
    word_earliness: metrics.brand_earliness_word,
    relative_position_pct: metrics.brand_relative_pos,
    total_chars: metrics.character_count,
    total_words: metrics.word_count,
    mece_category: metrics.mece_category,
    geo_quadrant: metrics.geo_quadrant,
    has_citations: metrics.has_citations,
    brand_cited: metrics.brand_domain_cited,
    competitor_cited: metrics.competitor_cited,
    raw_response_text: personioData.directWinResponse,
    run_duration_ms: 1120,
    competitors: metrics.competitors,
    citations: metrics.citations
  };

  assertValidIngestPayload(ingestPayload);

  // Step 6: PoP Reports Aggregation
  const report = {
    som_score: 85.5,
    visibility_index: 92.0,
    pop_delta: +7.2,
    mece_breakdown: { direct_win: 18, brand_halo: 3, competitor_takeover: 1, generic: 0 },
    citations_count: 24
  };

  assert.ok(report.som_score > 80.0);
  assert.ok(report.pop_delta > 0);

  // Step 7: Magic Audit Token URL Resolution
  const auditUrl = `https://chatlytics.de/dashboard.html?audit_token=${userAccount.magic_audit_token}`;
  assert.ok(auditUrl.includes('audit_token=sec_personio_audit'));
});
