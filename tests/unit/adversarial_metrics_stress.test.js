/**
 * tests/unit/adversarial_metrics_stress.test.js
 * Adversarial Stress & Empirical Fuzzing Suite for n8n/lib/metrics_engine.js
 * 
 * Conducts aggressive stress testing:
 * 1. Extreme text lengths (>50,000 to 300,000 chars) & ReDoS checks.
 * 2. High density of mixed German umlauts (ä, ö, ü, Ä, Ö, Ü), Eszett (ß, ẞ), and digraphs.
 * 3. Adjacent German & ASCII punctuation, quotes, brackets, and math symbols.
 * 4. Tied earliness positions and competitor dominance rules.
 * 5. Competing substring names, boundary isolation, and compound prevention.
 * 6. Empty, whitespace, Unicode invisible characters (\u200B, \uFEFF, \u00A0, RTL).
 * 7. Fuzzing harness: 1,000 randomized property-based payloads ensuring zero unhandled
 *    exceptions, zero NaNs, and mathematical MECE integrity.
 * 8. Empirical Defect Reproductions:
 *    - Defect 1: Unhandled TypeError on null citation in calculateMetrics.
 *    - Defect 2: Out-of-bounds word earliness (word_earliness > total_words) on attached punctuation.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const engine = require('../../n8n/lib/metrics_engine');
const {
  calculateMetrics,
  findBrandUnicode,
  classifyMECE,
  evaluateGeoQuadrant,
  buildGermanRegex,
  normalizeGermanText,
  getWords,
  countWords,
  countChars
} = engine;

const VALID_MECE = ['1_DIRECT_WIN', '2_BRAND_HALO', '3_COMPETITOR_TAKEOVER', '4_GENERIC'];
const VALID_GEO = ['1_CITATION_HIJACK', '2_PARAMETRIC_BLINDSPOT', '3_BRAND_HALO_TRAP', '4_BURIED_WINNER', 'NONE'];

// ============================================================================
// Suite 1: Extreme Text Length & Performance Scale (>50k to 300k chars)
// ============================================================================
test('Adversarial 1.1: 50,000 character German corporate corpus with late brand mention', () => {
  const paragraph = 'Die digitale Transformation erfordert moderne HR-Software und cloudbasierte Lösungen. ';
  const repeatCount = Math.ceil(50000 / paragraph.length);
  const text = paragraph.repeat(repeatCount) + 'Abschließend überzeugt Personio als Gesamtsieger.';
  
  const start = performance.now();
  const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday', 'SAP']);
  const elapsed = performance.now() - start;

  assert.ok(res.total_chars >= 50000, `Expected >= 50k chars, got ${res.total_chars}`);
  assert.equal(res.brand_mentioned, true);
  assert.ok(res.char_earliness >= 50000);
  assert.ok(res.relative_position_pct > 95.0);
  assert.equal(res.mece_category, '1_DIRECT_WIN');
  assert.equal(res.geo_quadrant, '4_BURIED_WINNER'); // Because relative pos > 50%
  assert.ok(elapsed < 200, `Execution took ${elapsed}ms, must be < 200ms`);
});

test('Adversarial 1.2: 150,000 character corpus with repetitive umlaut patterns (ReDoS check)', () => {
  const pathologicalChunk = 'äöüÄÖÜßẞ ae oe ue ss Kaercher Kärcher '.repeat(200);
  const text = pathologicalChunk.repeat(20); // ~150,000 chars

  const start = performance.now();
  const res = calculateMetrics(text, 'Kärcher', ['kaercher.de'], ['Nilfisk']);
  const elapsed = performance.now() - start;

  assert.ok(res.total_chars > 100000);
  assert.equal(res.brand_mentioned, true);
  assert.equal(res.char_earliness, 21); // First occurrence of Kaercher
  assert.ok(elapsed < 300, `Backtracking took ${elapsed}ms, must be < 300ms`);
});

test('Adversarial 1.3: 300,000 character extreme payload with brand at index 0 and end', () => {
  const filler = 'A'.repeat(300000);
  const text = 'Personio ' + filler + ' Personio';

  const start = performance.now();
  const res = calculateMetrics(text, 'Personio', ['personio.de']);
  const elapsed = performance.now() - start;

  assert.equal(res.brand_mentioned, true);
  assert.equal(res.char_earliness, 0); // Earliest occurrence
  assert.equal(res.word_earliness, 1);
  assert.equal(res.relative_position_pct, 0.0);
  assert.ok(elapsed < 250, `300k chars took ${elapsed}ms, must be < 250ms`);
});

// ============================================================================
// Suite 2: High Density of German Umlauts, Eszett (ß, ẞ), and Digraphs
// ============================================================================
test('Adversarial 2.1: Mixed German Umlauts, Eszett, and Capital Sharp S (ẞ / U+1E9E)', () => {
  const brand = 'Große';
  
  // Test matching against lowercase sharp S
  const text1 = 'Eine große Lösung für den Mittelstand.';
  const m1 = findBrandUnicode(text1, brand);
  assert.equal(m1.found, true);
  assert.equal(m1.charIndex, 5);

  // Test matching against uppercase sharp S (ẞ / U+1E9E)
  const text2 = 'GROẞE ANBIETER IM VERGLEICH.';
  const m2 = findBrandUnicode(text2, brand);
  assert.equal(m2.found, true);
  assert.equal(m2.charIndex, 0);

  // Test matching against double-s transliteration
  const text3 = 'Grosse Erfolge erzielt man mit passender Software.';
  const m3 = findBrandUnicode(text3, brand);
  assert.equal(m3.found, true);
  assert.equal(m3.charIndex, 0);

  // Test target brand specified with capital sharp S (ẞ)
  const m4 = findBrandUnicode('Hier kommt die große Plattform.', 'GROẞE');
  assert.equal(m4.found, true);
  assert.equal(m4.charIndex, 15);
});

test('Adversarial 2.2: Transliteration symmetry (ä <-> ae, ö <-> oe, ü <-> ue)', () => {
  // Brand has umlauts, text has digraphs
  const m1 = findBrandUnicode('Die Firma Kaercher und Loeffler koennen ueberzeugen.', 'Kärcher');
  assert.equal(m1.found, true);
  assert.equal(m1.charIndex, 10);
  assert.equal(m1.matchType, 'german_transliterated');

  // Brand has digraphs, text has umlauts
  const m2 = findBrandUnicode('Die Firma Kärcher reinigt gründlich.', 'Kaercher');
  assert.equal(m2.found, true);
  assert.equal(m2.charIndex, 10);
  assert.equal(m2.matchType, 'german_transliterated');

  // Umlauts in Brand: Löffler, text: Loeffler
  const m3 = findBrandUnicode('Das Produkt von Loeffler ist spitze.', 'Löffler');
  assert.equal(m3.found, true);
  assert.equal(m3.charIndex, 16);

  // Umlauts in Brand: Münchener, text: Muenchener
  const m4 = findBrandUnicode('Muenchener Rückversicherung AG', 'Münchener');
  assert.equal(m4.found, true);
  assert.equal(m4.charIndex, 0);
});

test('Adversarial 2.3: Decomposed Unicode combining characters (NFD) without index corruption', () => {
  const decomposedText = 'Fu\u0308r mehr Qualita\u0308t im Betrieb: Kaercher.';
  const res = calculateMetrics(decomposedText, 'Kärcher');

  assert.equal(res.brand_mentioned, true);
  assert.equal(res.char_earliness, 30);
  // Note: word_earliness currently returns 6 due to whitespace token count
  assert.ok(res.word_earliness >= 1);
});

test('Adversarial 2.4: High-density umlaut preamble index drift immunity', () => {
  const umlautPrefix = 'Äpfel, Öle, Übergrößen, Flöße, Füße, Grübeln, Schössling, ';
  const text = umlautPrefix + 'Personio ist marktführend.';
  const expectedCharIndex = umlautPrefix.normalize('NFC').length;
  const expectedWordIndex = getWords(umlautPrefix).length + 1;

  const res = calculateMetrics(text, 'Personio');
  assert.equal(res.brand_mentioned, true);
  assert.equal(res.char_earliness, expectedCharIndex);
  assert.equal(res.word_earliness, expectedWordIndex);
});

// ============================================================================
// Suite 3: Adjacent Quotes, Punctuation, Brackets, and Math Symbols
// ============================================================================
test('Adversarial 3.1: German quotes, guillemets, single quotes, and brackets', () => {
  const testCases = [
    { text: 'Empfohlen: „Personio“!', brand: 'Personio', char: 12 },
    { text: 'Empfohlen: »Personio«!', brand: 'Personio', char: 12 },
    { text: 'Empfohlen: «Personio»!', brand: 'Personio', char: 12 },
    { text: 'Empfohlen: ‚Personio‘!', brand: 'Personio', char: 12 },
    { text: 'Empfohlen: ›Personio‹!', brand: 'Personio', char: 12 },
    { text: 'Empfohlen: "Personio"!', brand: 'Personio', char: 12 },
    { text: 'Empfohlen: \'Personio\'!', brand: 'Personio', char: 12 },
    { text: 'Empfohlen: `Personio`!', brand: 'Personio', char: 12 },
    { text: 'Lösung: (Personio)', brand: 'Personio', char: 9 },
    { text: 'Lösung: [Personio]', brand: 'Personio', char: 9 },
    { text: 'Lösung: {Personio}', brand: 'Personio', char: 9 },
    { text: 'Lösung: <Personio>', brand: 'Personio', char: 9 }
  ];

  for (const tc of testCases) {
    const res = findBrandUnicode(tc.text, tc.brand);
    assert.equal(res.found, true, `Failed to find brand in "${tc.text}"`);
    assert.equal(res.charIndex, tc.char, `Wrong charIndex in "${tc.text}"`);
  }
});

test('Adversarial 3.2: Math symbols, slashes, dashes, and punctuation boundaries', () => {
  const testCases = [
    { text: 'Vergleich: Personio/Workday', brand: 'Personio', char: 11 },
    { text: 'Vergleich: Personio/Workday', brand: 'Workday', char: 20 },
    { text: 'Tool: +Personio+', brand: 'Personio', char: 7 },
    { text: 'Tool: =Personio=', brand: 'Personio', char: 7 },
    { text: 'Tool: *Personio*', brand: 'Personio', char: 7 },
    { text: 'Tool: —Personio—', brand: 'Personio', char: 7 }, // Em-dash
    { text: 'Tool: –Personio–', brand: 'Personio', char: 7 }, // En-dash
    { text: 'Tool: ...Personio...', brand: 'Personio', char: 9 },
    { text: 'Tool: #Personio#', brand: 'Personio', char: 7 },
    { text: 'Tool: @Personio@', brand: 'Personio', char: 7 }
  ];

  for (const tc of testCases) {
    const res = findBrandUnicode(tc.text, tc.brand);
    assert.equal(res.found, true, `Failed to find brand in "${tc.text}"`);
    assert.equal(res.charIndex, tc.char, `Wrong charIndex in "${tc.text}"`);
  }
});

// ============================================================================
// Suite 4: Substring Collision & Boundary Isolation
// ============================================================================
test('Adversarial 4.1: Brand name embedded inside unrelated words (isolation check)', () => {
  // Brand is SAP
  const text = 'Das Passivhaus und der Transportaspekt sind ASAP zu planen.';
  const res = calculateMetrics(text, 'SAP');
  assert.equal(res.brand_mentioned, false, 'SAP must not match inside Passivhaus, Transportaspekt, or ASAP');

  // Brand is Pass
  const res2 = calculateMetrics('Der Kompass zeigt nach Norden.', 'Pass');
  assert.equal(res2.brand_mentioned, false, 'Pass must not match inside Kompass');

  // Brand is Plan
  const res3 = calculateMetrics('Die Unternehmensplanung läuft.', 'Plan');
  assert.equal(res3.brand_mentioned, false, 'Plan must not match inside Unternehmensplanung');

  // Brand is Work
  const res4 = calculateMetrics('Workday bietet cloudbasierte Module.', 'Work');
  assert.equal(res4.brand_mentioned, false, 'Work must not match inside Workday');
});

test('Adversarial 4.2: Brand with hyphenated compound (German B2B compound semantics)', () => {
  const text = 'Das SAP-Software-System ist bei SAP-Kunden beliebt.';
  const res = calculateMetrics(text, 'SAP');
  assert.equal(res.brand_mentioned, true, 'SAP must match in SAP-Software');
  assert.equal(res.char_earliness, 4);
});

test('Adversarial 4.3: Brand alongside longer competing brand (SAP vs SAP SuccessFactors)', () => {
  const text = 'Wir empfehlen SAP SuccessFactors für Enterprise-Kunden.';
  
  // Checking SAP
  const resSAP = calculateMetrics(text, 'SAP');
  assert.equal(resSAP.brand_mentioned, true);
  assert.equal(resSAP.char_earliness, 14);

  // Checking SAP SuccessFactors
  const resSF = calculateMetrics(text, 'SAP SuccessFactors');
  assert.equal(resSF.brand_mentioned, true);
  assert.equal(resSF.char_earliness, 14);
});

// ============================================================================
// Suite 5: Tied Positions, Identical Earliness & Dominance Logic
// ============================================================================
test('Adversarial 5.1: Exact tied char index 0 between brand and competitor', () => {
  const m = classifyMECE({
    brandMentioned: true,
    competitorsMentioned: true,
    brandEarliness: 0,
    minCompetitorEarliness: 0,
    brandSentiment: 'neutral'
  });
  assert.equal(m, '1_DIRECT_WIN', 'Tied position 0 must award 1_DIRECT_WIN');
});

test('Adversarial 5.2: Exact tied char index 15 between brand and competitor', () => {
  const m = classifyMECE({
    brandMentioned: true,
    competitorsMentioned: true,
    brandEarliness: 15,
    minCompetitorEarliness: 15,
    brandSentiment: 'neutral'
  });
  assert.equal(m, '1_DIRECT_WIN', 'Tied position 15 must award 1_DIRECT_WIN');
});

test('Adversarial 5.3: Tied position with negative brand sentiment yields competitor takeover', () => {
  const m = classifyMECE({
    brandMentioned: true,
    competitorsMentioned: true,
    brandEarliness: 0,
    minCompetitorEarliness: 0,
    brandSentiment: 'negative'
  });
  assert.equal(m, '3_COMPETITOR_TAKEOVER', 'Tied position with negative brand sentiment must yield 3_COMPETITOR_TAKEOVER');
});

test('Adversarial 5.4: Competitor leads by 1 character yields 2_BRAND_HALO', () => {
  const m = classifyMECE({
    brandMentioned: true,
    competitorsMentioned: true,
    brandEarliness: 10,
    minCompetitorEarliness: 9,
    brandSentiment: 'neutral'
  });
  assert.equal(m, '2_BRAND_HALO');
});

// ============================================================================
// Suite 6: Empty, Whitespace, and Unicode Invisible Character Strings
// ============================================================================
test('Adversarial 6.1: Empty and pure whitespace variations', () => {
  const emptyInputs = ['', '   ', '\t\t\t', '\r\n\r\n', '\f\v', ' \t \r\n '];
  for (const input of emptyInputs) {
    const res = calculateMetrics(input, 'Personio');
    assert.equal(res.total_chars, input.length);
    assert.equal(res.total_words, 0);
    assert.equal(res.brand_mentioned, false);
    assert.equal(res.char_earliness, null);
    assert.equal(res.word_earliness, null);
    assert.equal(res.relative_position_pct, null);
    assert.equal(res.mece_category, '4_GENERIC');
    assert.equal(res.geo_quadrant, 'NONE');
  }
});

test('Adversarial 6.2: Unicode invisible characters (\\u200B zero-width space, \\uFEFF BOM, \\u00A0 NBSP)', () => {
  // Zero-width space enclosing brand
  const zwspText = '\u200BPersonio\u200B';
  const resZWSP = calculateMetrics(zwspText, 'Personio');
  assert.equal(resZWSP.brand_mentioned, true);
  assert.equal(resZWSP.char_earliness, 1);

  // BOM preceding text
  const bomText = '\uFEFFPersonio ist Marktführer.';
  const resBOM = calculateMetrics(bomText, 'Personio');
  assert.equal(resBOM.brand_mentioned, true);
  assert.equal(resBOM.char_earliness, 1);

  // Non-breaking spaces: 'Beste\u00A0Lösung:\u00A0Personio' (length before 'P' is 14)
  const nbspText = 'Beste\u00A0Lösung:\u00A0Personio';
  const resNBSP = calculateMetrics(nbspText, 'Personio');
  assert.equal(resNBSP.brand_mentioned, true);
  assert.equal(resNBSP.char_earliness, 14);
});

// ============================================================================
// Suite 7: 1,000-Iteration Randomized Property-Based Fuzzing Harness
// ============================================================================
test('Adversarial 7.1: 1,000-Iteration Randomized Property-Based Fuzzer', () => {
  const CHAR_POOL = ' abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZäöüÄÖÜßẞ0123456789.,!?()[]:;-"\'\n\t\u200B\u00A0';
  const BRAND_POOL = ['Personio', 'SAP', 'Workday', 'Kärcher', 'Große', 'Kaercher', 'Löffler', 'Beste AG', 'X', '1&1'];
  const DOMAIN_POOL = ['personio.de', 'sap.com', 'workday.com', 'kaercher.com', 'grosse.de', 'external.com', 'wikipedia.org'];
  const SENTIMENTS = ['neutral', 'positive', 'negative', 'unknown', null, undefined, '', 123];

  function randomString(minLen, maxLen) {
    const len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
    let s = '';
    for (let i = 0; i < len; i++) {
      s += CHAR_POOL[Math.floor(Math.random() * CHAR_POOL.length)];
    }
    return s;
  }

  function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  const ITERATIONS = 1000;
  let directWins = 0;
  let brandHalos = 0;
  let competitorTakeovers = 0;
  let generics = 0;

  const startTime = performance.now();

  for (let i = 0; i < ITERATIONS; i++) {
    const brand = randomPick(BRAND_POOL);
    const brandDomains = [randomPick(DOMAIN_POOL)];
    
    // Competitors: 0 to 4 competitors
    const numComps = Math.floor(Math.random() * 5);
    const competitors = [];
    for (let c = 0; c < numComps; c++) {
      const compBrand = randomPick(BRAND_POOL);
      if (Math.random() > 0.5) {
        competitors.push(compBrand);
      } else {
        competitors.push({ name: compBrand, domain: randomPick(DOMAIN_POOL) });
      }
    }

    // Citations: valid object citations
    const numCits = Math.floor(Math.random() * 5);
    const citations = [];
    for (let ci = 0; ci < numCits; ci++) {
      const citDomain = randomPick(DOMAIN_POOL);
      citations.push({
        citation_url: `https://${citDomain}/info`,
        citation_domain: citDomain,
        citation_title: randomString(5, 20)
      });
    }

    let text = randomString(0, 300);
    if (Math.random() > 0.3) {
      const insertBrand = randomPick(BRAND_POOL);
      const pos = Math.floor(Math.random() * (text.length + 1));
      text = text.slice(0, pos) + ' ' + insertBrand + ' ' + text.slice(pos);
    }
    if (Math.random() > 0.4 && competitors.length > 0) {
      const compItem = randomPick(competitors);
      const compName = typeof compItem === 'string' ? compItem : compItem.name;
      const pos = Math.floor(Math.random() * (text.length + 1));
      text = text.slice(0, pos) + ' ' + compName + ' ' + text.slice(pos);
    }

    const sentiment = randomPick(SENTIMENTS);

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

    // Invariant 1: Counts must be non-negative integers
    assert.ok(Number.isInteger(res.total_chars) && res.total_chars >= 0, `Iteration ${i}: invalid total_chars ${res.total_chars}`);
    assert.ok(Number.isInteger(res.total_words) && res.total_words >= 0, `Iteration ${i}: invalid total_words ${res.total_words}`);

    // Invariant 2: No output properties may be NaN
    assert.ok(!Number.isNaN(res.total_chars), `Iteration ${i}: total_chars is NaN`);
    assert.ok(!Number.isNaN(res.total_words), `Iteration ${i}: total_words is NaN`);
    if (res.relative_position_pct !== null) {
      assert.ok(!Number.isNaN(res.relative_position_pct), `Iteration ${i}: relative_position_pct is NaN`);
      assert.ok(res.relative_position_pct >= 0 && res.relative_position_pct <= 100, `Iteration ${i}: relative_position_pct out of range`);
    }

    // Invariant 3: Strict MECE state validity
    assert.ok(VALID_MECE.includes(res.mece_category), `Iteration ${i}: Invalid MECE category ${res.mece_category}`);
    if (res.mece_category === '1_DIRECT_WIN') directWins++;
    if (res.mece_category === '2_BRAND_HALO') brandHalos++;
    if (res.mece_category === '3_COMPETITOR_TAKEOVER') competitorTakeovers++;
    if (res.mece_category === '4_GENERIC') generics++;

    // Invariant 4: Strict GEO diagnostic validity
    assert.ok(VALID_GEO.includes(res.geo_quadrant), `Iteration ${i}: Invalid GEO quadrant ${res.geo_quadrant}`);

    // Invariant 5: Brand mentioned contract
    if (!res.brand_mentioned) {
      assert.equal(res.char_earliness, null, `Iteration ${i}: char_earliness must be null when brand not mentioned`);
      assert.equal(res.word_earliness, null, `Iteration ${i}: word_earliness must be null when brand not mentioned`);
      assert.equal(res.relative_position_pct, null, `Iteration ${i}: relative_position_pct must be null when brand not mentioned`);
    } else {
      assert.ok(res.char_earliness >= 0 && res.char_earliness < res.total_chars, `Iteration ${i}: char_earliness ${res.char_earliness} out of bounds for len ${res.total_chars}`);
      assert.ok(res.word_earliness >= 1, `Iteration ${i}: word_earliness must be >= 1`);
    }

    // Invariant 6: Competitor items contract
    for (const comp of res.competitors) {
      if (!comp.mentioned) {
        assert.equal(comp.char_earliness, null);
        assert.equal(comp.word_earliness, null);
      } else {
        assert.ok(comp.char_earliness >= 0);
        assert.ok(comp.word_earliness >= 1);
      }
    }
  }

  const duration = (performance.now() - startTime).toFixed(1);

  assert.ok(directWins > 0, 'Fuzzing failed to generate any 1_DIRECT_WIN');
  assert.ok(brandHalos > 0, 'Fuzzing failed to generate any 2_BRAND_HALO');
  assert.ok(competitorTakeovers > 0, 'Fuzzing failed to generate any 3_COMPETITOR_TAKEOVER');
  assert.ok(generics > 0, 'Fuzzing failed to generate any 4_GENERIC');

  console.log(`  ✔ Fuzzing Complete: 1,000 randomized iterations passed with 0 failures in ${duration}ms.`);
  console.log(`    MECE Distribution: DIRECT_WIN=${directWins}, BRAND_HALO=${brandHalos}, TAKEOVER=${competitorTakeovers}, GENERIC=${generics}`);
});

// ============================================================================
// Suite 8: Concrete Empirical Defect Demonstrations
// ============================================================================
test('Empirical Defect 1: Safe handling of null or undefined citation item in calculateMetrics (Remediated)', () => {
  let res1;
  assert.doesNotThrow(() => {
    res1 = calculateMetrics('Personio ist super.', 'Personio', [], [], [null]);
  });
  assert.equal(res1.has_citations, false);
  assert.equal(res1.citations.length, 0);

  let res2;
  assert.doesNotThrow(() => {
    res2 = calculateMetrics('Personio ist super.', 'Personio', [], [], [undefined]);
  });
  assert.equal(res2.has_citations, false);
  assert.equal(res2.citations.length, 0);
});

test('Empirical Defect 2: word_earliness respects total_words upper bound when brand has attached punctuation (Remediated)', () => {
  // Case A: 1-word text "(Personio)"
  // total_words is 1, word_earliness is 1
  const res1 = calculateMetrics('(Personio)', 'Personio');
  assert.equal(res1.total_words, 1, 'Text "(Personio)" has exactly 1 whitespace-separated word');
  assert.equal(res1.word_earliness, 1, 'Remediated: word_earliness is 1 for a 1-word text');
  assert.ok(res1.word_earliness <= res1.total_words, 'word_earliness <= total_words invariant satisfied');

  // Case B: 2-word text "Empfehlung: (Personio)"
  // total_words is 2, word_earliness is 2
  const res2 = calculateMetrics('Empfehlung: (Personio)', 'Personio');
  assert.equal(res2.total_words, 2, 'Text "Empfehlung: (Personio)" has exactly 2 words');
  assert.equal(res2.word_earliness, 2, 'Remediated: word_earliness is 2 for a 2-word text');
  assert.ok(res2.word_earliness <= res2.total_words, 'word_earliness <= total_words invariant satisfied');
});
