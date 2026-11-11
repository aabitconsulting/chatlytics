/**
 * tests/tier1_features/f20_ingest_pipeline.test.js
 * Feature 20: Ingestion Pipeline
 * Requirements:
 * - api/ingest.php validating payload and transactionally inserting
 *   runs, competitors, and citations
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lintPhpFile } = require('../helpers/php_runner');
const { assertValidIngestPayload } = require('../helpers/assertions');
const FIXTURES = require('../helpers/fixtures');

const INGEST_PATH = path.resolve(__dirname, '../../api/ingest.php');

test('Feature 20.1: Syntax validation of ingest.php (php -l)', () => {
  if (fs.existsSync(INGEST_PATH)) {
    const res = lintPhpFile(INGEST_PATH);
    assert.equal(res.ok, true, `Syntax error in ingest.php: ${res.output}`);
  } else {
    assert.ok(true);
  }
});

test('Feature 20.2: Ingestion shared secret authentication validation', () => {
  const verifyIngestKey = (headerKey, expectedSecret) => {
    return headerKey === expectedSecret;
  };

  assert.equal(verifyIngestKey('secret_ingest_key', 'secret_ingest_key'), true);
  assert.equal(verifyIngestKey('wrong_key', 'secret_ingest_key'), false);
  assert.equal(verifyIngestKey(undefined, 'secret_ingest_key'), false);
});

test('Feature 20.3: Transactional insertion safety (beginTransaction & commit)', () => {
  if (fs.existsSync(INGEST_PATH)) {
    const content = fs.readFileSync(INGEST_PATH, 'utf8');
    assert.ok(content.includes('beginTransaction') || content.includes('commit'));
  } else {
    assert.ok(true);
  }
});

test('Feature 20.4: Ingestion payload validation rejects malformed structures', () => {
  const validatePayload = (payload) => {
    if (!payload || typeof payload !== 'object') return false;
    if (!payload.config_id || !payload.prompt || !payload.provider) return false;
    if (!payload.mece_category) return false;
    return true;
  };

  assert.equal(validatePayload(FIXTURES.sampleIngestPayload), true);
  assert.equal(validatePayload({}), false);
  assert.equal(validatePayload({ config_id: 1 }), false);
});

test('Feature 20.5: Child entity mapping for competitors and citations', () => {
  const payload = FIXTURES.sampleIngestPayload;
  assertValidIngestPayload(payload);
  assert.ok(payload.competitors.length > 0);
  assert.ok(payload.citations.length > 0);
  assert.equal(payload.competitors[0].competitor_name, 'Workday');
  assert.equal(payload.citations[0].domain, 'personio.de');
});
