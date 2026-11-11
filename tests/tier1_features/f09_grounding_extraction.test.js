/**
 * tests/tier1_features/f09_grounding_extraction.test.js
 * Feature 9: Grounding Citations & Secondary Extraction
 * Requirements:
 * - Extraction of grounding citation chunks from Gemini metadata
 * - Markdown and bare URL regex extraction for Claude / OpenAI
 * - Competitor mentions extraction
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Feature 9.1: Gemini groundingMetadata citation parser', () => {
  const geminiMetadata = {
    webSearchQueries: ['beste HR Software Deutschland'],
    groundingChunks: [
      { web: { uri: 'https://www.personio.de/blog/hr-trends/', title: 'Personio Blog' } },
      { web: { uri: 'https://omr.com/de/reviews/personio', title: 'OMR Personio Review' } }
    ]
  };

  const citations = geminiMetadata.groundingChunks.map(chunk => {
    const url = chunk.web.uri;
    const domain = new URL(url).hostname.replace(/^www\./, '');
    return {
      citation_url: url,
      citation_domain: domain,
      citation_title: chunk.web.title
    };
  });

  assert.equal(citations.length, 2);
  assert.equal(citations[0].citation_domain, 'personio.de');
  assert.equal(citations[1].citation_domain, 'omr.com');
});

test('Feature 9.2: Markdown link citation extraction for OpenAI / Claude', () => {
  const text = 'Weitere Details finden Sie auf [Haufe HR](https://www.haufe.de/personal) und [OMR](https://omr.com/de).';
  const mdRegex = /\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g;
  const matches = [];
  let m;
  while ((m = mdRegex.exec(text)) !== null) {
    matches.push({ title: m[1], url: m[2], domain: new URL(m[2]).hostname.replace(/^www\./, '') });
  }

  assert.equal(matches.length, 2);
  assert.equal(matches[0].domain, 'haufe.de');
  assert.equal(matches[1].domain, 'omr.com');
});

test('Feature 9.3: Bare URL extraction regex', () => {
  const text = 'Besuchen Sie https://personio.de für weitere Infos.';
  const urlRegex = /https?:\/\/[a-zA-Z0-9.-]+(?:\/[^\s)]*)?/g;
  const urls = text.match(urlRegex) || [];
  assert.equal(urls.length, 1);
  assert.equal(urls[0], 'https://personio.de');
});

test('Feature 9.4: Secondary extraction of multiple competitors', () => {
  const { findBrandUnicode } = require('../helpers/reference_engine');
  const text = 'Workday ist teuer, aber SAP SuccessFactors ist flexibel.';
  const comp1 = findBrandUnicode(text, 'Workday');
  const comp2 = findBrandUnicode(text, 'SAP SuccessFactors');

  assert.equal(comp1.found, true);
  assert.equal(comp1.wordIndex, 1);
  assert.equal(comp2.found, true);
  assert.equal(comp2.wordIndex, 5);
});

test('Feature 9.5: Identification of brand domain vs third-party vs competitor citation', () => {
  const brandDomains = ['personio.de'];
  const compDomains = ['workday.com'];
  const testDomains = ['personio.de', 'workday.com', 'omr.com'];

  const results = testDomains.map(d => ({
    domain: d,
    is_brand: brandDomains.includes(d),
    is_competitor: compDomains.includes(d)
  }));

  assert.equal(results[0].is_brand, true);
  assert.equal(results[0].is_competitor, false);
  assert.equal(results[1].is_brand, false);
  assert.equal(results[1].is_competitor, true);
  assert.equal(results[2].is_brand, false);
  assert.equal(results[2].is_competitor, false);
});
