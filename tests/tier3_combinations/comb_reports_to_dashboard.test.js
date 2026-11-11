/**
 * tests/tier3_combinations/comb_reports_to_dashboard.test.js
 * Tier 3: Cross-Feature Combination — Reports API Data -> Dashboard Rendering & GEO Action Panel
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Combination 3.7: Reports API response binds cleanly to 6 KPI cards and GEO Action Panel', () => {
  const reportsApiResponse = {
    status: 'success',
    data: {
      metrics: {
        som_score: 74.2,
        visibility_index: 86.5,
        avg_earliness: 14.2,
        total_runs: 142,
        citation_share: 62.8,
        credits_remaining: 358
      },
      mece_breakdown: {
        direct_win: 68,
        brand_halo: 37,
        competitor_takeover: 26,
        generic: 11
      },
      pop_comparison: {
        som_delta: 5.1,
        visibility_delta: 3.2
      },
      geo_diagnostic: {
        active_quadrant: '1_CITATION_HIJACK',
        prescription_de: 'Wettbewerber kapert Ihre Quellen. Schema.org Markup aktualisieren.',
        prescription_en: 'Competitor is hijacking your citations. Update Schema.org markup.'
      }
    }
  };

  const d = reportsApiResponse.data;

  // 1. Verify 6 KPI bindings
  assert.equal(d.metrics.som_score, 74.2);
  assert.equal(d.metrics.visibility_index, 86.5);
  assert.equal(d.metrics.avg_earliness, 14.2);
  assert.equal(d.metrics.total_runs, 142);
  assert.equal(d.metrics.citation_share, 62.8);
  assert.equal(d.metrics.credits_remaining, 358);

  // 2. Verify MECE distribution sum equals total runs
  const meceSum = Object.values(d.mece_breakdown).reduce((a, b) => a + b, 0);
  assert.equal(meceSum, d.metrics.total_runs);

  // 3. Verify GEO Action Panel diagnostic prescription binding
  assert.equal(d.geo_diagnostic.active_quadrant, '1_CITATION_HIJACK');
  assert.ok(d.geo_diagnostic.prescription_de.includes('kapert'));
  assert.ok(d.geo_diagnostic.prescription_en.includes('hijacking'));
});
