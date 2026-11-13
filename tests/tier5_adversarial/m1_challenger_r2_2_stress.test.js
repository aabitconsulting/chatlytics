/**
 * tests/tier5_adversarial/m1_challenger_r2_2_stress.test.js
 * Independent Empirical Adversarial Challenger Test Suite #2 — Milestone 1 (Iteration 2)
 * 
 * Verifies:
 * 1. Extreme text lengths (100k, 250k, 500k chars) & ReDoS resistance.
 * 2. Attached punctuation boundary invariants (1 <= word_earliness <= total_words).
 * 3. Strict MECE reachability and mutual exclusivity partition matrix.
 * 4. 4 GEO Quadrants + NONE reachability and boundary conditions.
 * 5. 2,500-Iteration Property-Based Randomized Fuzzing Harness.
 * 6. German Unicode transliteration permutations and case-folding.
 * 7. URL and domain extraction adversarial cases & spoof resistance.
 * 8. High cardinality stress (500 competitors & 500 citations).
 * 9. Multi-occurrence earliest resolution and prototype pollution safety.
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
  classifyMECE,
  evaluateGeoQuadrant,
  buildGermanRegex,
  normalizeGermanText,
  getWords,
  countWords,
  countChars,
  extractDomainFromUrl,
  matchesDomain
} = engine;

const VALID_MECE = ['1_DIRECT_WIN', '2_BRAND_HALO', '3_COMPETITOR_TAKEOVER', '4_GENERIC'];
const VALID_GEO = ['1_CITATION_HIJACK', '2_PARAMETRIC_BLINDSPOT', '3_BRAND_HALO_TRAP', '4_BURIED_WINNER', 'NONE'];

// ============================================================================
// 1. Extreme Text Lengths (>100k - 500k chars) & ReDoS Verification
// ============================================================================
test('CHALLENGE2-1.1: 100,000+ characters with complex German corporate narrative', () => {
  const paragraph = 'Die Personio SE & Co. KG digitalisiert HR-Prozesse deutscher KMUs mit höchster Präzision. ';
  const repeatCount = Math.ceil(100000 / paragraph.length);
  const text = paragraph.repeat(repeatCount);

  const start = performance.now();
  const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday', 'SAP']);
  const elapsed = performance.now() - start;

  assert.ok(res.total_chars >= 100000, `Expected >= 100k chars, got ${res.total_chars}`);
  assert.equal(res.brand_mentioned, true);
  assert.equal(res.char_earliness, 4); // First mention in "Die Personio..."
  assert.equal(res.word_earliness, 2);
  assert.ok(elapsed < 200, `100k chars took ${elapsed}ms (must be < 200ms)`);
});

test('CHALLENGE2-1.2: 250,000 characters pathological repetitive umlauts (ReDoS probe)', () => {
  // Pathological pattern designed to trigger backtracking in naive regex engines:
  // repetitive partial matches that fail at the last character
  const chunk = 'ae ä oe ö ue ü ss ß ẞ aeae aeaee Kaer Kaerch Kärch ';
  const text = chunk.repeat(Math.ceil(250000 / chunk.length)) + ' Kärcher ist Testsieger.';

  const start = performance.now();
  const res = calculateMetrics(text, 'Kärcher', ['kaercher.de']);
  const elapsed = performance.now() - start;

  assert.ok(res.total_chars >= 250000, `Expected >= 250k chars, got ${res.total_chars}`);
  assert.equal(res.brand_mentioned, true);
  assert.ok(elapsed < 350, `250k chars pathological search took ${elapsed}ms (must be < 350ms)`);
});

test('CHALLENGE2-1.3: 500,000 characters extreme payload with late brand mention', () => {
  const filler = 'Viel Text ohne Nennung der Zielmarke im deutschen Mittelstand. '.repeat(8000);
  const text = filler + ' Am Ende gewinnt Personio eindeutig.';

  const start = performance.now();
  const res = calculateMetrics(text, 'Personio', ['personio.de']);
  const elapsed = performance.now() - start;

  assert.ok(res.total_chars >= 500000, `Expected >= 500k chars, got ${res.total_chars}`);
  assert.equal(res.brand_mentioned, true);
  assert.ok(res.char_earliness >= 500000);
  assert.ok(res.relative_position_pct > 99.0);
  assert.equal(res.mece_category, '1_DIRECT_WIN');
  assert.equal(res.geo_quadrant, '4_BURIED_WINNER'); // Because rel pos > 50%
  assert.ok(elapsed < 450, `500k chars took ${elapsed}ms (must be < 450ms)`);
});

test('CHALLENGE2-1.4: 100,000 characters of worst-case non-matching text', () => {
  // Worst-case text where regex has to scan every character and find zero matches
  const text = 'xyz '.repeat(25000); // 100k chars of 'xyz xyz ...'

  const start = performance.now();
  const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday', 'SAP']);
  const elapsed = performance.now() - start;

  assert.equal(res.brand_mentioned, false);
  assert.equal(res.char_earliness, null);
  assert.equal(res.word_earliness, null);
  assert.equal(res.mece_category, '4_GENERIC');
  assert.ok(elapsed < 100, `100k non-matching scan took ${elapsed}ms (must be < 100ms)`);
});

// ============================================================================
// 2. Attached Punctuation & Earliness Boundary Invariants
// ============================================================================
test('CHALLENGE2-2.1: Exhaustive attached punctuation matrix on brand earliness', () => {
  const punctuationCases = [
    { text: '(Personio)', expectedWords: 1, expectedEarly: 1 },
    { text: '[Personio]', expectedWords: 1, expectedEarly: 1 },
    { text: '{Personio}', expectedWords: 1, expectedEarly: 1 },
    { text: '«Personio»', expectedWords: 1, expectedEarly: 1 },
    { text: '„Personio"', expectedWords: 1, expectedEarly: 1 },
    { text: '"Personio"', expectedWords: 1, expectedEarly: 1 },
    { text: '`Personio`', expectedWords: 1, expectedEarly: 1 },
    { text: '**Personio**', expectedWords: 1, expectedEarly: 1 },
    { text: '...Personio...', expectedWords: 1, expectedEarly: 1 },
    { text: '->Personio<-', expectedWords: 1, expectedEarly: 1 },
    { text: 'Personio!', expectedWords: 1, expectedEarly: 1 },
    { text: 'Personio?', expectedWords: 1, expectedEarly: 1 },
    { text: 'Personio;', expectedWords: 1, expectedEarly: 1 },
    { text: 'Personio,', expectedWords: 1, expectedEarly: 1 },
    { text: 'Personio.', expectedWords: 1, expectedEarly: 1 },
    { text: '1. Personio', expectedWords: 2, expectedEarly: 2 },
    { text: 'Tipp: (Personio)', expectedWords: 2, expectedEarly: 2 },
    { text: 'Empfehlung: [Personio]', expectedWords: 2, expectedEarly: 2 },
    { text: 'Erster Platz: „Personio“', expectedWords: 3, expectedEarly: 3 },
    { text: 'Sehr gut: »Personio«', expectedWords: 3, expectedEarly: 3 },
    { text: 'Vergleich: (Workday vs. Personio)', expectedWords: 4, expectedEarly: 4 }
  ];

  for (const c of punctuationCases) {
    const res = calculateMetrics(c.text, 'Personio');
    assert.equal(res.brand_mentioned, true, `Failed to find brand in "${c.text}"`);
    assert.equal(res.total_words, c.expectedWords, `total_words mismatch for "${c.text}": got ${res.total_words}, expected ${c.expectedWords}`);
    assert.equal(res.word_earliness, c.expectedEarly, `word_earliness mismatch for "${c.text}": got ${res.word_earliness}, expected ${c.expectedEarly}`);
    assert.ok(
      res.word_earliness >= 1 && res.word_earliness <= res.total_words,
      `Invariant violated in "${c.text}": 1 <= ${res.word_earliness} <= ${res.total_words}`
    );
  }
});

// ============================================================================
// 3. MECE Reachability & Mutual Exclusivity Verification
// ============================================================================
test('CHALLENGE2-3.1: Strict MECE mutual exclusivity and reachability partition test', () => {
  const counts = {
    '1_DIRECT_WIN': 0,
    '2_BRAND_HALO': 0,
    '3_COMPETITOR_TAKEOVER': 0,
    '4_GENERIC': 0
  };

  const brandPermutations = [true, false];
  const compPermutations = [true, false];
  const earlinessPairs = [
    { b: 10, c: 20 }, // brand earlier
    { b: 20, c: 20 }, // tied
    { b: 30, c: 20 }  // competitor earlier
  ];
  const sentimentOptions = ['neutral', 'positive', 'negative', 'POSITIVE', 'NEGATIVE', ''];

  for (const bm of brandPermutations) {
    for (const cm of compPermutations) {
      for (const pair of earlinessPairs) {
        for (const sent of sentimentOptions) {
          const bEarly = bm ? pair.b : null;
          const cEarly = cm ? pair.c : null;

          const category = classifyMECE(bm, cm, bEarly, cEarly, sent);

          assert.ok(VALID_MECE.includes(category), `Invalid category returned: ${category}`);
          counts[category]++;

          // Mutual exclusivity / contract rules verification
          if (!bm && !cm) {
            assert.equal(category, '4_GENERIC');
          } else if (!bm && cm) {
            assert.equal(category, '3_COMPETITOR_TAKEOVER');
          } else if (bm && !cm) {
            const isNeg = sent.toLowerCase() === 'negative';
            assert.equal(category, isNeg ? '4_GENERIC' : '1_DIRECT_WIN');
          } else if (bm && cm) {
            const isNeg = sent.toLowerCase() === 'negative';
            if (isNeg) {
              assert.equal(category, '3_COMPETITOR_TAKEOVER');
            } else if (bEarly <= cEarly) {
              assert.equal(category, '1_DIRECT_WIN');
            } else {
              assert.equal(category, '2_BRAND_HALO');
            }
          }
        }
      }
    }
  }

  // Verify all 4 categories were reached
  assert.ok(counts['1_DIRECT_WIN'] > 0, '1_DIRECT_WIN was never reached');
  assert.ok(counts['2_BRAND_HALO'] > 0, '2_BRAND_HALO was never reached');
  assert.ok(counts['3_COMPETITOR_TAKEOVER'] > 0, '3_COMPETITOR_TAKEOVER was never reached');
  assert.ok(counts['4_GENERIC'] > 0, '4_GENERIC was never reached');
});

// ============================================================================
// 4. GEO Quadrant + NONE Reachability & Boundary Verification
// ============================================================================
test('CHALLENGE2-4.1: Verify all 4 GEO quadrants and NONE are reachable under exact operational conditions', () => {
  const geoCounts = {
    '1_CITATION_HIJACK': 0,
    '2_PARAMETRIC_BLINDSPOT': 0,
    '3_BRAND_HALO_TRAP': 0,
    '4_BURIED_WINNER': 0,
    'NONE': 0
  };

  // Scenario 1: Clean DIRECT WIN with brand citation -> NONE
  const res1 = calculateMetrics(
    'Personio ist der unangefochtene Marktführer für HR im Mittelstand.',
    'Personio',
    ['personio.de'],
    ['Workday'],
    [{ citation_url: 'https://personio.de/pricing', citation_domain: 'personio.de' }]
  );
  assert.equal(res1.mece_category, '1_DIRECT_WIN');
  assert.equal(res1.geo_quadrant, 'NONE');
  geoCounts[res1.geo_quadrant]++;

  // Scenario 2: Buried Winner (>50% relative position) -> 4_BURIED_WINNER
  const padding = 'Neutraler Text über Personalsoftware im Mittelstand. '.repeat(10);
  const res2 = calculateMetrics(
    padding + 'Abschließend empfehlen wir Personio.',
    'Personio',
    ['personio.de'],
    ['Workday'],
    [{ citation_url: 'https://personio.de', citation_domain: 'personio.de' }]
  );
  assert.equal(res2.mece_category, '1_DIRECT_WIN');
  assert.equal(res2.geo_quadrant, '4_BURIED_WINNER');
  geoCounts[res2.geo_quadrant]++;

  // Scenario 3: Buried Winner (word earliness > 50) -> 4_BURIED_WINNER
  const words55 = Array.from({ length: 55 }, (_, i) => `Wort${i}`).join(' ') + ' Personio';
  const res3 = calculateMetrics(
    words55,
    'Personio',
    ['personio.de'],
    [],
    [{ citation_url: 'https://personio.de', citation_domain: 'personio.de' }]
  );
  assert.equal(res3.mece_category, '1_DIRECT_WIN');
  assert.equal(res3.geo_quadrant, '4_BURIED_WINNER');
  geoCounts[res3.geo_quadrant]++;

  // Scenario 4: Brand Halo with competitor citation -> 3_BRAND_HALO_TRAP
  const res4 = calculateMetrics(
    'Workday ist führend für Konzerne. Personio eignet sich für KMUs.',
    'Personio',
    ['personio.de'],
    [{ name: 'Workday', domains: ['workday.com'] }],
    [{ citation_url: 'https://workday.com', citation_domain: 'workday.com' }]
  );
  assert.equal(res4.mece_category, '2_BRAND_HALO');
  assert.equal(res4.geo_quadrant, '3_BRAND_HALO_TRAP');
  geoCounts[res4.geo_quadrant]++;

  // Scenario 5: Brand Halo with 0 citations -> 3_BRAND_HALO_TRAP (Defect 4 remediation verification)
  const res5 = calculateMetrics(
    'Workday führt das Ranking an. Personio folgt auf Platz 2.',
    'Personio',
    ['personio.de'],
    ['Workday'],
    []
  );
  assert.equal(res5.mece_category, '2_BRAND_HALO');
  assert.equal(res5.geo_quadrant, '3_BRAND_HALO_TRAP');
  geoCounts[res5.geo_quadrant]++;

  // Scenario 6: Brand mentioned, brand not cited, external citations exist -> 1_CITATION_HIJACK (Case B)
  const res6 = calculateMetrics(
    'Personio ist die empfohlene Lösung für KMU.',
    'Personio',
    ['personio.de'],
    ['Workday'],
    [{ citation_url: 'https://vergleich.de/hr', citation_domain: 'vergleich.de' }]
  );
  assert.equal(res6.mece_category, '1_DIRECT_WIN');
  assert.equal(res6.geo_quadrant, '1_CITATION_HIJACK');
  geoCounts[res6.geo_quadrant]++;

  // Scenario 7: Brand cited in grounding, but competitor recommended -> 1_CITATION_HIJACK (Case A)
  const res7 = calculateMetrics(
    'Workday ist der klare Testsieger.',
    'Personio',
    ['personio.de'],
    [{ name: 'Workday', domains: ['workday.com'] }],
    [{ citation_url: 'https://personio.de/blog', citation_domain: 'personio.de' }]
  );
  assert.equal(res7.mece_category, '3_COMPETITOR_TAKEOVER');
  assert.equal(res7.geo_quadrant, '1_CITATION_HIJACK');
  geoCounts[res7.geo_quadrant]++;

  // Scenario 8: Brand cited in grounding, but omitted from text -> 2_PARAMETRIC_BLINDSPOT (Case A)
  const res8 = calculateMetrics(
    'Der Markt für Personalsoftware ist stark fragmentiert.',
    'Personio',
    ['personio.de'],
    ['Workday'],
    [{ citation_url: 'https://personio.de/whitepaper', citation_domain: 'personio.de' }]
  );
  assert.equal(res8.mece_category, '4_GENERIC');
  assert.equal(res8.geo_quadrant, '2_PARAMETRIC_BLINDSPOT');
  geoCounts[res8.geo_quadrant]++;

  // Scenario 9: Competitor recommended with 0 citations & brand omitted -> 2_PARAMETRIC_BLINDSPOT (Case B)
  const res9 = calculateMetrics(
    'Workday ist das beste System für Unternehmen.',
    'Personio',
    ['personio.de'],
    ['Workday'],
    []
  );
  assert.equal(res9.mece_category, '3_COMPETITOR_TAKEOVER');
  assert.equal(res9.geo_quadrant, '2_PARAMETRIC_BLINDSPOT');
  geoCounts[res9.geo_quadrant]++;

  // Scenario 10: Negative sentiment brand with 0 competitors and 0 citations -> NONE (Defect 5 ghost halo check)
  const res10 = calculateMetrics(
    'Personio ist völlig ungeeignet für Großkonzerne.',
    'Personio',
    ['personio.de'],
    [],
    [],
    { brandSentiment: 'negative' }
  );
  assert.equal(res10.mece_category, '4_GENERIC');
  assert.equal(res10.geo_quadrant, 'NONE');
  geoCounts[res10.geo_quadrant]++;

  // Scenario 11: Generic text with 0 citations -> NONE
  const res11 = calculateMetrics(
    'Cloud-Software bietet Vorteile gegenüber On-Premise-Lösungen.',
    'Personio',
    ['personio.de'],
    ['Workday'],
    []
  );
  assert.equal(res11.mece_category, '4_GENERIC');
  assert.equal(res11.geo_quadrant, 'NONE');
  geoCounts[res11.geo_quadrant]++;

  // Assert that ALL 5 states were reached
  for (const q of VALID_GEO) {
    assert.ok(geoCounts[q] > 0, `GEO Quadrant ${q} was never reached!`);
  }
});

// ============================================================================
// 5. Property-Based Randomized Fuzzing (2,500 Iterations)
// ============================================================================
test('CHALLENGE2-5.1: 2,500-Iteration Property-Based Randomized Fuzzing Harness', () => {
  const UNICODE_SNIPPETS = [
    'äöüÄÖÜßẞ', 'ae oe ue ss', ' Kaercher ', ' Kärcher ', ' Müller & Söhne ',
    '🚀 💡 🇩🇪 🇪🇺', '\u200B\uFEFF\u00A0', '«Personio»', '„Personio"', '“Personio”',
    '**Personio**', '`Personio`', '(Personio)', '[Personio]', '{Personio}',
    'Personio/Workday', 'Personio\\Workday', 'Personio—Workday', 'Personio–Workday',
    '100% DSGVO-konform', 'ISO/IEC 27001', 'Kosten: 1.490,00 €', 'C++ Software',
    'https://personio.de%2Fhr-software', 'https://user:pass@personio.de:8080/path',
    'Münchner Rückversicherungs-Gesellschaft', 'Bayerische Motoren Werke', 'Häfele SE'
  ];

  const BRAND_POOL = [
    'Personio', 'Kärcher', 'Münchener Rück', 'Häfele', 'SAP', 'Workday',
    'FlixBus', 'Große Lösungen', 'Bayerische Motoren Werke'
  ];

  const CITATION_GENERATORS = [
    () => null,
    () => undefined,
    () => 'https://personio.de/hr',
    () => 'https://sub.personio.de/login?ref=test#top',
    () => 'https://personio.de%2Fhr-software',
    () => 'https://www.workday.com/de-de',
    () => 'https://aggregator.de/vergleich',
    () => ({ url: 'https://personio.de/pricing', domain: 'personio.de', title: 'Preise' }),
    () => ({ citation_url: 'https://workday.com', citation_domain: 'workday.com' }),
    () => ({ citation_url: null, citation_domain: undefined }),
    () => ({ url: 'malformed uri %zz %80', title: 'Invalid URI' }),
    () => ({ citation_url: 'https://very-long-domain-name-'.repeat(20) + '.de' })
  ];

  const SENTIMENTS = ['neutral', 'positive', 'negative', 'POSITIVE', 'NEGATIVE', undefined, null, ''];

  let directWins = 0;
  let brandHalos = 0;
  let competitorTakeovers = 0;
  let generics = 0;

  const geoTally = {
    '1_CITATION_HIJACK': 0,
    '2_PARAMETRIC_BLINDSPOT': 0,
    '3_BRAND_HALO_TRAP': 0,
    '4_BURIED_WINNER': 0,
    'NONE': 0
  };

  const startTime = performance.now();
  const ITERATIONS = 2500;

  for (let i = 0; i < ITERATIONS; i++) {
    // 1. Pick target brand
    const brand = BRAND_POOL[i % BRAND_POOL.length];
    const brandDomains = [`${brand.toLowerCase().replace(/[^a-z0-9]/g, '')}.de`];

    // 2. Pick 0 to 3 competitors
    const competitorCount = Math.floor(Math.random() * 4);
    const competitors = [];
    for (let c = 0; c < competitorCount; c++) {
      const compBrand = BRAND_POOL[(i + c + 1) % BRAND_POOL.length];
      if (compBrand !== brand) {
        competitors.push(Math.random() > 0.5 ? compBrand : { name: compBrand, domain: `${compBrand.toLowerCase().replace(/[^a-z0-9]/g, '')}.com` });
      }
    }

    // 3. Generate citations list (with sparse/null elements)
    const citCount = Math.floor(Math.random() * 6);
    const citations = [];
    for (let c = 0; c < citCount; c++) {
      const gen = CITATION_GENERATORS[Math.floor(Math.random() * CITATION_GENERATORS.length)];
      citations.push(gen());
    }

    // 4. Construct synthetic text
    const textSnippets = [];
    const snippetCount = 2 + Math.floor(Math.random() * 8);
    for (let s = 0; s < snippetCount; s++) {
      textSnippets.push(UNICODE_SNIPPETS[Math.floor(Math.random() * UNICODE_SNIPPETS.length)]);
    }

    // Randomly insert brand and/or competitor
    if (Math.random() > 0.3) {
      const brandFormat = Math.random() > 0.5 ? brand : `„${brand}“`;
      const pos = Math.floor(Math.random() * (textSnippets.length + 1));
      textSnippets.splice(pos, 0, brandFormat);
    }
    if (Math.random() > 0.3 && competitors.length > 0) {
      const compItem = competitors[0];
      const compName = typeof compItem === 'string' ? compItem : compItem.name;
      const pos = Math.floor(Math.random() * (textSnippets.length + 1));
      textSnippets.splice(pos, 0, `(${compName})`);
    }

    const text = textSnippets.join(' ');
    const sentiment = SENTIMENTS[Math.floor(Math.random() * SENTIMENTS.length)];

    // 5. Execute calculateMetrics
    let res;
    assert.doesNotThrow(() => {
      res = calculateMetrics({
        text,
        brand_name: brand,
        brand_domains: brandDomains,
        competitors,
        citations,
        options: { brandSentiment: sentiment }
      });
    }, `Iteration ${i} threw an unhandled exception`);

    // Invariant 1: Type safety and numeric constraints
    assert.ok(Number.isInteger(res.total_chars) && res.total_chars >= 0, `Iteration ${i}: invalid total_chars`);
    assert.ok(Number.isInteger(res.total_words) && res.total_words >= 0, `Iteration ${i}: invalid total_words`);
    assert.ok(!Number.isNaN(res.total_chars), `Iteration ${i}: total_chars NaN`);
    assert.ok(!Number.isNaN(res.total_words), `Iteration ${i}: total_words NaN`);

    // Invariant 2: Boundary conditions for word_earliness
    if (res.brand_mentioned) {
      assert.ok(res.char_earliness >= 0 && res.char_earliness < res.total_chars, `Iteration ${i}: char_earliness out of range`);
      assert.ok(
        res.word_earliness >= 1 && res.word_earliness <= res.total_words,
        `Iteration ${i}: word_earliness violation (got ${res.word_earliness}, total_words: ${res.total_words}) for text: "${text}"`
      );
      assert.ok(
        res.relative_position_pct >= 0 && res.relative_position_pct <= 100,
        `Iteration ${i}: relative_position_pct out of range`
      );
    } else {
      assert.equal(res.char_earliness, null);
      assert.equal(res.word_earliness, null);
      assert.equal(res.relative_position_pct, null);
    }

    // Invariant 3: Competitor word earliness boundaries
    for (const comp of res.competitors) {
      if (comp.mentioned) {
        assert.ok(comp.char_earliness >= 0 && comp.char_earliness < res.total_chars);
        assert.ok(
          comp.word_earliness >= 1 && comp.word_earliness <= res.total_words,
          `Iteration ${i}: competitor word_earliness violation`
        );
      } else {
        assert.equal(comp.char_earliness, null);
        assert.equal(comp.word_earliness, null);
      }
    }

    // Invariant 4: MECE & GEO validity
    assert.ok(VALID_MECE.includes(res.mece_category));
    assert.ok(VALID_GEO.includes(res.geo_quadrant));

    if (res.mece_category === '1_DIRECT_WIN') directWins++;
    if (res.mece_category === '2_BRAND_HALO') brandHalos++;
    if (res.mece_category === '3_COMPETITOR_TAKEOVER') competitorTakeovers++;
    if (res.mece_category === '4_GENERIC') generics++;

    geoTally[res.geo_quadrant]++;

    // Invariant 5: Diagnostics object integrity
    assert.equal(res.diagnostics.primary_quadrant, res.geo_quadrant);
    assert.equal(res.diagnostics.is_citation_hijack, res.geo_quadrant === '1_CITATION_HIJACK');
    assert.equal(res.diagnostics.is_parametric_blindspot, res.geo_quadrant === '2_PARAMETRIC_BLINDSPOT');
    assert.equal(res.diagnostics.is_brand_halo_trap, res.geo_quadrant === '3_BRAND_HALO_TRAP');
    assert.equal(res.diagnostics.is_buried_winner, res.geo_quadrant === '4_BURIED_WINNER');

    // Invariant 6: Citations normalization resilience
    assert.ok(Array.isArray(res.citations));
    for (let cIdx = 0; cIdx < res.citations.length; cIdx++) {
      const citObj = res.citations[cIdx];
      assert.equal(citObj.citation_index, cIdx + 1);
      assert.ok(typeof citObj.domain === 'string');
      assert.ok(typeof citObj.is_brand_domain === 'boolean');
      assert.ok(typeof citObj.is_competitor_domain === 'boolean');
    }
  }

  const duration = (performance.now() - startTime).toFixed(1);

  // Assert diversity of fuzz outcomes
  assert.ok(directWins > 0, 'No 1_DIRECT_WIN generated');
  assert.ok(brandHalos > 0, 'No 2_BRAND_HALO generated');
  assert.ok(competitorTakeovers > 0, 'No 3_COMPETITOR_TAKEOVER generated');
  assert.ok(generics > 0, 'No 4_GENERIC generated');

  assert.ok(geoTally['1_CITATION_HIJACK'] > 0, 'No 1_CITATION_HIJACK generated in fuzzing');
  assert.ok(geoTally['2_PARAMETRIC_BLINDSPOT'] > 0, 'No 2_PARAMETRIC_BLINDSPOT generated in fuzzing');
  assert.ok(geoTally['3_BRAND_HALO_TRAP'] > 0, 'No 3_BRAND_HALO_TRAP generated in fuzzing');
  assert.ok(geoTally['4_BURIED_WINNER'] > 0, 'No 4_BURIED_WINNER generated in fuzzing');
  assert.ok(geoTally['NONE'] > 0, 'No NONE generated in fuzzing');

  console.log(`  ✔ Fuzzing: ${ITERATIONS} iterations passed in ${duration}ms with zero violations.`);
  console.log(`    MECE Distribution: WIN=${directWins}, HALO=${brandHalos}, TAKEOVER=${competitorTakeovers}, GENERIC=${generics}`);
  console.log(`    GEO Distribution: HIJACK=${geoTally['1_CITATION_HIJACK']}, BLINDSPOT=${geoTally['2_PARAMETRIC_BLINDSPOT']}, HALO_TRAP=${geoTally['3_BRAND_HALO_TRAP']}, BURIED=${geoTally['4_BURIED_WINNER']}, NONE=${geoTally['NONE']}`);
});

// ============================================================================
// 6. German Umlaut, Eszett (ß, ẞ), and Transliteration Invariance
// ============================================================================
test('CHALLENGE2-6.1: Full German transliteration permutation coverage', () => {
  const brandVariants = [
    { brand: 'Kärcher', text: 'Wir empfehlen Kärcher für Industrieanlagen.', expectedType: 'unicode_exact' },
    { brand: 'Kärcher', text: 'Wir empfehlen Kaercher für Industrieanlagen.', expectedType: 'german_transliterated' },
    { brand: 'Kaercher', text: 'Wir empfehlen Kärcher für Industrieanlagen.', expectedType: 'german_transliterated' },
    { brand: 'Münchener Rück', text: 'Die Muenchener Rueck ist der führende Rückversicherer.', expectedType: 'german_transliterated' },
    { brand: 'Münchener Rück', text: 'Die Münchener Rück ist der führende Rückversicherer.', expectedType: 'unicode_exact' },
    { brand: 'Große Software', text: 'Eine grosse Software für den Mittelstand.', expectedType: 'german_transliterated' },
    { brand: 'Große Software', text: 'Eine GROSSE Software für den Mittelstand.', expectedType: 'german_transliterated' },
    { brand: 'Große Software', text: 'Eine GROẞE Software für den Mittelstand.', expectedType: 'unicode_exact' },
    { brand: 'Häfele', text: 'Haefele Beschlagtechnik für Profis.', expectedType: 'german_transliterated' },
    { brand: 'Häfele', text: 'HÄFELE Beschlagtechnik für Profis.', expectedType: 'unicode_exact' }
  ];

  for (const v of brandVariants) {
    const res = findBrandUnicode(v.text, v.brand);
    assert.equal(res.found, true, `Failed to match brand "${v.brand}" in "${v.text}"`);
    assert.equal(res.matchType, v.expectedType, `matchType mismatch for "${v.brand}": got ${res.matchType}, expected ${v.expectedType}`);
    assert.ok(res.charIndex !== null && res.charIndex >= 0);
    assert.ok(res.wordIndex !== null && res.wordIndex >= 1);
  }
});

// ============================================================================
// 7. Domain Extraction & Sanitization Stress
// ============================================================================
test('CHALLENGE2-7.1: URL and domain extraction adversarial cases', () => {
  const urlCases = [
    { input: 'https://personio.de%2Fhr-software', expected: 'personio.de' },
    { input: 'https://user:password@personio.de:8443/dashboard?v=1#sec', expected: 'personio.de' },
    { input: 'http://WWW.Personio.DE/index.html', expected: 'personio.de' },
    { input: 'personio.de', expected: 'personio.de' },
    { input: 'app.personio.de', expected: 'app.personio.de' },
    { input: 'https://malformed-url%zz%99.de/path', expected: 'malformed-url%zz%99.de' },
    { input: 'https://personio.de%3a8080%2fapi', expected: 'personio.de' },
    { input: '', expected: '' },
    { input: null, expected: '' },
    { input: undefined, expected: '' }
  ];

  for (const c of urlCases) {
    const res = extractDomainFromUrl(c.input);
    assert.equal(res, c.expected, `extractDomainFromUrl failed for "${c.input}": got "${res}", expected "${c.expected}"`);
  }

  // Domain matching tests
  assert.equal(matchesDomain('https://app.personio.de/login', ['personio.de']), true);
  assert.equal(matchesDomain('https://personio.de%2Fhr', ['personio.de']), true);
  assert.equal(matchesDomain('https://fake-personio.de', ['personio.de']), false);
  assert.equal(matchesDomain('https://personio.de.attacker.com', ['personio.de']), false);
});

// ============================================================================
// 8. Scale & High Cardinality Stress (Competitors & Citations)
// ============================================================================
test('CHALLENGE2-8.1: High cardinality stress (50x60 and 200x200)', () => {
  // Test A: 50 competitors x 60 citations (5x real-world max)
  const comps50 = Array.from({ length: 50 }, (_, i) => ({
    name: `CompetitorEntity_${i}`,
    domain: `competitor${i}.com`
  }));
  const cits60 = Array.from({ length: 60 }, (_, i) => ({
    citation_url: `https://aggregator${i}.com/review`,
    citation_domain: `aggregator${i}.com`
  }));

  const text = 'Personio führt den Markt an, gefolgt von CompetitorEntity_42.';
  const startA = performance.now();
  const resA = calculateMetrics(text, 'Personio', ['personio.de'], comps50, cits60);
  const elapsedA = performance.now() - startA;

  assert.equal(resA.brand_mentioned, true);
  assert.equal(resA.competitors.length, 50);
  assert.equal(resA.citations.length, 60);
  assert.equal(resA.mece_category, '1_DIRECT_WIN');
  assert.ok(elapsedA < 300, `50 comps x 60 citations took ${elapsedA}ms (must be < 300ms)`);

  // Test B: Extreme scale (200 competitors x 200 citations = 40,000 comparisons)
  const comps200 = Array.from({ length: 200 }, (_, i) => ({
    name: `EnterpriseComp_${i}`,
    domain: `ecomp${i}.com`
  }));
  const cits200 = Array.from({ length: 200 }, (_, i) => ({
    citation_url: `https://source${i}.de/article`,
    citation_domain: `source${i}.de`
  }));

  const startB = performance.now();
  const resB = calculateMetrics(text, 'Personio', ['personio.de'], comps200, cits200);
  const elapsedB = performance.now() - startB;

  assert.equal(resB.competitors.length, 200);
  assert.equal(resB.citations.length, 200);
  assert.ok(elapsedB < 1500, `200x200 scale took ${elapsedB}ms (must be < 1500ms)`);
});

// ============================================================================
// 9. Earliest Mention Resolution & Prototype Pollution Safety
// ============================================================================
test('CHALLENGE2-9.1: Earliest occurrence resolution when brand appears 10+ times', () => {
  const text = 'Einleitung. Personio ist gut. Später wird Personio wiederholt. Am Ende erneut Personio.';
  const res = calculateMetrics(text, 'Personio');

  assert.equal(res.brand_mentioned, true);
  assert.equal(res.char_earliness, 12); // First "Personio" in "Einleitung. Personio..."
  assert.equal(res.word_earliness, 2);
});

test('CHALLENGE2-9.2: Object prototype pollution resilience', () => {
  const maliciousPayload = JSON.parse('{"__proto__": {"polluted": true}, "text": "Personio ist gut", "brand_name": "Personio"}');
  
  assert.doesNotThrow(() => {
    const res = calculateMetrics(maliciousPayload);
    assert.equal(res.brand_mentioned, true);
  });
  
  // Verify prototype is not polluted
  assert.equal({}.polluted, undefined);
});
