/**
 * tests/tier3_combinations/comb_metrics_to_ingest.test.js
 * Tier 3: Cross-Feature Combination — Metric Engine -> Ingestion Webhook Contract
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../helpers/reference_engine');
const { assertValidIngestPayload } = require('../helpers/assertions');

test('Combination 3.5: Computed metric output wraps into 100% compliant ingestion payload', () => {
  const text = 'Personio führt, Workday folgt.';
  const brandName = 'Personio';
  const brandDomains = ['personio.de'];
  const competitors = [{ name: 'Workday', domain: 'workday.com' }];
  const citations = [{ citation_domain: 'personio.de', citation_url: 'https://personio.de' }];

  const metrics = engine.calculateMetrics(text, brandName, brandDomains, competitors, citations);

  const ingestPayload = {
    config_id: 42,
    user_id: 7,
    prompt: 'Beste HR Software?',
    provider: 'openai',
    model: 'gpt-4o',
    brand_mentioned: metrics.brand_mentioned,
    brand_prominence_rank: metrics.brand_mentioned ? 1 : null,
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
    raw_response_text: text,
    run_duration_ms: 850,
    competitors: metrics.competitors,
    citations: metrics.citations
  };

  assertValidIngestPayload(ingestPayload);
  assert.equal(ingestPayload.mece_category, '1_DIRECT_WIN');
  assert.equal(ingestPayload.competitors.length, 1);
  assert.equal(ingestPayload.citations.length, 1);
});
