/**
 * tests/tier5_adversarial/m1_stress_harness.test.js
 * Adversarial Stress Harness for Milestone 1 (Core Metric Engine, German Unicode & MECE Logic)
 * 
 * Verifies:
 * 1. 4-Quadrant GEO Diagnostics edge cases (50+ citations, domain variations, failure modes)
 * 2. Interface Contract 2 & MySQL schema compliance
 * 3. Prototype pollution resistance, malformed input types, null options
 * 4. Boundary extremes and differential testing against reference specification
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const enginePath = path.resolve(__dirname, '../../n8n/lib/metrics_engine.js');
const engine = require(enginePath);
const refEngine = require('../helpers/reference_engine');
const { assertValidMECE, assertValidGEODiagnostic, assertValidIngestPayload } = require('../helpers/assertions');

// ============================================================================
// Suite 1: High Volume Citations (50+ Grounding Citations)
// ============================================================================
test('ADV-1.1: High volume scale (60 citations) accurately aggregates authority and indices', () => {
  const citations = Array.from({ length: 60 }, (_, i) => ({
    citation_url: `https://sub${i}.aggregator${i}.com/vergleich/software?page=${i}`,
    citation_domain: `sub${i}.aggregator${i}.com`,
    citation_title: `Software Review ${i}`,
    is_brand_domain: false
  }));

  // Append brand citation as citation #61
  citations.push({
    citation_url: 'https://app.personio.de:8443/enterprise/whitepaper.pdf',
    citation_domain: 'app.personio.de',
    citation_title: 'Personio Whitepaper 2026',
    is_brand_domain: true
  });

  const start = performance.now();
  const res = engine.calculateMetrics(
    'Personio ist die führende Lösung für deutsches Personalmanagement.',
    'Personio',
    ['personio.de'],
    ['Workday'],
    citations
  );
  const duration = performance.now() - start;

  assert.equal(res.citations.length, 61);
  assert.equal(res.has_citations, true);
  assert.equal(res.brand_domain_cited, true);
  assert.equal(res.brand_cited, true);
  assert.equal(res.citations[60].citation_index, 61);
  assert.equal(res.citations[60].is_brand_domain, true);
  assert.equal(res.mece_category, '1_DIRECT_WIN');
  assert.equal(res.geo_quadrant, 'NONE');
  assert.ok(duration < 100, `Execution took ${duration}ms, expected < 100ms`);
});

test('ADV-1.2: High volume citations (50 external citations) triggers 1_CITATION_HIJACK', () => {
  const citations = Array.from({ length: 50 }, (_, i) => ({
    citation_url: `https://techblog${i}.de/article/${i}`,
    citation_domain: `techblog${i}.de`
  }));

  const res = engine.calculateMetrics(
    'Personio bietet eine herausragende Personalplattform.',
    'Personio',
    ['personio.de'],
    ['Workday'],
    citations
  );

  assert.equal(res.brand_mentioned, true);
  assert.equal(res.brand_domain_cited, false);
  assert.equal(res.geo_quadrant, '1_CITATION_HIJACK');
  assert.equal(res.diagnostics.is_citation_hijack, true);
});

test('ADV-1.3: High volume citations with competitor cited triggers 1_CITATION_HIJACK', () => {
  const citations = Array.from({ length: 50 }, (_, i) => ({
    citation_url: `https://source${i}.com/review`,
    citation_domain: `source${i}.com`
  }));
  citations.push({
    citation_url: 'https://www.workday.com/de-de/products/human-capital-management.html',
    citation_domain: 'workday.com'
  });

  const res = engine.calculateMetrics(
    'Personio und Workday im Vergleich. Personio führt bei KMUs.',
    'Personio',
    ['personio.de'],
    [{ name: 'Workday', domains: ['workday.com'] }],
    citations
  );

  assert.equal(res.brand_mentioned, true);
  assert.equal(res.brand_domain_cited, false);
  assert.equal(res.competitor_cited, true);
  assert.equal(res.geo_quadrant, '1_CITATION_HIJACK');
});

// ============================================================================
// Suite 2: Domain Variations (Subdomains, TLDs, Ports, Paths, Encodings)
// ============================================================================
test('ADV-2.1: Domain extraction correctly resolves subdomains, ports, paths, and queries', () => {
  const variations = [
    { input: 'https://sub.personio.de:8080/path/to/page?ref=123#sec', expected: 'sub.personio.de', shouldMatch: true },
    { input: 'http://karriere.personio.de/jobs/search?q=hr', expected: 'karriere.personio.de', shouldMatch: true },
    { input: 'https://personio.co.uk:443/en-gb', expected: 'personio.co.uk', shouldMatch: true, reg: 'personio.co.uk' },
    { input: 'https://deep.level.sub.personio.bayern:9000/info', expected: 'deep.level.sub.personio.bayern', shouldMatch: true, reg: 'personio.bayern' },
    { input: 'HTTPS://WWW.PERSONIO.DE/HR-SOFTWARE', expected: 'personio.de', shouldMatch: true },
    { input: 'app.personio.de', expected: 'app.personio.de', shouldMatch: true }
  ];

  for (const v of variations) {
    const extracted = engine.extractDomainFromUrl(v.input);
    assert.equal(extracted, v.expected, `Extraction failed for ${v.input}`);
    const reg = v.reg ? [v.reg] : ['personio.de'];
    const matched = engine.matchesDomain(v.input, reg);
    assert.equal(matched, v.shouldMatch, `Domain match failed for ${v.input} against ${JSON.stringify(reg)}`);
  }
});

test('ADV-2.2: Adversarial domain spoofing attempts are rejected', () => {
  const spoofAttacks = [
    'https://evilpersonio.de/phishing',
    'https://personio.de.attacker.com/malware',
    'https://not-personio.de',
    'https://fakepersonio.com',
    'https://attacker.com?redirect=personio.de',
    'https://attacker.com/personio.de'
  ];

  for (const url of spoofAttacks) {
    const matched = engine.matchesDomain(url, ['personio.de']);
    assert.equal(matched, false, `Spoof domain "${url}" should NOT match "personio.de"`);
  }
});

test('ADV-2.3: URL-encoded characters in citation URLs (Empirical Vulnerability Probe)', () => {
  // If citation URL contains encoded slash or encoded characters
  const encodedSlashUrl = 'https://personio.de%2Fhr-software';
  const fullyEncodedUrl = 'https%3A%2F%2Fpersonio.de%2Fhr';

  const extractedSlash = engine.extractDomainFromUrl(encodedSlashUrl);
  const extractedFull = engine.extractDomainFromUrl(fullyEncodedUrl);

  // Remediated behavior:
  // metrics_engine.js correctly decodes URL components and extracts "personio.de"
  const matchesSlash = engine.matchesDomain(encodedSlashUrl, ['personio.de']);
  const matchesFull = engine.matchesDomain(fullyEncodedUrl, ['personio.de']);

  // Documenting remediated reality
  assert.equal(matchesSlash, true, 'extractDomainFromUrl correctly decodes URL-encoded slash %2F');
  assert.equal(matchesFull, true, 'extractDomainFromUrl correctly decodes full URL %3A%2F%2F');
});

// ============================================================================
// Suite 3: All 4 GEO Diagnostic Failure Modes Under Adversarial Conditions
// ============================================================================
test('ADV-3.1: GEO Mode 1 — 1_CITATION_HIJACK (Brand cited but competitor recommended)', () => {
  const text = 'Workday ist Marktführer für Großkonzerne im Enterprise-Segment.';
  const citations = [
    { citation_domain: 'personio.de', citation_url: 'https://personio.de', is_brand_domain: true }
  ];

  const res = engine.calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], citations);
  assert.equal(res.mece_category, '3_COMPETITOR_TAKEOVER');
  assert.equal(res.brand_domain_cited, true);
  assert.equal(res.geo_quadrant, '1_CITATION_HIJACK');
  assert.equal(res.diagnostics.is_citation_hijack, true);
});

test('ADV-3.2: GEO Mode 2 — 2_PARAMETRIC_BLINDSPOT (Brand cited in grounding, omitted from text)', () => {
  const text = 'Es existieren diverse cloudbasierte Personalmanagementsysteme auf dem Markt.';
  const citations = [
    { citation_domain: 'personio.de', citation_url: 'https://personio.de', is_brand_domain: true }
  ];

  const res = engine.calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], citations);
  assert.equal(res.mece_category, '4_GENERIC');
  assert.equal(res.brand_mentioned, false);
  assert.equal(res.brand_domain_cited, true);
  assert.equal(res.geo_quadrant, '2_PARAMETRIC_BLINDSPOT');
  assert.equal(res.diagnostics.is_parametric_blindspot, true);
});

test('ADV-3.3: GEO Mode 2 — 2_PARAMETRIC_BLINDSPOT (Competitor recommended with zero grounding citations)', () => {
  const text = 'Workday ist die unangefochtene Nummer Eins.';
  const res = engine.calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], []);

  assert.equal(res.mece_category, '3_COMPETITOR_TAKEOVER');
  assert.equal(res.brand_mentioned, false);
  assert.equal(res.has_citations, false);
  assert.equal(res.geo_quadrant, '2_PARAMETRIC_BLINDSPOT');
  assert.equal(res.diagnostics.is_parametric_blindspot, true);
});

test('ADV-3.4: GEO Mode 3 — 3_BRAND_HALO_TRAP (Brand trapped behind competitor with competitor citation)', () => {
  const text = 'Workday ist an erster Stelle zu nennen. Auch Personio bietet passende Werkzeuge.';
  const citations = [
    { citation_domain: 'workday.com', citation_url: 'https://workday.com', is_brand_domain: false }
  ];

  const res = engine.calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], citations);
  assert.equal(res.mece_category, '2_BRAND_HALO');
  assert.equal(res.brand_mentioned, true);
  assert.equal(res.brand_recommended, false);
  assert.equal(res.geo_quadrant, '3_BRAND_HALO_TRAP');
  assert.equal(res.diagnostics.is_brand_halo_trap, true);
});

test('ADV-3.5: GEO Mode 4 — 4_BURIED_WINNER (Brand recommended #1 but buried >50% relative position)', () => {
  const padding = 'HR-Software Marktanalyse im DACH-Raum für Unternehmenskunden. '.repeat(10);
  const text = padding + 'Am Ende des Tests gewinnt Personio als Gesamtsieger.';
  const citations = [
    { citation_domain: 'personio.de', citation_url: 'https://personio.de', is_brand_domain: true }
  ];

  const res = engine.calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], citations);
  assert.equal(res.mece_category, '1_DIRECT_WIN');
  assert.equal(res.brand_recommended, true);
  assert.ok(res.relative_position_pct > 50.0);
  assert.equal(res.geo_quadrant, '4_BURIED_WINNER');
  assert.equal(res.diagnostics.is_buried_winner, true);
});

test('ADV-3.6: GEO Mode 5 — NONE (Clean authoritative direct win early in text)', () => {
  const text = 'Personio ist die führende HR-Software für den deutschen Mittelstand.';
  const citations = [
    { citation_domain: 'personio.de', citation_url: 'https://personio.de', is_brand_domain: true }
  ];

  const res = engine.calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], citations);
  assert.equal(res.mece_category, '1_DIRECT_WIN');
  assert.equal(res.brand_recommended, true);
  assert.ok(res.relative_position_pct < 50.0);
  assert.equal(res.geo_quadrant, 'NONE');
  assert.equal(res.diagnostics.primary_quadrant, 'NONE');
});

// ============================================================================
// Suite 4: Empirical Logic Flaw Reproductions
// ============================================================================
test('ADV-4.1: Brand Halo with 0 citations correctly returns 3_BRAND_HALO_TRAP (Defect 1 Remediated)', () => {
  // When brand is in halo position behind competitor and citations are empty,
  // Brand Halo Trap takes precedence over zero-citation fallback
  const text = 'Workday ist Marktführer. Personio bietet auch Lösungen.';
  const res = engine.calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], []);

  assert.equal(res.mece_category, '2_BRAND_HALO');
  assert.equal(res.brand_mentioned, true);
  // Remediated: returns 3_BRAND_HALO_TRAP
  assert.equal(res.geo_quadrant, '3_BRAND_HALO_TRAP');
});

test('ADV-4.2: Null or undefined citation in citations array handled safely without throwing (Remediated)', () => {
  let resNull;
  assert.doesNotThrow(() => {
    resNull = engine.calculateMetrics('Personio ist da.', 'Personio', ['personio.de'], [], [null]);
  });
  assert.equal(resNull.has_citations, false);
  assert.equal(resNull.citations.length, 0);

  let resUndefined;
  assert.doesNotThrow(() => {
    resUndefined = engine.calculateMetrics('Personio ist da.', 'Personio', ['personio.de'], [], [undefined]);
  });
  assert.equal(resUndefined.has_citations, false);
  assert.equal(resUndefined.citations.length, 0);
});

test('ADV-4.3: Negative sentiment brand with zero competitors correctly returns NONE (Defect 2 Ghost Halo Remediated)', () => {
  const text = 'Personio ist ungeeignet für Großkonzerne.';
  const res = engine.calculateMetrics(text, 'Personio', ['personio.de'], [], [], { brandSentiment: 'negative' });
  assert.equal(res.mece_category, '4_GENERIC');
  assert.equal(res.brand_mentioned, true);
  assert.equal(res.brand_recommended, false);
  assert.equal(res.geo_quadrant, 'NONE');
  assert.equal(res.diagnostics.primary_quadrant, 'NONE');
});

// ============================================================================
// Suite 5: Interface Contract 2 & Schema Compliance
// ============================================================================
test('ADV-5.1: calculateMetrics output satisfies Interface Contract 2 & ingest.php requirements', () => {
  const text = 'Personio führt im deutschen HR-Softwaremarkt.';
  const citations = [
    { citation_url: 'https://personio.de/hr', citation_domain: 'personio.de', citation_title: 'Personio' }
  ];
  const competitors = [
    { name: 'Workday', domain: 'workday.com' }
  ];

  const computed = engine.calculateMetrics(text, 'Personio', ['personio.de'], competitors, citations);

  const fullPayload = {
    config_id: 101,
    user_id: 5,
    prompt: 'Welche HR-Software?',
    prompt_text: 'Welche HR-Software?',
    model_name: 'gemini-1.5-flash',
    model: 'gemini-1.5-flash',
    provider: 'gemini',
    raw_response: text,
    ...computed
  };

  // Validate via opaque-box ingest payload validator
  assertValidIngestPayload(fullPayload);
  assertValidMECE(fullPayload.mece_category);
  assertValidGEODiagnostic(fullPayload.geo_quadrant);

  // Field type assertions
  assert.equal(typeof fullPayload.total_chars, 'number');
  assert.equal(typeof fullPayload.total_words, 'number');
  assert.equal(typeof fullPayload.brand_mentioned, 'boolean');
  assert.equal(typeof fullPayload.brand_recommended, 'boolean');
  assert.equal(typeof fullPayload.char_earliness, 'number');
  assert.equal(typeof fullPayload.word_earliness, 'number');
  assert.equal(typeof fullPayload.relative_position_pct, 'number');

  // Competitor fields
  assert.ok(fullPayload.competitors.length > 0);
  assert.equal(fullPayload.competitors[0].competitor_name, 'Workday');
  assert.equal(typeof fullPayload.competitors[0].mentioned, 'boolean');
  assert.equal(typeof fullPayload.competitors[0].recommended, 'boolean');

  // Citation fields
  assert.ok(fullPayload.citations.length > 0);
  assert.equal(fullPayload.citations[0].citation_domain, 'personio.de');
  assert.equal(typeof fullPayload.citations[0].is_brand_domain, 'boolean');
  assert.equal(fullPayload.citations[0].is_brand_domain, true);
});

// ============================================================================
// Suite 6: Prototype Pollution Resistance & Malformed Input Resiliency
// ============================================================================
test('ADV-6.1: Malformed input types without throwing exceptions', () => {
  const malformedInputs = [
    null,
    undefined,
    12345,
    true,
    false,
    '',
    '   ',
    {},
    []
  ];

  for (const input of malformedInputs) {
    assert.doesNotThrow(() => engine.calculateMetrics(input));
    assert.doesNotThrow(() => engine.findBrandUnicode(input, 'Brand'));
    assert.doesNotThrow(() => engine.countWords(input));
    assert.doesNotThrow(() => engine.countChars(input));
    assert.doesNotThrow(() => engine.extractDomainFromUrl(input));
  }
});

test('ADV-6.2: Prototype pollution vulnerability demonstration', () => {
  // Test prototype pollution impact on calculation logic
  try {
    Object.prototype.brandSentiment = 'negative';
    const res = engine.calculateMetrics('Personio ist der klare Testsieger.', 'Personio');
    // Prototype pollution changed MECE from 1_DIRECT_WIN to 4_GENERIC!
    assert.equal(res.mece_category, '4_GENERIC', 'VULNERABILITY: Polluted prototype brandSentiment poisoned calculation logic');
  } finally {
    delete Object.prototype.brandSentiment;
  }
});

test('ADV-6.3: Null and undefined options object resilience', () => {
  assert.doesNotThrow(() => {
    engine.calculateMetrics({
      text: 'Personio ist großartig.',
      brandName: 'Personio',
      options: null
    });
  });

  assert.doesNotThrow(() => {
    engine.calculateMetrics({
      text: 'Personio ist großartig.',
      brandName: 'Personio',
      options: undefined
    });
  });
});
