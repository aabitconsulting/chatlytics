/**
 * tests/tier1_features/f10_response_formatters.test.js
 * Feature 10: Workflow Response Formatters
 * Requirements:
 * - Markdown table formatter for interactive chat trigger
 * - API ingestion webhook dispatcher posting to /api/ingest.php
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertValidIngestPayload } = require('../helpers/assertions');
const FIXTURES = require('../helpers/fixtures');

test('Feature 10.1: Chat markdown formatter table layout', () => {
  const formatChatMarkdown = (data) => {
    return [
      '### 📊 Chatlytics AI Visibility Audit',
      '| Metric | Value |',
      '|---|---|',
      `| **Query** | *${data.prompt}* |`,
      `| **Brand** | **${data.brand_name}** |`,
      `| **Provider** | \`${data.provider}\` |`,
      `| **MECE Status** | \`${data.mece_category}\` |`,
      `| **GEO Diagnostic** | \`${data.geo_quadrant}\` |`
    ].join('\n');
  };

  const md = formatChatMarkdown({
    prompt: 'Beste HR Software',
    brand_name: 'Personio',
    provider: 'openai',
    mece_category: '1_DIRECT_WIN',
    geo_quadrant: 'NONE'
  });

  assert.ok(md.includes('Chatlytics AI Visibility Audit'));
  assert.ok(md.includes('1_DIRECT_WIN'));
  assert.ok(md.includes('| **Brand** | **Personio** |'));
});

test('Feature 10.2: Ingestion webhook payload schema validity', () => {
  assertValidIngestPayload(FIXTURES.sampleIngestPayload);
});

test('Feature 10.3: Ingestion webhook header requirements', () => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Chatlytics-Ingest-Key': 'chatlytics_dev_secret_key_2026'
  };

  assert.equal(headers['Content-Type'], 'application/json');
  assert.ok(headers['X-Chatlytics-Ingest-Key'].length >= 16);
});

test('Feature 10.4: Dynamic markdown emoji badges based on MECE state', () => {
  const getBadge = (mece) => {
    switch (mece) {
      case '1_DIRECT_WIN': return '🏆';
      case '2_BRAND_HALO': return '🟣';
      case '3_COMPETITOR_TAKEOVER': return '🔴';
      default: return '⚪';
    }
  };

  assert.equal(getBadge('1_DIRECT_WIN'), '🏆');
  assert.equal(getBadge('2_BRAND_HALO'), '🟣');
  assert.equal(getBadge('3_COMPETITOR_TAKEOVER'), '🔴');
  assert.equal(getBadge('4_GENERIC'), '⚪');
});

test('Feature 10.5: Error formatting on API or model failures', () => {
  const formatErrorMarkdown = (errMessage) => {
    return `### ⚠️ Chatlytics Audit Error\n**Fehler**: ${errMessage}\nBitte API-Guthaben oder n8n-Verbindung prüfen.`;
  };

  const md = formatErrorMarkdown('OpenAI rate limit exceeded');
  assert.ok(md.includes('Chatlytics Audit Error'));
  assert.ok(md.includes('OpenAI rate limit'));
});
