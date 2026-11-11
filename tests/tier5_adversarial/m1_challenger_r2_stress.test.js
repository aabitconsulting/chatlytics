/**
 * tests/tier5_adversarial/m1_challenger_r2_stress.test.js
 * Empirical Adversarial Challenger Test Suite — Milestone 1 (Iteration 2)
 * 
 * Specifically targets and stress-tests the 5 remediated defect categories:
 * 1. Sparse citations array (null, undefined, empty objects, non-string URLs, non-primitives)
 * 2. Attached leading & trailing punctuation on brands (1 <= word_earliness <= total_words invariant)
 * 3. URL-encoded paths, ports, and queries in citations (extractDomainFromUrl & false hijack avoidance)
 * 4. Brand Halo with zero citations (returns 3_BRAND_HALO_TRAP, not 2_PARAMETRIC_BLINDSPOT)
 * 5. Uncompeted brand mention with negative sentiment (returns NONE, not 3_BRAND_HALO_TRAP)
 * 
 * Plus cross-combinatorial randomized fuzzing asserting invariant guarantees.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const enginePath = path.resolve(__dirname, '../../n8n/lib/metrics_engine.js');
const engine = require(enginePath);
const {
  calculateMetrics,
  findBrandUnicode,
  extractDomainFromUrl,
  matchesDomain,
  classifyMECE,
  evaluateGeoQuadrant,
  getWords,
  countWords,
  countChars
} = engine;

// ============================================================================
// SUITE 1: Defect 1 — Sparse, Malformed, and Irregular Citations Array
// ============================================================================
test('ADV-CHALLENGE-1.1: Sparse array with null, undefined, and sparse holes', () => {
  const sparseArrays = [
    [null],
    [undefined],
    [null, undefined],
    [null, null, null],
    [undefined, undefined],
    new Array(5) // sparse array with unassigned holes
  ];

  for (const sparseList of sparseArrays) {
    let res;
    assert.doesNotThrow(() => {
      res = calculateMetrics('Personio ist ein HR-Tool.', 'Personio', ['personio.de'], [], sparseList);
    }, `calculateMetrics crashed on sparse citations: ${JSON.stringify(sparseList)}`);

    assert.equal(res.has_citations, false, 'has_citations must be false for empty/null-only citations');
    assert.equal(res.citations.length, 0, 'citations array length must be 0');
    assert.equal(res.brand_domain_cited, false);
    assert.equal(res.competitor_cited, false);
  }
});

test('ADV-CHALLENGE-1.2: Citations containing unexpected primitive types (numbers, booleans, symbols)', () => {
  const invalidPrimitives = [
    12345,
    true,
    false,
    Symbol('citation'),
    () => 'https://example.com'
  ];

  let res;
  assert.doesNotThrow(() => {
    res = calculateMetrics('Personio ist ein HR-Tool.', 'Personio', ['personio.de'], [], invalidPrimitives);
  });

  assert.equal(res.has_citations, false, 'non-string/non-object primitives must be safely filtered');
  assert.equal(res.citations.length, 0);
});

test('ADV-CHALLENGE-1.3: Citations with empty or malformed objects and non-string URLs', () => {
  const malformedObjects = [
    {},
    { url: null },
    { url: undefined },
    { url: 12345 },
    { citation_url: null },
    { citation_url: 99999 },
    { citation_url: '' },
    { domain: null },
    { domain: 404 },
    { is_brand_domain: 'not-a-bool' },
    Object.create(null) // null-prototype object
  ];

  let res;
  assert.doesNotThrow(() => {
    res = calculateMetrics('Personio bietet HR Software.', 'Personio', ['personio.de'], [], malformedObjects);
  });

  // Verify that none threw and all returned safe standardized structures
  assert.ok(Array.isArray(res.citations));
  for (const cit of res.citations) {
    assert.equal(typeof cit.citation_index, 'number');
    assert.equal(typeof cit.domain, 'string');
    assert.equal(typeof cit.citation_domain, 'string');
    assert.equal(typeof cit.is_brand_domain, 'boolean');
    assert.equal(typeof cit.is_competitor_domain, 'boolean');
  }
});

test('ADV-CHALLENGE-1.4: Mixed sparse and valid citations interleaving', () => {
  const mixedCitations = [
    null,
    'https://personio.de/hr-software',
    undefined,
    { citation_url: 'https://workday.com/de-de', citation_title: 'Workday HR' },
    null,
    12345,
    { url: 'https://heise.de/thema/personio' }
  ];

  let res;
  assert.doesNotThrow(() => {
    res = calculateMetrics(
      'Personio und Workday im Vergleich.',
      'Personio',
      ['personio.de'],
      ['Workday'],
      mixedCitations
    );
  });

  assert.equal(res.has_citations, true);
  // Valid elements: personio string, workday object, heise object (3 valid citations)
  assert.equal(res.citations.length, 3);
  assert.equal(res.citations[0].citation_index, 1);
  assert.equal(res.citations[0].domain, 'personio.de');
  assert.equal(res.citations[0].is_brand_domain, true);
  assert.equal(res.citations[1].citation_index, 2);
  assert.equal(res.citations[1].domain, 'workday.com');
  assert.equal(res.citations[2].citation_index, 3);
  assert.equal(res.citations[2].domain, 'heise.de');
  assert.equal(res.brand_domain_cited, true);
});

test('ADV-CHALLENGE-1.5: Non-array citation parameter forms (null, undefined, single object, empty string)', () => {
  const nonArrays = [
    null,
    undefined,
    '',
    'not an array or url',
    { citation_url: 'https://personio.de' } // single object passed directly
  ];

  for (const arg of nonArrays) {
    let res;
    assert.doesNotThrow(() => {
      res = calculateMetrics('Personio ist super.', 'Personio', ['personio.de'], [], arg);
    });

    if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
      assert.equal(res.has_citations, true);
      assert.equal(res.citations.length, 1);
      assert.equal(res.brand_domain_cited, true);
    } else {
      assert.equal(res.has_citations, false);
      assert.equal(res.citations.length, 0);
    }
  }
});

// ============================================================================
// SUITE 2: Defect 2 — Attached Punctuation & Word Earliness Domain Invariant
// ============================================================================
test('ADV-CHALLENGE-2.1: Attached punctuation brackets, quotes, and typographic symbols', () => {
  const punctuationWrappers = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['<', '>'],
    ['«', '»'],
    ['»', '«'],
    ['‹', '›'],
    ['›', '‹'],
    ['„', '“'],
    ['‚', '‘'],
    ['“', '”'],
    ['”', '“'],
    ['"', '"'],
    ["'", "'"],
    ['—', '—'],
    ['–', '–'],
    ['/', '/'],
    ['\\', '\\'],
    ['¡', '!'],
    ['¿', '?'],
    ['*', '*'],
    ['_', '_'],
    ['~', '~'],
    ['((«[', ']»))']
  ];

  for (const [lead, trail] of punctuationWrappers) {
    // 1-word text: e.g. "(Personio)"
    const singleWord = `${lead}Personio${trail}`;
    const res1 = calculateMetrics(singleWord, 'Personio');

    assert.equal(res1.brand_mentioned, true, `Brand should be found in "${singleWord}"`);
    assert.equal(res1.total_words, 1, `Total words should be 1 for "${singleWord}"`);
    assert.equal(res1.word_earliness, 1, `word_earliness should be 1 for "${singleWord}"`);
    assert.ok(
      res1.word_earliness >= 1 && res1.word_earliness <= res1.total_words,
      `Invariant 1 <= word_earliness <= total_words violated for "${singleWord}": word_earliness=${res1.word_earliness}, total_words=${res1.total_words}`
    );

    // Multi-word text with brand in middle: "Empfehlung: (Personio) ist gut."
    const multiWord = `Empfehlung: ${lead}Personio${trail} ist gut.`;
    const res2 = calculateMetrics(multiWord, 'Personio');
    const words = getWords(multiWord);

    assert.equal(res2.brand_mentioned, true);
    assert.equal(res2.total_words, words.length);
    assert.equal(res2.word_earliness, 2, `word_earliness should be 2 for "${multiWord}"`);
    assert.ok(
      res2.word_earliness >= 1 && res2.word_earliness <= res2.total_words,
      `Invariant violated for "${multiWord}": word_earliness=${res2.word_earliness}, total_words=${res2.total_words}`
    );

    // Multi-word text with brand at the very end
    const endWord = `Das fuehrende Tool fuer HR ist ${lead}Personio${trail}`;
    const res3 = calculateMetrics(endWord, 'Personio');
    const endWords = getWords(endWord);

    assert.equal(res3.brand_mentioned, true);
    assert.equal(res3.total_words, endWords.length);
    assert.equal(res3.word_earliness, endWords.length);
    assert.ok(
      res3.word_earliness >= 1 && res3.word_earliness <= res3.total_words,
      `Invariant violated for "${endWord}": word_earliness=${res3.word_earliness}, total_words=${res3.total_words}`
    );
  }
});

test('ADV-CHALLENGE-2.2: German umlaut brands with attached punctuation and transliterations', () => {
  const brandCases = [
    { brand: 'München HR', text: 'Top Anbieter ist (München HR).', expectedWord: 4 },
    { brand: 'München HR', text: 'Top Anbieter ist (Muenchen HR).', expectedWord: 4 }, // ASCII digraph transliteration
    { brand: 'Süßwaren Pro', text: '«Suesswaren Pro» fuehrt den Markt an.', expectedWord: 1 },
    { brand: 'Überflieger', text: 'Großer Erfolg für „Überflieger“!', expectedWord: 4 },
    { brand: 'Überflieger', text: 'Großer Erfolg für „Ueberflieger“!', expectedWord: 4 }
  ];

  for (const { brand, text, expectedWord } of brandCases) {
    const res = calculateMetrics(text, brand);
    assert.equal(res.brand_mentioned, true, `Brand "${brand}" should match in "${text}"`);
    assert.equal(res.word_earliness, expectedWord, `word_earliness in "${text}" should be ${expectedWord}`);
    assert.ok(
      res.word_earliness >= 1 && res.word_earliness <= res.total_words,
      `Invariant failed for "${text}": word_earliness=${res.word_earliness}, total_words=${res.total_words}`
    );
  }
});

test('ADV-CHALLENGE-2.3: Fuzzing 500 randomized texts asserting 1 <= word_earliness <= total_words', () => {
  const punctuationMarks = ['(', ')', '[', ']', '{', '}', '«', '»', '„', '“', '"', "'", '—', '-', '/', ':', ';', '!', '?'];
  const fillerWords = ['Software', 'HR', 'Cloud', 'System', 'Mittelstand', 'Unternehmen', 'Empfehlung', 'Vergleich', 'Lösung', 'Test'];

  for (let i = 0; i < 500; i++) {
    const prefixCount = Math.floor(Math.random() * 15);
    const suffixCount = Math.floor(Math.random() * 15);

    const prefix = Array.from({ length: prefixCount }, () => fillerWords[Math.floor(Math.random() * fillerWords.length)]).join(' ');
    const suffix = Array.from({ length: suffixCount }, () => fillerWords[Math.floor(Math.random() * fillerWords.length)]).join(' ');

    const leadPunct = Array.from({ length: Math.floor(Math.random() * 3) }, () => punctuationMarks[Math.floor(Math.random() * punctuationMarks.length)]).join('');
    const trailPunct = Array.from({ length: Math.floor(Math.random() * 3) }, () => punctuationMarks[Math.floor(Math.random() * punctuationMarks.length)]).join('');

    const brandToken = `${leadPunct}Personio${trailPunct}`;
    const text = [prefix, brandToken, suffix].filter(s => s.length > 0).join(' ');

    const res = calculateMetrics(text, 'Personio');
    assert.equal(res.brand_mentioned, true);
    assert.ok(
      res.word_earliness >= 1,
      `Fuzzing iteration ${i}: word_earliness < 1 (got ${res.word_earliness}) for text: "${text}"`
    );
    assert.ok(
      res.word_earliness <= res.total_words,
      `Fuzzing iteration ${i}: word_earliness (${res.word_earliness}) > total_words (${res.total_words}) for text: "${text}"`
    );
  }
});

// ============================================================================
// SUITE 3: Defect 3 — URL-Encoded Paths, Ports, Queries & Hijack Avoidance
// ============================================================================
test('ADV-CHALLENGE-3.1: extractDomainFromUrl with encoded paths, ports, and queries', () => {
  const urlCases = [
    { url: 'https://personio.de%2Fhr', expected: 'personio.de' },
    { url: 'https://personio.de%2Fhr%2Fsoftware', expected: 'personio.de' },
    { url: 'https://personio.de%3A443%2Fpath', expected: 'personio.de' },
    { url: 'https://personio.de%3A8080%2Fapi%2Fv1', expected: 'personio.de' },
    { url: 'https://personio.de%3Futm_source%3Dchatgpt', expected: 'personio.de' },
    { url: 'https://personio.de%23overview', expected: 'personio.de' },
    { url: 'https://www.personio.de%2Fkarriere', expected: 'personio.de' },
    { url: 'https://app.personio.de%2Flogin%3Fredirect%3D1', expected: 'app.personio.de' },
    // Lowercase percent encoding
    { url: 'https://personio.de%2fpath%3a443%3fquery%3d1', expected: 'personio.de' },
    // Encoded userinfo
    { url: 'https://user%3Apass@personio.de%2Fpath', expected: 'personio.de' },
    // Malformed URI sequences with resilient fallback
    { url: 'https://personio.de%2Fhr%99%ZZ', expected: 'personio.de' }
  ];

  for (const { url, expected } of urlCases) {
    const extracted = extractDomainFromUrl(url);
    assert.equal(
      extracted,
      expected,
      `extractDomainFromUrl failed for "${url}": expected "${expected}", got "${extracted}"`
    );

    const matches = matchesDomain(url, ['personio.de']);
    assert.equal(
      matches,
      true,
      `matchesDomain failed for "${url}" against ["personio.de"]`
    );
  }
});

test('ADV-CHALLENGE-3.2: Adversarial domain spoofing attempts are firmly rejected', () => {
  const spoofAttempts = [
    'https://evilpersonio.de%2Fhr',
    'https://personio.de.attacker.com%2Fpath',
    'https://notpersonio.de%3A443',
    'https://personio.de-phishing.com%2F'
  ];

  for (const spoofUrl of spoofAttempts) {
    const matches = matchesDomain(spoofUrl, ['personio.de']);
    assert.equal(matches, false, `Spoof URL "${spoofUrl}" should NOT match "personio.de"`);
  }
});

test('ADV-CHALLENGE-3.3: calculateMetrics does NOT falsely trigger 1_CITATION_HIJACK on encoded URLs', () => {
  const encodedUrls = [
    'https://personio.de%2Fhr-software',
    'https://personio.de%3A443%2Fenterprise',
    'https://personio.de%3Fref%3Dgoogle_grounding',
    'https://www.personio.de%2Fpreise%23starter'
  ];

  for (const encodedUrl of encodedUrls) {
    const text = 'Personio ist die führende HR-Plattform in Deutschland.';
    const res = calculateMetrics(text, 'Personio', ['personio.de'], [], [encodedUrl]);

    assert.equal(res.mece_category, '1_DIRECT_WIN');
    assert.equal(res.brand_domain_cited, true, `brand_domain_cited must be true for "${encodedUrl}"`);
    assert.equal(
      res.geo_quadrant,
      'NONE',
      `geo_quadrant must be NONE (was: ${res.geo_quadrant}) for clean direct win with encoded citation: ${encodedUrl}`
    );
    assert.equal(res.diagnostics.is_citation_hijack, false);
  }
});

// ============================================================================
// SUITE 4: Defect 4 — Brand Halo with Zero Citations (Returns 3_BRAND_HALO_TRAP)
// ============================================================================
test('ADV-CHALLENGE-4.1: Brand Halo with empty citations array returns 3_BRAND_HALO_TRAP', () => {
  const text = 'Workday ist Marktführer. Personio bietet auch gute HR-Lösungen.';
  const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], []);

  assert.equal(res.mece_category, '2_BRAND_HALO');
  assert.equal(res.brand_mentioned, true);
  assert.equal(res.has_citations, false);
  assert.equal(
    res.geo_quadrant,
    '3_BRAND_HALO_TRAP',
    `Brand Halo with 0 citations must return 3_BRAND_HALO_TRAP, not ${res.geo_quadrant}`
  );
  assert.equal(res.diagnostics.is_brand_halo_trap, true);
  assert.equal(res.diagnostics.is_parametric_blindspot, false);
  assert.equal(res.diagnostics.is_citation_hijack, false);
});

test('ADV-CHALLENGE-4.2: Brand Halo with sparse citation arrays returns 3_BRAND_HALO_TRAP', () => {
  const sparseVariations = [
    [null],
    [undefined],
    [null, undefined]
  ];

  for (const sparseList of sparseVariations) {
    const text = 'Workday ist Marktführer. Personio bietet auch Lösungen.';
    const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], sparseList);

    assert.equal(res.mece_category, '2_BRAND_HALO');
    assert.equal(res.has_citations, false);
    assert.equal(res.geo_quadrant, '3_BRAND_HALO_TRAP');
    assert.equal(res.diagnostics.is_brand_halo_trap, true);
  }
});

test('ADV-CHALLENGE-4.3: Brand Halo with multiple competitors and variable text lengths', () => {
  const scenarios = [
    {
      text: 'SAP SuccessFactors und Workday dominieren den Markt. Personio eignet sich für KMUs.',
      competitors: ['SAP SuccessFactors', 'Workday'],
      brand: 'Personio'
    },
    {
      text: 'BambooHR führt die Rangliste an. Personio ist auf Platz zwei.',
      competitors: ['BambooHR'],
      brand: 'Personio'
    }
  ];

  for (const sc of scenarios) {
    const res = calculateMetrics(sc.text, sc.brand, ['personio.de'], sc.competitors, []);
    assert.equal(res.mece_category, '2_BRAND_HALO');
    assert.equal(res.geo_quadrant, '3_BRAND_HALO_TRAP');
    assert.equal(res.diagnostics.is_brand_halo_trap, true);
  }
});

// ============================================================================
// SUITE 5: Defect 5 — Uncompeted Negative Sentiment Brand Mention (Returns NONE)
// ============================================================================
test('ADV-CHALLENGE-5.1: Uncompeted brand mention with negative sentiment returns 4_GENERIC and NONE', () => {
  const text = 'Personio ist ungeeignet für Großkonzerne und stürzt regelmäßig ab.';
  const res = calculateMetrics(
    text,
    'Personio',
    ['personio.de'],
    [],
    [],
    { brandSentiment: 'negative' }
  );

  assert.equal(res.mece_category, '4_GENERIC');
  assert.equal(res.brand_mentioned, true);
  assert.equal(res.brand_recommended, false);
  assert.equal(
    res.geo_quadrant,
    'NONE',
    `Uncompeted negative sentiment brand must return NONE, not ${res.geo_quadrant}`
  );
  assert.equal(res.diagnostics.is_brand_halo_trap, false);
  assert.equal(res.diagnostics.is_parametric_blindspot, false);
  assert.equal(res.diagnostics.is_citation_hijack, false);
  assert.equal(res.diagnostics.primary_quadrant, 'NONE');
});

test('ADV-CHALLENGE-5.2: Sentiment case-insensitivity in uncompeted negative reviews', () => {
  const sentimentCasings = ['negative', 'NEGATIVE', 'Negative', 'NeGaTiVe'];

  for (const sentiment of sentimentCasings) {
    const text = 'Personio bietet mangelhaften Kundenservice.';
    const res = calculateMetrics(
      text,
      'Personio',
      ['personio.de'],
      [],
      [],
      { brandSentiment: sentiment }
    );

    assert.equal(res.mece_category, '4_GENERIC');
    assert.equal(res.geo_quadrant, 'NONE');
    assert.equal(res.diagnostics.is_brand_halo_trap, false);
  }
});

test('ADV-CHALLENGE-5.3: Uncompeted negative brand with sparse or own brand citations', () => {
  // With sparse citations [null]
  const resNull = calculateMetrics(
    'Personio ist mangelhaft.',
    'Personio',
    ['personio.de'],
    [],
    [null],
    { brandSentiment: 'negative' }
  );
  assert.equal(resNull.geo_quadrant, 'NONE');
  assert.equal(resNull.diagnostics.is_brand_halo_trap, false);

  // With own brand citation
  const resBrandCit = calculateMetrics(
    'Personio ist mangelhaft.',
    'Personio',
    ['personio.de'],
    [],
    ['https://personio.de/feedback'],
    { brandSentiment: 'negative' }
  );
  assert.equal(resBrandCit.brand_domain_cited, true);
  assert.equal(resBrandCit.geo_quadrant, 'NONE');
  assert.equal(resBrandCit.diagnostics.is_brand_halo_trap, false);
});

test('ADV-CHALLENGE-5.4: Contrast check: Competitor present with negative brand sentiment yields TAKEOVER', () => {
  const text = 'Personio ist ungeeignet. Workday ist die überlegene Plattform.';
  const res = calculateMetrics(
    text,
    'Personio',
    ['personio.de'],
    ['Workday'],
    [],
    { brandSentiment: 'negative' }
  );

  // When competitor is present, negative brand sentiment demotes to 3_COMPETITOR_TAKEOVER
  assert.equal(res.mece_category, '3_COMPETITOR_TAKEOVER');
  // Competitor recommended, brand is in text, 0 citations -> geo_quadrant is NONE (not blindspot because brand is mentioned)
  assert.equal(res.geo_quadrant, 'NONE');
  assert.equal(res.diagnostics.is_brand_halo_trap, false);
});

// ============================================================================
// SUITE 6: Cross-Combinatorial Fuzzing & Invariant Stress Verification
// ============================================================================
test('ADV-CHALLENGE-6.1: 1,000-Iteration Cross-Combinatorial Randomized Property Fuzzer', () => {
  const brands = ['Personio', 'München HR', 'Süßwaren Pro', 'Überflieger'];
  const brandDomainsMap = {
    'Personio': ['personio.de'],
    'München HR': ['muenchen-hr.de'],
    'Süßwaren Pro': ['suesswaren-pro.de'],
    'Überflieger': ['ueberflieger.com']
  };
  const compPool = ['Workday', 'SAP', 'BambooHR', 'Factorial'];
  const sentiments = ['positive', 'neutral', 'negative'];
  const punctuation = ['(', ')', '[', ']', '«', '»', '„', '“', '"', "'"];

  const startTime = Date.now();
  let validRuns = 0;

  for (let i = 0; i < 1000; i++) {
    const brand = brands[Math.floor(Math.random() * brands.length)];
    const brandDoms = brandDomainsMap[brand];
    const sentiment = sentiments[Math.floor(Math.random() * sentiments.length)];

    const includeComp = Math.random() > 0.4;
    const comps = includeComp ? [compPool[Math.floor(Math.random() * compPool.length)]] : [];

    const leadP = Math.random() > 0.5 ? punctuation[Math.floor(Math.random() * punctuation.length)] : '';
    const trailP = Math.random() > 0.5 ? punctuation[Math.floor(Math.random() * punctuation.length)] : '';
    const brandToken = `${leadP}${brand}${trailP}`;

    const pattern = Math.floor(Math.random() * 5);
    let text = '';
    if (pattern === 0) {
      // Brand only
      text = `Empfehlung für ${brandToken} im Enterprise Segment.`;
    } else if (pattern === 1) {
      // Brand before competitor
      text = `Wir empfehlen ${brandToken} vor ${comps[0] || 'Anderen'}.`;
    } else if (pattern === 2) {
      // Competitor before brand (Brand Halo)
      text = `${comps[0] || 'Workday'} ist führend, aber ${brandToken} ist auch da.`;
    } else if (pattern === 3) {
      // Competitor only
      text = `${comps[0] || 'Workday'} ist die beste Wahl.`;
    } else {
      // Generic
      text = 'Im Enterprise Segment gibt es viele verschiedene Softwarelösungen.';
    }

    // Citations
    const citPattern = Math.floor(Math.random() * 5);
    let citations = [];
    if (citPattern === 0) {
      citations = [];
    } else if (citPattern === 1) {
      citations = [null, undefined];
    } else if (citPattern === 2) {
      citations = [`https://${brandDoms[0]}%2Fportal`];
    } else if (citPattern === 3) {
      citations = ['https://third-party-review.de%2Fvergleich'];
    } else {
      citations = [null, `https://${brandDoms[0]}%3A443%2Fapi`, undefined];
    }

    let res;
    assert.doesNotThrow(() => {
      res = calculateMetrics(text, brand, brandDoms, comps, citations, { brandSentiment: sentiment });
    }, `Fuzzing threw at iteration ${i}`);

    // Invariants Check
    assert.ok(
      ['1_DIRECT_WIN', '2_BRAND_HALO', '3_COMPETITOR_TAKEOVER', '4_GENERIC'].includes(res.mece_category),
      `Invalid MECE category: ${res.mece_category}`
    );

    assert.ok(
      ['1_CITATION_HIJACK', '2_PARAMETRIC_BLINDSPOT', '3_BRAND_HALO_TRAP', '4_BURIED_WINNER', 'NONE'].includes(res.geo_quadrant),
      `Invalid GEO quadrant: ${res.geo_quadrant}`
    );

    if (res.brand_mentioned && res.word_earliness !== null) {
      assert.ok(
        res.word_earliness >= 1 && res.word_earliness <= res.total_words,
        `Word earliness invariant failed at iter ${i}: word_earliness=${res.word_earliness}, total_words=${res.total_words}`
      );
    }

    if (res.mece_category === '2_BRAND_HALO') {
      if (res.brand_domain_cited) {
        assert.equal(
          res.geo_quadrant,
          '1_CITATION_HIJACK',
          `Brand Halo with brand cited must evaluate to 1_CITATION_HIJACK at iter ${i}`
        );
      } else {
        assert.equal(
          res.geo_quadrant,
          '3_BRAND_HALO_TRAP',
          `Brand Halo without brand citation must evaluate to 3_BRAND_HALO_TRAP at iter ${i}`
        );
      }
    }

    if (res.mece_category === '4_GENERIC' && res.brand_mentioned && !includeComp && sentiment === 'negative' && res.citations.length === 0) {
      assert.equal(
        res.geo_quadrant,
        'NONE',
        `Uncompeted negative sentiment brand must evaluate to NONE (got: ${res.geo_quadrant}) at iter ${i}`
      );
    }

    validRuns++;
  }

  const duration = Date.now() - startTime;
  assert.equal(validRuns, 1000);
  console.log(`  ✔ Fuzzing Complete: 1,000 cross-combinatorial iterations passed in ${duration}ms with 0 failures.`);
});
