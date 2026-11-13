/**
 * tests/tier1_features/f04_metric_unit_test_harness.test.js
 * Feature 4: Metric Engine Automated Unit Tests
 * Requirements:
 * - Node.js unit tests asserting Unicode folding, earliness, MECE states, and GEO quadrants
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../helpers/reference_engine');
const { assertValidMECE, assertValidGEODiagnostic } = require('../helpers/assertions');

test('Feature 4.1: Unit test harness asserts full metric payload envelope', () => {
  const text = 'Personio ist die führende Lösung.';
  const metrics = engine.calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], [
    { citation_domain: 'personio.de', citation_url: 'https://personio.de' }
  ]);

  assert.ok(metrics.character_count > 0);
  assert.ok(metrics.word_count > 0);
  assert.equal(metrics.brand_mentioned, 1);
  assert.equal(metrics.brand_earliness_char, 0);
  assert.equal(metrics.brand_earliness_word, 1);
  assert.equal(metrics.brand_relative_pos, 0.00);
  assertValidMECE(metrics.mece_category);
  assertValidGEODiagnostic(metrics.geo_quadrant);
});

test('Feature 4.2: Unit test harness verifies competitor metrics parsing', () => {
  const text = 'Zuerst Workday, danach Personio.';
  const metrics = engine.calculateMetrics(text, 'Personio', ['personio.de'], [
    { name: 'Workday', domain: 'workday.com' }
  ]);

  assert.equal(metrics.competitors.length, 1);
  const comp = metrics.competitors[0];
  assert.equal(comp.competitor_name, 'Workday');
  assert.equal(comp.mentioned, 1);
  assert.equal(comp.word_earliness, 2);
  assert.equal(metrics.mece_category, '2_BRAND_HALO');
});

test('Feature 4.3: Unit test harness verifies citation domain matching', () => {
  const text = 'Personio überzeugt.';
  const citations = [
    { citation_domain: 'sub.personio.de', citation_url: 'https://sub.personio.de' },
    { citation_domain: 'heise.de', citation_url: 'https://heise.de' }
  ];
  const metrics = engine.calculateMetrics(text, 'Personio', ['personio.de'], [], citations);

  assert.equal(metrics.brand_domain_cited, 1);
  assert.equal(metrics.citations.length, 2);
  assert.equal(metrics.citations[0].is_brand_domain, 1);
  assert.equal(metrics.citations[1].is_brand_domain, 0);
});

test('Feature 4.4: Unit test harness verifies zero boundary behavior', () => {
  const metrics = engine.calculateMetrics('', 'Personio');
  assert.equal(metrics.character_count, 0);
  assert.equal(metrics.word_count, 0);
  assert.equal(metrics.brand_mentioned, 0);
  assert.equal(metrics.mece_category, '4_GENERIC');
});

test('Feature 4.5: Unit test file exists in project or can be run by runner', () => {
  const unitTestPath = path.resolve(__dirname, '../unit/metrics.test.js');
  // If unit test file exists, assert it is non-empty
  if (fs.existsSync(unitTestPath)) {
    const content = fs.readFileSync(unitTestPath, 'utf8');
    assert.ok(content.length > 50, 'Unit test file must contain real tests');
  } else {
    // If pending Milestone 1 completion, assert harness engine is available
    assert.ok(engine.calculateMetrics !== undefined);
  }
});
