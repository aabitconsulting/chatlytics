/**
 * tests/tier3_combinations/comb_router_to_metrics.test.js
 * Tier 3: Cross-Feature Combination — Provider Output -> Secondary Extractor -> Metric Engine
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../helpers/reference_engine');
const { assertValidMECE, assertValidGEODiagnostic } = require('../helpers/assertions');

test('Combination 3.3: Gemini Grounding search response parsed into metrics & GEO diagnostics', () => {
  // Synthetic raw Gemini candidates response
  const rawGeminiResponse = {
    candidates: [
      {
        content: {
          parts: [
            { text: 'Für den deutschen Mittelstand ist Personio die führende HR-Software, da sie alle Prozesse integriert.' }
          ]
        },
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: 'https://www.personio.de/ueber-uns', title: 'Über Personio' } },
            { web: { uri: 'https://haufe.de/personal/software', title: 'Haufe HR Vergleich' } }
          ]
        }
      }
    ]
  };

  const text = rawGeminiResponse.candidates[0].content.parts.map(p => p.text).join('');
  const citations = rawGeminiResponse.candidates[0].groundingMetadata.groundingChunks.map(chunk => ({
    citation_url: chunk.web.uri,
    citation_domain: new URL(chunk.web.uri).hostname.replace(/^www\./, ''),
    citation_title: chunk.web.title
  }));

  const metrics = engine.calculateMetrics(text, 'Personio', ['personio.de'], ['Workday', 'BambooHR'], citations);

  assert.equal(metrics.brand_mentioned, 1);
  assert.equal(metrics.brand_domain_cited, 1);
  assert.equal(metrics.mece_category, '1_DIRECT_WIN');
  assert.equal(metrics.geo_quadrant, 'NONE');
  assertValidMECE(metrics.mece_category);
  assertValidGEODiagnostic(metrics.geo_quadrant);
});

test('Combination 3.4: OpenAI raw completion parsed into competitive takeover classification', () => {
  const rawOpenAiResponse = {
    choices: [
      {
        message: {
          content: 'Im Bereich Unternehmenssoftware dominiert Workday den internationalen Markt mit umfassenden Modulen.'
        }
      }
    ]
  };

  const text = rawOpenAiResponse.choices[0].message.content;
  const metrics = engine.calculateMetrics(text, 'Personio', ['personio.de'], ['Workday']);

  assert.equal(metrics.brand_mentioned, 0);
  assert.equal(metrics.competitors[0].mentioned, 1);
  assert.equal(metrics.mece_category, '3_COMPETITOR_TAKEOVER');
});
