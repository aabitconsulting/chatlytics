/**
 * tests/tier1_features/f02_mece_classifier.test.js
 * Feature 2: MECE 4-State Classifier
 * Requirements:
 * - 1_DIRECT_WIN: Brand recommended as preferred/sole lead
 * - 2_BRAND_HALO: Brand mentioned secondarily in list
 * - 3_COMPETITOR_TAKEOVER: Competitor featured, brand omitted
 * - 4_GENERIC: Neither brand nor competitor recommended
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../helpers/reference_engine');
const { assertValidMECE } = require('../helpers/assertions');

test('Feature 2.1: 1_DIRECT_WIN when brand is sole entity mentioned', () => {
  const category = engine.classifyMECE(true, false, 10, null);
  assert.equal(category, '1_DIRECT_WIN');
  assertValidMECE(category);
});

test('Feature 2.2: 1_DIRECT_WIN when brand leads competitors (brand earliness <= comp earliness)', () => {
  const categoryLead = engine.classifyMECE(true, true, 25, 120);
  assert.equal(categoryLead, '1_DIRECT_WIN');

  const categoryTie = engine.classifyMECE(true, true, 50, 50);
  assert.equal(categoryTie, '1_DIRECT_WIN');
});

test('Feature 2.3: 2_BRAND_HALO when brand is mentioned secondarily after leading competitor', () => {
  const category = engine.classifyMECE(true, true, 180, 45);
  assert.equal(category, '2_BRAND_HALO');
  assertValidMECE(category);
});

test('Feature 2.4: 3_COMPETITOR_TAKEOVER when competitor present and brand omitted', () => {
  const category = engine.classifyMECE(false, true, null, 30);
  assert.equal(category, '3_COMPETITOR_TAKEOVER');
  assertValidMECE(category);
});

test('Feature 2.5: 4_GENERIC when neither brand nor competitor is present', () => {
  const category = engine.classifyMECE(false, false, null, null);
  assert.equal(category, '4_GENERIC');
  assertValidMECE(category);
});

test('Feature 2.6: Exhaustive truth table validation guarantees MECE property', () => {
  // Test all permutations of [hasBrand, hasComp]
  const table = [
    { hasBrand: false, hasComp: false, expected: '4_GENERIC' },
    { hasBrand: false, hasComp: true, expected: '3_COMPETITOR_TAKEOVER' },
    { hasBrand: true, hasComp: false, expected: '1_DIRECT_WIN' },
    { hasBrand: true, hasComp: true, bEarl: 10, cEarl: 20, expected: '1_DIRECT_WIN' },
    { hasBrand: true, hasComp: true, bEarl: 30, cEarl: 15, expected: '2_BRAND_HALO' }
  ];

  for (const row of table) {
    const res = engine.classifyMECE(row.hasBrand, row.hasComp, row.bEarl || null, row.cEarl || null);
    assert.equal(res, row.expected, `Failed truth table row: ${JSON.stringify(row)}`);
    assertValidMECE(res);
  }
});
