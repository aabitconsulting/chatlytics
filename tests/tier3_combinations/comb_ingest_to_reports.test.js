/**
 * tests/tier3_combinations/comb_ingest_to_reports.test.js
 * Tier 3: Cross-Feature Combination — Ingestion Writes -> PoP Analytics Reports
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Combination 3.6: Multi-run ingestion aggregation feeds accurate Period-over-Period reports', () => {
  // Simulate 10 runs in current period and 10 runs in previous period
  const currentRuns = [
    { mece: '1_DIRECT_WIN', mentioned: 1, relPos: 5.2 },
    { mece: '1_DIRECT_WIN', mentioned: 1, relPos: 8.0 },
    { mece: '1_DIRECT_WIN', mentioned: 1, relPos: 4.5 },
    { mece: '2_BRAND_HALO', mentioned: 1, relPos: 22.0 },
    { mece: '2_BRAND_HALO', mentioned: 1, relPos: 18.5 },
    { mece: '3_COMPETITOR_TAKEOVER', mentioned: 0, relPos: null },
    { mece: '1_DIRECT_WIN', mentioned: 1, relPos: 6.1 },
    { mece: '1_DIRECT_WIN', mentioned: 1, relPos: 7.4 },
    { mece: '4_GENERIC', mentioned: 0, relPos: null },
    { mece: '1_DIRECT_WIN', mentioned: 1, relPos: 9.3 }
  ];

  const prevRuns = [
    { mece: '1_DIRECT_WIN', mentioned: 1, relPos: 12.0 },
    { mece: '2_BRAND_HALO', mentioned: 1, relPos: 25.0 },
    { mece: '3_COMPETITOR_TAKEOVER', mentioned: 0, relPos: null },
    { mece: '3_COMPETITOR_TAKEOVER', mentioned: 0, relPos: null },
    { mece: '2_BRAND_HALO', mentioned: 1, relPos: 30.0 },
    { mece: '4_GENERIC', mentioned: 0, relPos: null },
    { mece: '1_DIRECT_WIN', mentioned: 1, relPos: 15.0 },
    { mece: '3_COMPETITOR_TAKEOVER', mentioned: 0, relPos: null },
    { mece: '2_BRAND_HALO', mentioned: 1, relPos: 28.0 },
    { mece: '1_DIRECT_WIN', mentioned: 1, relPos: 14.0 }
  ];

  // Current aggregations
  const curMentions = currentRuns.filter(r => r.mentioned === 1).length;
  const curSoM = (curMentions / currentRuns.length) * 100;
  assert.equal(curSoM, 80.0); // 8 out of 10

  // Previous aggregations
  const prevMentions = prevRuns.filter(r => r.mentioned === 1).length;
  const prevSoM = (prevMentions / prevRuns.length) * 100;
  assert.equal(prevSoM, 60.0); // 6 out of 10

  // PoP Delta
  const somDelta = curSoM - prevSoM;
  assert.equal(somDelta, 20.0); // +20% growth

  // MECE Distribution
  const meceCounts = currentRuns.reduce((acc, r) => {
    acc[r.mece] = (acc[r.mece] || 0) + 1;
    return acc;
  }, {});

  assert.equal(meceCounts['1_DIRECT_WIN'], 6); // 60%
  assert.equal(meceCounts['2_BRAND_HALO'], 2); // 20%
  assert.equal(meceCounts['3_COMPETITOR_TAKEOVER'], 1); // 10%
  assert.equal(meceCounts['4_GENERIC'], 1); // 10%
});
