/**
 * Automated Unit Test Suite for Chatlytics Metric Engine & MECE Logic
 * Target Module: n8n/lib/metrics_engine.js
 * Test Runner: Node.js Built-in Runner (node --test)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Resolve metrics_engine.js relative to tests/unit/
const metricsEnginePath = path.resolve(__dirname, '../../n8n/lib/metrics_engine.js');
const {
  calculateMetrics,
  findBrandUnicode,
  findEntityInText,
  findEntityUnicode,
  normalizeGermanText,
  foldGerman,
  classifyMECE,
  evaluateGeoQuadrant,
  diagnoseGEO,
  countWords,
  countChars,
  buildGermanRegex,
  matchesDomain,
  extractDomainFromUrl
} = require(metricsEnginePath);

describe('Chatlytics Metric Engine & MECE Logic Unit Tests', () => {

  // =========================================================================
  // Suite 1: Character & Word Count Calculations
  // =========================================================================
  describe('Suite 1: Character & Word Counting Accuracy', () => {
    it('should return 0 characters and 0 words for empty string or whitespace only', () => {
      assert.strictEqual(countChars(''), 0);
      assert.strictEqual(countWords(''), 0);
      assert.strictEqual(countWords('   \n\t  \r\n  '), 0);
      assert.strictEqual(countChars(null), 0);
      assert.strictEqual(countWords(null), 0);
    });

    it('should accurately count characters and words in standard German sentence', () => {
      const text = 'Personio ist eine HR-Software.';
      assert.strictEqual(countChars(text), 30);
      assert.strictEqual(countWords(text), 4);
    });

    it('should correctly handle German compound and hyphenated words', () => {
      const text = 'B2B-SaaS-Plattform für Personalmanagement';
      assert.strictEqual(countWords(text), 3);

      const text2 = 'Enterprise-Resource-Planning und Personalabrechnungssoftware für Großunternehmen';
      assert.strictEqual(countChars(text2), 80);
      assert.strictEqual(countWords(text2), 5);
    });

    it('should collapse multiple consecutive whitespaces, tabs, and newlines', () => {
      const text = 'Erste Zeile.\n\nZweite    Zeile mit\tTabulatoren.';
      assert.strictEqual(countWords(text), 6);
    });

    it('should handle Unicode emojis and special characters without corrupting word count', () => {
      const text = 'Top Empfehlung: Chatlytics 🚀 für GEO!';
      assert.strictEqual(countWords(text), 6);
    });
  });

  // =========================================================================
  // Suite 2: Earliness Indices & Relative Position %
  // =========================================================================
  describe('Suite 2: Earliness Indices & Relative Position %', () => {
    it('should calculate 0-based char index 0 and 1-based word index 1 at text start', () => {
      const text = 'Personio bietet erstklassige HR-Lösungen für KMU.';
      const res = calculateMetrics(text, 'Personio');
      assert.strictEqual(res.brand_mentioned, true);
      assert.strictEqual(res.char_earliness, 0);
      assert.strictEqual(res.brand_earliness_char, 0);
      assert.strictEqual(res.word_earliness, 1);
      assert.strictEqual(res.brand_earliness_word, 1);
      assert.strictEqual(res.relative_position_pct, 0.0);
      assert.strictEqual(res.brand_relative_pos, 0.0);
    });

    it('should calculate accurate middle position and relative percentage', () => {
      const text = 'Für modernes Personalmanagement ist Personio sehr empfehlenswert.';
      const res = calculateMetrics(text, 'Personio');
      assert.strictEqual(res.brand_mentioned, true);
      assert.strictEqual(res.char_earliness, 36);
      assert.strictEqual(res.word_earliness, 5);
      const expectedPct = Math.round((36 / text.length) * 10000) / 100;
      assert.strictEqual(res.relative_position_pct, expectedPct);
      assert.strictEqual(res.brand_relative_pos, expectedPct);
    });

    it('should handle brand at the very end of text with valid earliness and relative pos', () => {
      const text = 'Die beste Software ist Personio';
      const res = calculateMetrics(text, 'Personio');
      assert.strictEqual(res.brand_mentioned, true);
      assert.strictEqual(res.char_earliness, 23);
      assert.strictEqual(res.word_earliness, 5);
      assert.ok(res.relative_position_pct > 0.0 && res.relative_position_pct <= 100.0);
    });

    it('should return null for earliness and relative position when brand is absent', () => {
      const text = 'Workday und SAP sind bekannte Alternativen im Markt.';
      const res = calculateMetrics(text, 'Personio');
      assert.strictEqual(res.brand_mentioned, false);
      assert.strictEqual(res.char_earliness, null);
      assert.strictEqual(res.brand_earliness_char, null);
      assert.strictEqual(res.word_earliness, null);
      assert.strictEqual(res.brand_earliness_word, null);
      assert.strictEqual(res.relative_position_pct, null);
      assert.strictEqual(res.brand_relative_pos, null);
    });

    it('should capture earliest occurrence when brand appears multiple times', () => {
      const text = 'Personio startet hier. Weiter hinten wird Personio erneut genannt.';
      const res = calculateMetrics(text, 'Personio');
      assert.strictEqual(res.char_earliness, 0);
      assert.strictEqual(res.word_earliness, 1);
    });
  });

  // =========================================================================
  // Suite 3: German Unicode Case-Folding & Transliterations
  // =========================================================================
  describe('Suite 3: German Unicode Case-Folding & Transliterations', () => {
    it('should match case-folded German umlauts (ä, ö, ü, Ä, Ö, Ü)', () => {
      const match1 = findBrandUnicode('Wir empfehlen MÜLLER MILCH für B2B.', 'Müller Milch');
      assert.strictEqual(match1.found, true);

      const match2 = findBrandUnicode('Hier kommt jägermeister zum Einsatz.', 'Jägermeister');
      assert.strictEqual(match2.found, true);

      const match3 = findBrandUnicode('LÖWE ELECTRONICS bietet Qualität.', 'Löwe Electronics');
      assert.strictEqual(match3.found, true);

      const match4 = findBrandUnicode('ötol ist bekannt.', 'Ötol');
      assert.strictEqual(match4.found, true);
    });

    it('should match uppercase sharp S (ẞ / U+1E9E) and lowercase sharp S (ß)', () => {
      const match1 = findBrandUnicode('DER GROẞHANDEL IST STARK.', 'Großhandel');
      assert.strictEqual(match1.found, true);

      const match2 = findBrandUnicode('In dieser straße finden Sie uns.', 'Straße');
      assert.strictEqual(match2.found, true);

      const match3 = findBrandUnicode('In der Straße finden Sie Angebote.', 'STRAẞE');
      assert.strictEqual(match3.found, true);
    });

    it('should match German transliterations (ae -> ä, oe -> ö, ue -> ü, ss -> ß)', () => {
      const match1 = findBrandUnicode('Kaercher Hochdruckreiniger reinigen gründlich.', 'Kärcher');
      assert.strictEqual(match1.found, true);

      const match2 = findBrandUnicode('Loewe Produkte sind hochwertig.', 'Löwe');
      assert.strictEqual(match2.found, true);

      const match3 = findBrandUnicode('Mueller Drogerie bietet Rabatte.', 'Müller');
      assert.strictEqual(match3.found, true);

      const match4 = findBrandUnicode('Grosshandel mit Tradition.', 'Großhandel');
      assert.strictEqual(match4.found, true);

      const match5 = findBrandUnicode('Produkte von schaer sind glutenfrei.', 'Schär');
      assert.strictEqual(match5.found, true);

      const match6 = findBrandUnicode('Sued-Chemie liefert Spezialchemikalien.', 'Süd-Chemie');
      assert.strictEqual(match6.found, true);

      const match7 = findBrandUnicode('Die Schlossbrauerei braut traditionell.', 'Schloßbrauerei');
      assert.strictEqual(match7.found, true);
    });

    it('should match reverse transliteration (ASCII digraph brand to umlaut in text)', () => {
      const matchRev = findBrandUnicode('Kärcher liefert Reinigungsgeräte.', 'Kaercher');
      assert.strictEqual(matchRev.found, true);

      const matchRev2 = findBrandUnicode('Müller Milch ist frisch.', 'Mueller Milch');
      assert.strictEqual(matchRev2.found, true);
    });

    it('should match NFD decomposed Unicode combining characters', () => {
      const decomposed = 'Mu\u0308ller'; // M + u + combining diaeresis
      const match = findBrandUnicode('Müller ist anwesend.', decomposed);
      assert.strictEqual(match.found, true);

      const textDecomposed = 'Mu\u0308ller ist hier.';
      const match2 = findBrandUnicode(textDecomposed, 'Müller');
      assert.strictEqual(match2.found, true);
    });

    it('should prevent index drift when earlier text contains umlauts and transliterations', () => {
      const driftText = 'Für mehr Qualität: Kaercher.';
      const driftRes = calculateMetrics(driftText, 'Kärcher');
      assert.strictEqual(driftRes.brand_mentioned, true);
      assert.strictEqual(driftRes.char_earliness, 19);
      assert.strictEqual(driftText.slice(driftRes.char_earliness, driftRes.char_earliness + 8), 'Kaercher');
    });
  });

  // =========================================================================
  // Suite 4: Strict MECE Classification States
  // =========================================================================
  describe('Suite 4: Strict MECE Classification States', () => {
    it('should classify as 1_DIRECT_WIN when brand is mentioned and competitors are absent', () => {
      const text = 'Personio ist die optimale Lösung für deutsche KMUs.';
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday', 'SAP']);
      assert.strictEqual(res.mece_category, '1_DIRECT_WIN');
      assert.strictEqual(res.brand_recommended, true);
    });

    it('should classify as 1_DIRECT_WIN when brand appears before all competitors', () => {
      const text = 'Personio ist Testsieger. Workday belegt den zweiten Platz.';
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday']);
      assert.strictEqual(res.mece_category, '1_DIRECT_WIN');
      assert.strictEqual(res.brand_recommended, true);
    });

    it('should classify as 1_DIRECT_WIN on tied position (brand starts tied with competitor)', () => {
      const text = 'Personio und Workday sind gleichwertig im Leistungsvergleich.';
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday']);
      assert.strictEqual(res.mece_category, '1_DIRECT_WIN');
      assert.strictEqual(res.brand_recommended, true);
    });

    it('should classify as 2_BRAND_HALO when competitor appears before the target brand', () => {
      const text = 'Workday ist Marktführer. Auch Personio bietet passende Module.';
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday']);
      assert.strictEqual(res.mece_category, '2_BRAND_HALO');
      assert.strictEqual(res.brand_recommended, false);
      assert.strictEqual(res.competitors[0].recommended, true);
    });

    it('should classify as 3_COMPETITOR_TAKEOVER when brand is absent but competitors appear', () => {
      const text = 'Wir empfehlen den Einsatz von Workday oder SAP SuccessFactors.';
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday', 'SAP']);
      assert.strictEqual(res.mece_category, '3_COMPETITOR_TAKEOVER');
      assert.strictEqual(res.brand_recommended, false);
      assert.strictEqual(res.competitors[0].recommended, true);
    });

    it('should classify as 3_COMPETITOR_TAKEOVER when brand has negative sentiment and competitor is present', () => {
      const text = 'Personio ist unzureichend für Konzerne. Wir empfehlen Workday.';
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], [], { brandSentiment: 'negative' });
      assert.strictEqual(res.mece_category, '3_COMPETITOR_TAKEOVER');
      assert.strictEqual(res.brand_recommended, false);
    });

    it('should classify as 4_GENERIC when neither brand nor competitors are mentioned', () => {
      const text = 'Software für Personalabteilungen sollte DSGVO-konform und intuitiv sein.';
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday', 'SAP']);
      assert.strictEqual(res.mece_category, '4_GENERIC');
      assert.strictEqual(res.brand_recommended, false);
    });

    it('should classify as 4_GENERIC when brand has negative sentiment and no competitors are present', () => {
      const text = 'Personio ist ungeeignet für Großkonzerne.';
      const res = calculateMetrics(text, 'Personio', ['personio.de'], [], [], { brandSentiment: 'negative' });
      assert.strictEqual(res.mece_category, '4_GENERIC');
      assert.strictEqual(res.brand_recommended, false);
    });
  });

  // =========================================================================
  // Suite 5: 4-Quadrant GEO Diagnostics
  // =========================================================================
  describe('Suite 5: 4-Quadrant GEO Diagnostics', () => {
    it('should detect 1_CITATION_HIJACK when brand is in text but competitor/aggregator domain is cited', () => {
      const text = 'Personio bietet ausgezeichnete Cloud-Lösungen für Personalprozesse.';
      const citations = [
        { citation_domain: 'g2.com', is_brand_domain: false }
      ];
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], citations);
      assert.strictEqual(res.geo_quadrant, '1_CITATION_HIJACK');
      assert.strictEqual(res.diagnostics.is_citation_hijack, true);
    });

    it('should detect 1_CITATION_HIJACK when brand domain is cited but competitor is recommended', () => {
      const text = 'Workday ist Marktführer für Großunternehmen.';
      const citations = [
        { citation_domain: 'personio.de', is_brand_domain: true }
      ];
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], citations);
      assert.strictEqual(res.geo_quadrant, '1_CITATION_HIJACK');
      assert.strictEqual(res.diagnostics.is_citation_hijack, true);
    });

    it('should detect 2_PARAMETRIC_BLINDSPOT when brand domain is cited but brand is omitted in text', () => {
      const text = 'Generelle Empfehlungen für HR-Systeme im Mittelstand.';
      const citations = [
        { citation_domain: 'personio.de', is_brand_domain: true }
      ];
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], citations);
      assert.strictEqual(res.geo_quadrant, '2_PARAMETRIC_BLINDSPOT');
      assert.strictEqual(res.diagnostics.is_parametric_blindspot, true);
    });

    it('should detect 2_PARAMETRIC_BLINDSPOT when competitor is recommended with zero grounding citations', () => {
      const text = 'Workday ist die klare Empfehlung für HR im Enterprise-Segment.';
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], []);
      assert.strictEqual(res.geo_quadrant, '2_PARAMETRIC_BLINDSPOT');
      assert.strictEqual(res.diagnostics.is_parametric_blindspot, true);
    });

    it('should detect 3_BRAND_HALO_TRAP when brand is trapped behind competitor in halo position', () => {
      const text = 'Workday dominiert den Markt. Personio wird als Nischenlösung erwähnt.';
      const citations = [
        { citation_domain: 'workday.com', is_brand_domain: false }
      ];
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], citations);
      assert.strictEqual(res.geo_quadrant, '3_BRAND_HALO_TRAP');
      assert.strictEqual(res.diagnostics.is_brand_halo_trap, true);
    });

    it('should detect 4_BURIED_WINNER when brand is recommended but relative position > 50%', () => {
      const padding = 'Viele verschiedene Kriterien sind im B2B-Softwaremarkt zu beachten. '.repeat(10);
      const text = padding + 'Am Ende des Vergleichs steht Personio als Option bereit.';
      const citations = [
        { citation_domain: 'personio.de', is_brand_domain: true }
      ];
      const res = calculateMetrics(text, 'Personio', ['personio.de'], [], citations);
      assert.strictEqual(res.brand_mentioned, true);
      assert.ok(res.relative_position_pct > 50.0);
      assert.strictEqual(res.geo_quadrant, '4_BURIED_WINNER');
      assert.strictEqual(res.diagnostics.is_buried_winner, true);
    });

    it('should detect 4_BURIED_WINNER when brand is recommended but word earliness > 50', () => {
      const prefix = Array(55).fill('Kontext').join(' ');
      const text = prefix + ' Personio ist der beste Anbieter.';
      const citations = [
        { citation_domain: 'personio.de', is_brand_domain: true }
      ];
      const res = calculateMetrics(text, 'Personio', ['personio.de'], [], citations);
      assert.ok(res.word_earliness > 50);
      assert.strictEqual(res.geo_quadrant, '4_BURIED_WINNER');
      assert.strictEqual(res.diagnostics.is_buried_winner, true);
    });

    it('should return NONE when brand wins cleanly early in text with brand citation', () => {
      const text = 'Personio ist die führende Lösung mit voller Empfehlung.';
      const citations = [
        { citation_domain: 'personio.de', is_brand_domain: true }
      ];
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], citations);
      assert.strictEqual(res.mece_category, '1_DIRECT_WIN');
      assert.strictEqual(res.geo_quadrant, 'NONE');
      assert.strictEqual(res.diagnostics.primary_quadrant, 'NONE');
    });
  });

  // =========================================================================
  // Suite 6: Boundary, Edge Cases & Null Safety
  // =========================================================================
  describe('Suite 6: Boundary, Edge Cases & Null Safety', () => {
    it('should handle null, undefined, or malformed text without throwing exceptions', () => {
      assert.doesNotThrow(() => calculateMetrics(null, 'Personio'));
      assert.doesNotThrow(() => calculateMetrics(undefined, 'Personio'));
      assert.doesNotThrow(() => calculateMetrics(12345, 'Personio'));
      const resNull = calculateMetrics(null, 'Personio');
      assert.strictEqual(resNull.total_chars, 0);
      assert.strictEqual(resNull.total_words, 0);
      assert.strictEqual(resNull.brand_mentioned, false);
      assert.strictEqual(resNull.char_earliness, null);
    });

    it('should handle missing brandName gracefully', () => {
      const res1 = calculateMetrics('Guter Text ohne Marke', null);
      assert.strictEqual(res1.brand_mentioned, false);
      assert.strictEqual(res1.char_earliness, null);

      const res2 = calculateMetrics('Guter Text ohne Marke', '');
      assert.strictEqual(res2.brand_mentioned, false);
      assert.strictEqual(res2.char_earliness, null);
    });

    it('should correctly handle single-word responses', () => {
      const res = calculateMetrics('Personio', 'Personio');
      assert.strictEqual(res.total_chars, 8);
      assert.strictEqual(res.total_words, 1);
      assert.strictEqual(res.char_earliness, 0);
      assert.strictEqual(res.word_earliness, 1);
      assert.strictEqual(res.relative_position_pct, 0.0);
    });

    it('should recognize brand adjacent to German punctuation and quotation marks', () => {
      const text = 'Wir empfehlen: „Personio“! (Offiziell: personio.de).';
      const res = calculateMetrics(text, 'Personio');
      assert.strictEqual(res.brand_mentioned, true);
    });

    it('should prevent false positives when brand name is a substring of an unrelated word', () => {
      const text = 'Das Passivhaus und der Transportaspekt sind wesentlich.';
      const res = calculateMetrics(text, 'SAP');
      assert.strictEqual(res.brand_mentioned, false);

      const text2 = 'SAP ist der Marktführer.';
      const res2 = calculateMetrics(text2, 'SAP');
      assert.strictEqual(res2.brand_mentioned, true);
    });

    it('should handle competitors passed as objects or strings interchangeably', () => {
      const text = 'Workday und SAP im Vergleich.';
      const resStrings = calculateMetrics(text, 'Personio', [], ['Workday', 'SAP']);
      const resObjects = calculateMetrics(text, 'Personio', [], [
        { name: 'Workday', domain: 'workday.com' },
        { name: 'SAP', domain: 'sap.com' }
      ]);
      assert.strictEqual(resStrings.mece_category, '3_COMPETITOR_TAKEOVER');
      assert.strictEqual(resObjects.mece_category, '3_COMPETITOR_TAKEOVER');
    });

    it('should support single options object invocation matching n8n payload node format', () => {
      const payload = {
        text: 'Personio ist die führende Lösung.',
        brand_name: 'Personio',
        brand_domains: ['personio.de'],
        competitors: ['Workday'],
        citations: [{ citation_domain: 'personio.de', is_brand_domain: true }]
      };
      const res = calculateMetrics(payload);
      assert.strictEqual(res.brand_mentioned, true);
      assert.strictEqual(res.mece_category, '1_DIRECT_WIN');
      assert.strictEqual(res.geo_quadrant, 'NONE');
    });
  });

  // =========================================================================
  // Suite 7: Schema Contract Conformance
  // =========================================================================
  describe('Suite 7: Schema Contract Conformance', () => {
    it('should output payload conforming to database llm_runs and api/ingest.php spec', () => {
      const text = 'Personio ist führend.';
      const citations = [{ citation_domain: 'personio.de', is_brand_domain: true }];
      const res = calculateMetrics(text, 'Personio', ['personio.de'], ['Workday'], citations);

      // Verify required fields and types
      assert.strictEqual(typeof res.brand_mentioned, 'boolean');
      assert.strictEqual(typeof res.brand_recommended, 'boolean');
      assert.strictEqual(typeof res.total_chars, 'number');
      assert.strictEqual(typeof res.character_count, 'number');
      assert.strictEqual(typeof res.total_words, 'number');
      assert.strictEqual(typeof res.word_count, 'number');
      assert.strictEqual(typeof res.char_earliness, 'number');
      assert.strictEqual(typeof res.brand_earliness_char, 'number');
      assert.strictEqual(typeof res.word_earliness, 'number');
      assert.strictEqual(typeof res.brand_earliness_word, 'number');
      assert.strictEqual(typeof res.relative_position_pct, 'number');
      assert.strictEqual(typeof res.brand_relative_pos, 'number');
      assert.strictEqual(typeof res.mece_category, 'string');
      assert.strictEqual(typeof res.geo_quadrant, 'string');
      assert.strictEqual(typeof res.brand_cited, 'boolean');
      assert.strictEqual(typeof res.brand_domain_cited, 'boolean');
      assert.strictEqual(typeof res.competitor_cited, 'boolean');
      assert.strictEqual(typeof res.has_citations, 'boolean');
      assert.ok(Array.isArray(res.competitors));
      assert.ok(Array.isArray(res.citations));

      // Verify dual aliases equality
      assert.strictEqual(res.total_chars, res.character_count);
      assert.strictEqual(res.total_words, res.word_count);
      assert.strictEqual(res.char_earliness, res.brand_earliness_char);
      assert.strictEqual(res.word_earliness, res.brand_earliness_word);
      assert.strictEqual(res.relative_position_pct, res.brand_relative_pos);
      assert.strictEqual(res.brand_domain_cited, res.brand_cited);

      // Verify MECE category validity
      const validMECE = ['1_DIRECT_WIN', '2_BRAND_HALO', '3_COMPETITOR_TAKEOVER', '4_GENERIC'];
      assert.ok(validMECE.includes(res.mece_category));

      // Verify GEO quadrant validity
      const validGEO = ['1_CITATION_HIJACK', '2_PARAMETRIC_BLINDSPOT', '3_BRAND_HALO_TRAP', '4_BURIED_WINNER', 'NONE'];
      assert.ok(validGEO.includes(res.geo_quadrant));

      // Competitor sub-object verification
      const comp = res.competitors[0];
      assert.strictEqual(typeof comp.competitor_name, 'string');
      assert.strictEqual(typeof comp.mentioned, 'boolean');
      assert.strictEqual(typeof comp.recommended, 'boolean');
      assert.strictEqual(comp.relative_position_pct, comp.relative_pos);

      // Citation sub-object verification
      const cit = res.citations[0];
      assert.strictEqual(typeof cit.citation_index, 'number');
      assert.strictEqual(typeof cit.url, 'string');
      assert.strictEqual(cit.url, cit.citation_url);
      assert.strictEqual(typeof cit.domain, 'string');
      assert.strictEqual(cit.domain, cit.citation_domain);
      assert.strictEqual(typeof cit.is_brand_domain, 'boolean');
      assert.strictEqual(typeof cit.is_competitor_domain, 'boolean');
    });
  });
});
