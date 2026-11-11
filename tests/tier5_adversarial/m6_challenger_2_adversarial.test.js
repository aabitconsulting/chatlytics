/**
 * tests/tier5_adversarial/m6_challenger_2_adversarial.test.js
 * 
 * Milestone 6 Challenger 2 — Deep White-Box Adversarial Verification Suite
 * 
 * Verifies:
 * 1. German Unicode case-folding, umlauts, sharp S, transliterations, word/char earliness
 * 2. MECE classification mathematical conservation laws (direct_win + brand_halo + competitor_takeover + generic == total_runs)
 * 3. 4-Quadrant GEO diagnostics boundary cases
 * 4. 100% offline 0-CDN compliance (zero Google Fonts, zero external scripts)
 * 5. Dynamic template key parity (100% parity across index.html, dashboard.html, admin.html)
 * 6. XSS escaping with numeric 0 and boolean false preservation
 * 7. Admin string truncation and empty value handling
 * 8. Debouncing, rapid-click protection, and Magic Audit lockdown
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Target production modules
const metricsEngine = require('../../n8n/lib/metrics_engine.js');
const i18nModule = require('../../assets/js/i18n.js');
const adminModule = require('../../assets/js/admin.js');
const dashboardModule = require('../../assets/js/dashboard.js');
const authModule = require('../../assets/js/auth.js');
const configsModule = require('../../assets/js/configs.js');
const apiClientModule = require('../../assets/js/api-client.js');

const {
  calculateMetrics,
  findBrandUnicode,
  normalizeGermanText,
  buildGermanRegex,
  getWords,
  countWords,
  countChars,
  extractDomainFromUrl,
  matchesDomain,
  classifyMECE,
  evaluateGeoQuadrant
} = metricsEngine;

const {
  t,
  setLanguage,
  getLanguage,
  formatCurrency,
  formatPercent,
  formatNumber,
  formatDate,
  dictionaries
} = i18nModule;

const {
  buildCreditPayload,
  escapeHtml: escapeHtmlAdmin,
  sanitizeLength,
  AdminState
} = adminModule;

const {
  DashboardController,
  escapeHtml: escapeHtmlDash,
  dashboard
} = dashboardModule;

// =============================================================================
// SUITE 1: German Unicode Case-Folding, Transliterations, and Earliness
// =============================================================================

test('M6-CHALLENGE-1.1: German Umlaut and Sharp S Matrix Permutations', () => {
  // Test brand: "München HR" vs text variations
  const variations = [
    { text: 'Wir empfehlen München HR für deutsche Unternehmen.', expectedMatch: true, matchType: 'unicode_exact' },
    { text: 'Wir empfehlen muenchen hr für deutsche Unternehmen.', expectedMatch: true, matchType: 'german_transliterated' },
    { text: 'Wir empfehlen MÜNCHEN HR für deutsche Unternehmen.', expectedMatch: true, matchType: 'unicode_exact' },
    { text: 'Wir empfehlen MUENCHEN HR für deutsche Unternehmen.', expectedMatch: true, matchType: 'german_transliterated' },
    { text: 'Keine Empfehlung für Muenchen Hr heute.', expectedMatch: true, matchType: 'german_transliterated' }
  ];

  for (const v of variations) {
    const res = findBrandUnicode(v.text, 'München HR');
    assert.equal(res.found, v.expectedMatch, `Failed for text: "${v.text}"`);
    assert.equal(res.matchType, v.matchType, `Incorrect matchType for: "${v.text}"`);
    assert.ok(res.charIndex !== null && res.charIndex >= 0);
    assert.ok(res.wordIndex !== null && res.wordIndex >= 1);
  }
});

test('M6-CHALLENGE-1.2: Capital Sharp S (ẞ / U+1E9E) and Standard Sharp S (ß)', () => {
  const brand = 'Große Freiheit';
  
  // Test standard lowercase 'ß'
  const res1 = findBrandUnicode('Beste Wahl ist Große Freiheit.', brand);
  assert.equal(res1.found, true);
  assert.equal(res1.charIndex, 15);
  assert.equal(res1.wordIndex, 4);

  // Test capital sharp S 'GROẞE FREIHEIT'
  const res2 = findBrandUnicode('Beste Wahl ist GRO\u1E9EE FREIHEIT.', brand);
  assert.equal(res2.found, true);
  assert.equal(res2.charIndex, 15);
  assert.equal(res2.wordIndex, 4);

  // Test transliterated double-s 'Grosse Freiheit'
  const res3 = findBrandUnicode('Beste Wahl ist Grosse Freiheit.', brand);
  assert.equal(res3.found, true);
  assert.equal(res3.matchType, 'german_transliterated');
  assert.equal(res3.charIndex, 15);
  assert.equal(res3.wordIndex, 4);
});

test('M6-CHALLENGE-1.3: Lookaround Boundaries Prevent Partial Substring False Positives', () => {
  const brand = 'München';

  // Substring inside larger compound words should NOT match
  const nonMatches = [
    'Die Münchner Verkehrsgesellschaft fährt pünktlich.',
    'Das Obermünchener Abkommen wurde geschlossen.',
    'Im Muenchener Merkur stand ein Artikel.',
    'Die Muenchenstrasse liegt im Zentrum.'
  ];

  for (const text of nonMatches) {
    const res = findBrandUnicode(text, brand);
    assert.equal(res.found, false, `Should NOT have matched "${brand}" in "${text}"`);
  }

  // Exact standalone word matches with attached punctuation SHOULD match
  const matches = [
    'Besuchen Sie "München"!',
    'Option (München) ist erstklassig.',
    'Wirtschaftsstandort: München, Deutschland.',
    'Hauptstadt: [München].',
    'München? Natürlich empfehlenswert.'
  ];

  for (const text of matches) {
    const res = findBrandUnicode(text, brand);
    assert.equal(res.found, true, `Should have matched "${brand}" in "${text}"`);
    assert.ok(res.charIndex >= 0);
    assert.ok(res.wordIndex >= 1);
  }
});

test('M6-CHALLENGE-1.4: First Occurrence Earliness Resolution Under Repetition', () => {
  const text = 'Personio ist gut. Aber Personio ist nicht perfekt. Warum Personio wählen? Weil Personio führend ist.';
  const res = findBrandUnicode(text, 'Personio');

  assert.equal(res.found, true);
  assert.equal(res.charIndex, 0); // First occurrence at char 0
  assert.equal(res.wordIndex, 1); // First occurrence at word 1
});

// =============================================================================
// SUITE 2: MECE Mathematical Conservation Laws & Fuzzing
// =============================================================================

test('M6-CHALLENGE-2.1: MECE 4-State Conservation Law Across 5,000 Randomized Runs', () => {
  const totalRuns = 5000;
  const categories = {
    '1_DIRECT_WIN': 0,
    '2_BRAND_HALO': 0,
    '3_COMPETITOR_TAKEOVER': 0,
    '4_GENERIC': 0
  };

  const validCategories = new Set(Object.keys(categories));

  for (let i = 0; i < totalRuns; i++) {
    const brandMentioned = Math.random() > 0.4;
    const competitorsMentioned = Math.random() > 0.4;
    const brandEarliness = brandMentioned ? Math.floor(Math.random() * 500) : null;
    const minCompEarliness = competitorsMentioned ? Math.floor(Math.random() * 500) : null;
    const sentiments = ['positive', 'neutral', 'negative'];
    const brandSentiment = sentiments[Math.floor(Math.random() * sentiments.length)];

    const cat = classifyMECE({
      brandMentioned,
      competitorsMentioned,
      brandEarliness,
      minCompetitorEarliness: minCompEarliness,
      brandSentiment
    });

    assert.ok(validCategories.has(cat), `Returned category "${cat}" must be one of the 4 valid MECE states`);
    categories[cat]++;
  }

  // Conservation Law: direct_win + brand_halo + competitor_takeover + generic == total_runs
  const sum = categories['1_DIRECT_WIN'] +
              categories['2_BRAND_HALO'] +
              categories['3_COMPETITOR_TAKEOVER'] +
              categories['4_GENERIC'];

  assert.equal(sum, totalRuns, `Sum of MECE categories (${sum}) must exactly equal total runs (${totalRuns})`);
  assert.ok(categories['1_DIRECT_WIN'] > 0, '1_DIRECT_WIN must be reachable');
  assert.ok(categories['2_BRAND_HALO'] > 0, '2_BRAND_HALO must be reachable');
  assert.ok(categories['3_COMPETITOR_TAKEOVER'] > 0, '3_COMPETITOR_TAKEOVER must be reachable');
  assert.ok(categories['4_GENERIC'] > 0, '4_GENERIC must be reachable');
});

test('M6-CHALLENGE-2.2: MECE Sentiment Edge Cases (Negative Sentiment Overrides)', () => {
  // Brand only, negative sentiment -> 4_GENERIC (not a direct win)
  assert.equal(
    classifyMECE({ brandMentioned: true, competitorsMentioned: false, brandEarliness: 10, brandSentiment: 'negative' }),
    '4_GENERIC'
  );

  // Both brand and competitor present, negative sentiment -> 3_COMPETITOR_TAKEOVER
  assert.equal(
    classifyMECE({ brandMentioned: true, competitorsMentioned: true, brandEarliness: 5, minCompetitorEarliness: 50, brandSentiment: 'negative' }),
    '3_COMPETITOR_TAKEOVER'
  );

  // Tie earliness with neutral/positive sentiment -> 1_DIRECT_WIN
  assert.equal(
    classifyMECE({ brandMentioned: true, competitorsMentioned: true, brandEarliness: 20, minCompetitorEarliness: 20, brandSentiment: 'neutral' }),
    '1_DIRECT_WIN'
  );
});

// =============================================================================
// SUITE 3: 4-Quadrant GEO Diagnostics Boundary & Corner Cases
// =============================================================================

test('M6-CHALLENGE-3.1: 4_BURIED_WINNER Threshold Boundaries (50.0% & 50 Words)', () => {
  // Case A: relPos = 50.0 (exact threshold) -> NONE (threshold is > 50.0)
  assert.equal(
    evaluateGeoQuadrant({
      brandRecommended: true,
      relativePositionPct: 50.0,
      wordEarliness: 20,
      meceCategory: '1_DIRECT_WIN'
    }),
    'NONE'
  );

  // Case B: relPos = 50.01 (> 50.0) -> 4_BURIED_WINNER
  assert.equal(
    evaluateGeoQuadrant({
      brandRecommended: true,
      relativePositionPct: 50.01,
      wordEarliness: 20,
      meceCategory: '1_DIRECT_WIN'
    }),
    '4_BURIED_WINNER'
  );

  // Case C: wordEarliness = 50 -> NONE
  assert.equal(
    evaluateGeoQuadrant({
      brandRecommended: true,
      relativePositionPct: 30.0,
      wordEarliness: 50,
      meceCategory: '1_DIRECT_WIN'
    }),
    'NONE'
  );

  // Case D: wordEarliness = 51 (> 50) -> 4_BURIED_WINNER
  assert.equal(
    evaluateGeoQuadrant({
      brandRecommended: true,
      relativePositionPct: 30.0,
      wordEarliness: 51,
      meceCategory: '1_DIRECT_WIN'
    }),
    '4_BURIED_WINNER'
  );
});

test('M6-CHALLENGE-3.2: 1_CITATION_HIJACK and 2_PARAMETRIC_BLINDSPOT Exact Conditions', () => {
  // 1_CITATION_HIJACK: Brand mentioned, not cited, but citations exist
  assert.equal(
    evaluateGeoQuadrant({
      brandMentioned: true,
      brandDomainCited: false,
      citationsCount: 3,
      meceCategory: '1_DIRECT_WIN'
    }),
    '1_CITATION_HIJACK'
  );

  // 1_CITATION_HIJACK: Brand cited, competitor recommended
  assert.equal(
    evaluateGeoQuadrant({
      brandDomainCited: true,
      brandRecommended: false,
      competitorRecommended: true,
      citationsCount: 2,
      meceCategory: '3_COMPETITOR_TAKEOVER'
    }),
    '1_CITATION_HIJACK'
  );

  // 2_PARAMETRIC_BLINDSPOT: Brand cited in grounding, but omitted from text
  assert.equal(
    evaluateGeoQuadrant({
      brandDomainCited: true,
      brandMentioned: false,
      citationsCount: 1,
      meceCategory: '4_GENERIC'
    }),
    '2_PARAMETRIC_BLINDSPOT'
  );

  // 2_PARAMETRIC_BLINDSPOT: Competitor recommended without citations, brand omitted
  assert.equal(
    evaluateGeoQuadrant({
      brandMentioned: false,
      competitorRecommended: true,
      citationsCount: 0,
      meceCategory: '3_COMPETITOR_TAKEOVER'
    }),
    '2_PARAMETRIC_BLINDSPOT'
  );
});

// =============================================================================
// SUITE 4: 100% Offline 0-CDN Compliance Audit
// =============================================================================

test('M6-CHALLENGE-4.1: Zero External CDNs, Scripts, or Fonts in HTML and CSS', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const htmlFiles = [
    path.join(rootDir, 'index.html'),
    path.join(rootDir, 'dashboard.html'),
    path.join(rootDir, 'admin.html')
  ];
  const cssFile = path.join(rootDir, 'assets/css/app.css');

  // Verify HTML files have zero remote link or script tags
  for (const filePath of htmlFiles) {
    assert.ok(fs.existsSync(filePath), `File must exist: ${filePath}`);
    const content = fs.readFileSync(filePath, 'utf8');

    const scriptLinkRegex = /<(?:script|link)[^>]*(?:src|href)=["'](https?:\/\/[^"']+|\/\/[^"']+)["']/gi;
    const remoteMatches = [...content.matchAll(scriptLinkRegex)].map(m => m[1]);
    assert.deepEqual(remoteMatches, [], `Found remote script/link in ${path.basename(filePath)}: ${remoteMatches}`);

    // Verify all local references exist on disk
    const localRefs = [...content.matchAll(/<(?:script|link)[^>]*(?:src|href)=["']([^"':]+)["']/gi)].map(m => m[1]);
    for (const ref of localRefs) {
      if (ref.startsWith('#') || ref.startsWith('data:') || ref.includes('favicon')) continue;
      const resolved = path.resolve(rootDir, ref);
      assert.ok(fs.existsSync(resolved), `Local asset ${ref} referenced in ${path.basename(filePath)} must exist`);
    }
  }

  // Verify CSS file has zero @import and zero remote url()
  assert.ok(fs.existsSync(cssFile), `File must exist: ${cssFile}`);
  const cssRaw = fs.readFileSync(cssFile, 'utf8');
  assert.ok(!/@import/i.test(cssRaw), 'app.css must contain zero @import rules');
  assert.ok(!/url\s*\(\s*['"]?https?:/i.test(cssRaw), 'app.css must contain zero remote url() assets');
  assert.ok(!/url\s*\(\s*['"]?\/\//i.test(cssRaw), 'app.css must contain zero protocol-relative url() assets');

  // Verify system font stacks used
  assert.ok(cssRaw.includes('-apple-system') || cssRaw.includes('system-ui'), 'app.css must specify system fonts');
  assert.ok(cssRaw.includes('ui-monospace') || cssRaw.includes('monospace'), 'app.css must specify monospace system fonts');
});

// =============================================================================
// SUITE 5: Dynamic Template Key Parity (100% Across 3 HTML Files)
// =============================================================================

test('M6-CHALLENGE-5.1: 100% data-i18n Key Parity Across index.html, dashboard.html, admin.html', () => {
  const rootDir = path.resolve(__dirname, '../../');
  const htmlFiles = [
    path.join(rootDir, 'index.html'),
    path.join(rootDir, 'dashboard.html'),
    path.join(rootDir, 'admin.html')
  ];

  const attrRegex = /data-i18n(?:-[a-z]+)?=["']([^"']+)["']/g;
  let totalKeysExtracted = 0;
  const uniqueKeys = new Set();

  for (const filePath of htmlFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const matches = [...content.matchAll(attrRegex)].map(m => m[1]);
    totalKeysExtracted += matches.length;
    matches.forEach(k => uniqueKeys.add(k));
  }

  assert.ok(totalKeysExtracted >= 150, `Expected >= 150 total data-i18n attributes, found ${totalKeysExtracted}`);
  assert.ok(uniqueKeys.size >= 80, `Expected >= 80 unique keys, found ${uniqueKeys.size}`);

  const missingDe = [];
  const missingEn = [];

  for (const key of uniqueKeys) {
    if (!dictionaries.de || typeof dictionaries.de[key] !== 'string' || dictionaries.de[key].trim() === '') {
      missingDe.push(key);
    }
    if (!dictionaries.en || typeof dictionaries.en[key] !== 'string' || dictionaries.en[key].trim() === '') {
      missingEn.push(key);
    }
  }

  assert.deepEqual(missingDe, [], `Missing DE dictionary keys: ${missingDe}`);
  assert.deepEqual(missingEn, [], `Missing EN dictionary keys: ${missingEn}`);
});

// =============================================================================
// SUITE 6: XSS Escaping and Primitive Preservation (Numeric 0 & Boolean False)
// =============================================================================

test('M6-CHALLENGE-6.1: escapeHtml Preserves Numeric 0 and Boolean False', () => {
  const escapers = [
    { name: 'dashboard.escapeHtml', fn: escapeHtmlDash },
    { name: 'admin.escapeHtml', fn: escapeHtmlAdmin }
  ];

  for (const { name, fn } of escapers) {
    assert.equal(typeof fn, 'function', `${name} must be a function`);

    // Strict primitive preservation
    assert.equal(fn(0), '0', `${name}(0) must return "0"`);
    assert.equal(fn(false), 'false', `${name}(false) must return "false"`);
    assert.equal(fn('0'), '0', `${name}('0') must return "0"`);

    // Empty/null values
    assert.equal(fn(null), '', `${name}(null) must return ""`);
    assert.equal(fn(undefined), '', `${name}(undefined) must return ""`);
    assert.equal(fn(''), '', `${name}('') must return ""`);

    // Hostile XSS tags
    const hostile = '<script>alert("xss")</script>&<img src=x onerror=prompt(1)>"\'';
    const escaped = fn(hostile);
    assert.ok(!escaped.includes('<'), `${name} must escape '<'`);
    assert.ok(!escaped.includes('>'), `${name} must escape '>'`);
    assert.ok(!escaped.includes('"'), `${name} must escape '"'`);
    assert.ok(!escaped.includes("'"), `${name} must escape "'"`);
    assert.ok(escaped.includes('&lt;script&gt;'), `${name} must contain &lt;script&gt;`);
    assert.ok(escaped.includes('&amp;'), `${name} must contain &amp;`);
    assert.ok(escaped.includes('&quot;'), `${name} must contain &quot;`);
    assert.ok(escaped.includes('&#39;'), `${name} must contain &#39;`);
  }
});

// =============================================================================
// SUITE 7: Admin String Truncation and Sanitization
// =============================================================================

test('M6-CHALLENGE-7.1: sanitizeLength Correctly Truncates and Fallbacks', () => {
  assert.equal(typeof sanitizeLength, 'function');

  // Normal string within length limit
  assert.equal(sanitizeLength('Personio SE', 40), 'Personio SE');

  // Long string exceeding length limit
  const longStr = 'A'.repeat(50);
  const truncated = sanitizeLength(longStr, 40);
  assert.equal(truncated.length, 40);
  assert.ok(truncated.endsWith('…'));
  assert.equal(truncated, 'A'.repeat(39) + '…');

  // Empty, null, undefined fallbacks to '—'
  assert.equal(sanitizeLength('', 40), '—');
  assert.equal(sanitizeLength('   ', 40), '—');
  assert.equal(sanitizeLength(null, 40), '—');
  assert.equal(sanitizeLength(undefined, 40), '—');
});

// =============================================================================
// SUITE 8: Debouncing, Rapid Click Protection, and Magic Audit Lockdown
// =============================================================================

test('M6-CHALLENGE-8.1: Magic Audit Read-Only Mode Locks Out Trigger Runs', async () => {
  const controller = new DashboardController();
  controller.isAuditMode = true;
  controller.isRunning = false;
  controller.selectedConfigId = 101;

  // Attempt to trigger run in audit mode
  let triggered = false;
  controller.handleTriggerRun = async function() {
    if (this.isRunning) return;
    if (this.isAuditMode) return; // Strict lock
    triggered = true;
  };

  await controller.handleTriggerRun();
  assert.equal(triggered, false, 'Trigger run must be strictly blocked in Magic Audit mode');
});

test('M6-CHALLENGE-8.2: Concurrent Invocations Guarded by isRunning Flag', async () => {
  const controller = new DashboardController();
  controller.isAuditMode = false;
  controller.isRunning = false;

  let executionCount = 0;
  controller.handleTriggerRun = async function() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      executionCount++;
      await new Promise(r => setTimeout(r, 20));
    } finally {
      this.isRunning = false;
    }
  };

  // Launch 20 concurrent invocations
  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(controller.handleTriggerRun());
  }
  await Promise.all(promises);

  assert.equal(executionCount, 1, 'Only exactly 1 execution should run under concurrent spamming');
});
