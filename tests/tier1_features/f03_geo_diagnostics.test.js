/**
 * tests/tier1_features/f03_geo_diagnostics.test.js
 * Feature 3: 4-Quadrant GEO Diagnostics
 * Requirements:
 * - 1_CITATION_HIJACK: Brand in text, not cited in grounding
 * - 2_PARAMETRIC_BLINDSPOT: Brand cited in grounding, omitted from synthesis
 * - 3_BRAND_HALO_TRAP: Brand co-mentioned, secondary to competitor
 * - 4_BURIED_WINNER: Brand recommended but appears late (>50%)
 * - NONE: Clean visibility or generic
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../helpers/reference_engine');
const { assertValidGEODiagnostic } = require('../helpers/assertions');

test('Feature 3.1: 1_CITATION_HIJACK diagnostic trigger condition', () => {
  const diag = engine.evaluateGEODiagnostic({
    brandInText: true,
    brandDomainCited: false,
    competitorInText: true,
    competitorDomainCited: true,
    meceCategory: '1_DIRECT_WIN',
    citationsCount: 2
  });
  assert.equal(diag, '1_CITATION_HIJACK');
  assertValidGEODiagnostic(diag);
});

test('Feature 3.2: 2_PARAMETRIC_BLINDSPOT diagnostic trigger condition', () => {
  const diag = engine.evaluateGEODiagnostic({
    brandInText: false,
    brandDomainCited: true,
    competitorInText: true,
    citationsCount: 1
  });
  assert.equal(diag, '2_PARAMETRIC_BLINDSPOT');
  assertValidGEODiagnostic(diag);
});

test('Feature 3.3: 3_BRAND_HALO_TRAP diagnostic trigger condition', () => {
  const diag = engine.evaluateGEODiagnostic({
    brandInText: true,
    brandDomainCited: false,
    competitorInText: true,
    meceCategory: '2_BRAND_HALO',
    brandRelativePos: 35.0,
    minCompetitorPos: 12.0,
    citationsCount: 0
  });
  assert.equal(diag, '3_BRAND_HALO_TRAP');
  assertValidGEODiagnostic(diag);
});

test('Feature 3.4: 4_BURIED_WINNER diagnostic trigger condition', () => {
  const diag = engine.evaluateGEODiagnostic({
    brandInText: true,
    brandDomainCited: true,
    competitorInText: false,
    meceCategory: '1_DIRECT_WIN',
    brandRelativePos: 72.5,
    citationsCount: 3
  });
  assert.equal(diag, '4_BURIED_WINNER');
  assertValidGEODiagnostic(diag);
});

test('Feature 3.5: NONE diagnostic for clean, authoritative early win', () => {
  const diag = engine.evaluateGEODiagnostic({
    brandInText: true,
    brandDomainCited: true,
    competitorInText: false,
    meceCategory: '1_DIRECT_WIN',
    brandRelativePos: 8.5,
    citationsCount: 2
  });
  assert.equal(diag, 'NONE');
  assertValidGEODiagnostic(diag);
});

test('Feature 3.6: Exhaustive quadrant validation across all branches', () => {
  const allQuadrants = ['1_CITATION_HIJACK', '2_PARAMETRIC_BLINDSPOT', '3_BRAND_HALO_TRAP', '4_BURIED_WINNER', 'NONE'];
  for (const q of allQuadrants) {
    assertValidGEODiagnostic(q);
  }
});
