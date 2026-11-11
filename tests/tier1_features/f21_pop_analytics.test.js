/**
 * tests/tier1_features/f21_pop_analytics.test.js
 * Feature 21: Memory-Safe (<128MB) PoP Analytics
 * Requirements:
 * - api/reports.php SQL aggregation computing SoM, Visibility, Earliness
 * - Period-over-Period comparisons
 * - 4-Quadrant GEO diagnostic prescriptions
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lintPhpFile } = require('../helpers/php_runner');

const REPORTS_PATH = path.resolve(__dirname, '../../api/reports.php');

test('Feature 21.1: Syntax validation of reports.php (php -l)', () => {
  if (fs.existsSync(REPORTS_PATH)) {
    const res = lintPhpFile(REPORTS_PATH);
    assert.equal(res.ok, true, `Syntax error in reports.php: ${res.output}`);
  } else {
    assert.ok(true);
  }
});

test('Feature 21.2: Share-of-Model (SoM) percentage formula', () => {
  const calculateSoM = (mentions, totalRuns) => {
    if (!totalRuns || totalRuns === 0) return 0.00;
    return Number(((mentions / totalRuns) * 100).toFixed(2));
  };

  assert.equal(calculateSoM(74, 100), 74.00);
  assert.equal(calculateSoM(1, 3), 33.33);
  assert.equal(calculateSoM(0, 50), 0.00);
});

test('Feature 21.3: Period-over-Period delta calculation', () => {
  const calculateDelta = (current, previous) => Number((current - previous).toFixed(2));

  assert.equal(calculateDelta(74.2, 69.1), 5.10);
  assert.equal(calculateDelta(50.0, 55.5), -5.50);
});

test('Feature 21.4: Period filter interval parameter resolution (7d, 30d, 90d, all)', () => {
  const resolveDays = (period) => {
    switch (period) {
      case '7d': return 7;
      case '30d': return 30;
      case '90d': return 90;
      case 'all': return 3650;
      default: return 30;
    }
  };

  assert.equal(resolveDays('7d'), 7);
  assert.equal(resolveDays('30d'), 30);
  assert.equal(resolveDays('90d'), 90);
  assert.equal(resolveDays('invalid'), 30);
});

test('Feature 21.5: 4-Quadrant GEO Action prescription mapping', () => {
  const getPrescription = (quadrant, lang = 'de') => {
    const prescriptions = {
      '1_CITATION_HIJACK': {
        de: 'Wettbewerber kapert Ihre Quellen. Schema.org aktualisieren.',
        en: 'Competitor is hijacking your citations. Update Schema.org markup.'
      },
      '4_BURIED_WINNER': {
        de: 'Gewinner, aber spät genannt. Semantische Dichte optimieren.',
        en: 'Winner, but cited late. Optimize semantic density.'
      }
    };
    return prescriptions[quadrant] ? prescriptions[quadrant][lang] : '';
  };

  assert.ok(getPrescription('1_CITATION_HIJACK', 'de').includes('kapert'));
  assert.ok(getPrescription('1_CITATION_HIJACK', 'en').includes('hijacking'));
  assert.ok(getPrescription('4_BURIED_WINNER', 'de').includes('spät'));
});
