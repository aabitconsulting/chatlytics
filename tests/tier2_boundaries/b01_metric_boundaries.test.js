/**
 * tests/tier2_boundaries/b01_metric_boundaries.test.js
 * Tier 2: Boundary & Corner Cases — Metric Engine & MECE Logic (Features 1-4)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../helpers/reference_engine');
const { assertValidMECE, assertValidGEODiagnostic } = require('../helpers/assertions');

test('Boundary 1.1: Empty string input handling', () => {
  const m = engine.calculateMetrics('', 'Personio');
  assert.equal(m.character_count, 0);
  assert.equal(m.word_count, 0);
  assert.equal(m.brand_mentioned, 0);
  assert.equal(m.brand_earliness_char, null);
  assert.equal(m.brand_earliness_word, null);
  assert.equal(m.brand_relative_pos, null);
  assert.equal(m.mece_category, '4_GENERIC');
});

test('Boundary 1.2: Whitespace-only string input', () => {
  const m = engine.calculateMetrics('   \n\t  \r\n   ', 'Personio');
  assert.equal(m.word_count, 0);
  assert.equal(m.brand_mentioned, 0);
  assert.equal(m.mece_category, '4_GENERIC');
});

test('Boundary 1.3: Single character text input', () => {
  const m1 = engine.calculateMetrics('P', 'Personio');
  assert.equal(m1.character_count, 1);
  assert.equal(m1.word_count, 1);
  assert.equal(m1.brand_mentioned, 0);

  const m2 = engine.calculateMetrics('P', 'P');
  assert.equal(m2.brand_mentioned, 1);
  assert.equal(m2.brand_earliness_char, 0);
  assert.equal(m2.brand_earliness_word, 1);
  assert.equal(m2.brand_relative_pos, 0.00);
});

test('Boundary 1.4: Punctuation directly attached to brand name', () => {
  const text = 'Die Lösung lautet: (Personio), gefolgt von „Workday“!';
  const res = engine.findBrandUnicode(text, 'Personio');
  assert.equal(res.found, true);
  assert.equal(res.charIndex, 20);
  assert.equal(res.wordIndex, 5);

  const compRes = engine.findBrandUnicode(text, 'Workday');
  assert.equal(compRes.found, true);
});

test('Boundary 1.5: Massive text scale (120,000 characters, 18,000 words)', () => {
  const filler = 'Unternehmensberatung Software Markt Analyse Deutschland. ';
  const repeated = filler.repeat(2150); // ~120,000 chars
  const massiveText = repeated + 'Am Ende siegt Personio.';

  const start = performance.now();
  const m = engine.calculateMetrics(massiveText, 'Personio', ['personio.de'], ['Workday']);
  const duration = performance.now() - start;

  assert.ok(m.character_count > 100000);
  assert.ok(m.word_count > 10000);
  assert.equal(m.brand_mentioned, 1);
  assert.ok(m.brand_relative_pos > 95.0);
  assert.ok(duration < 500, `Calculation took ${duration}ms, expected <500ms for 100k chars`);
});

test('Boundary 1.6: Capital German sharp S (ẞ) and lowercase sharp S (ß)', () => {
  const textWithCapitalSharpS = 'GROẞE UNTERNEHMEN NUTZEN SOFTWARE.';
  const res1 = engine.findBrandUnicode(textWithCapitalSharpS, 'große');
  assert.equal(res1.found, true, 'große must match GROẞE via Unicode case-folding');

  const textWithLowerSharpS = 'große unternehmen nutzen software.';
  const res2 = engine.findBrandUnicode(textWithLowerSharpS, 'GROẞE');
  assert.equal(res2.found, true, 'GROẞE must match große');
});

test('Boundary 1.7: Multiple occurrences of brand (earliest position captured)', () => {
  const text = 'Personio ist erstens gut. Zweitens bietet Personio Support. Drittens glänzt Personio.';
  const res = engine.findBrandUnicode(text, 'Personio');
  assert.equal(res.found, true);
  assert.equal(res.charIndex, 0, 'Must record the very first occurrence');
  assert.equal(res.wordIndex, 1);
});

test('Boundary 1.8: Earliness tie between brand and competitor', () => {
  const text = 'Personio & Workday sind die zwei Hauptanbieter.';
  const m = engine.calculateMetrics(text, 'Personio', [], ['Workday']);
  assert.equal(m.brand_mentioned, 1);
  assert.equal(m.competitors[0].mentioned, 1);
  assert.equal(m.brand_earliness_char, 0);
  assert.equal(m.competitors[0].char_earliness, 11);
  assert.equal(m.mece_category, '1_DIRECT_WIN');
});

test('Boundary 1.9: Exact 50.00% boundary threshold for 4_BURIED_WINNER', () => {
  // Relative pos <= 50.0 is not buried, > 50.0 is buried
  const notBuried = engine.evaluateGEODiagnostic({
    brandInText: true,
    brandDomainCited: true,
    brandRelativePos: 50.00
  });
  assert.equal(notBuried, 'NONE');

  const buried = engine.evaluateGEODiagnostic({
    brandInText: true,
    brandDomainCited: true,
    brandRelativePos: 50.01
  });
  assert.equal(buried, '4_BURIED_WINNER');
});

test('Boundary 1.10: Subdomain and port in citation URL', () => {
  const citations = [
    { citation_domain: 'app.personio.de', citation_url: 'https://app.personio.de:8443/login?ref=test' }
  ];
  const m = engine.calculateMetrics('Personio', 'Personio', ['personio.de'], [], citations);
  assert.equal(m.brand_domain_cited, 1);
  assert.equal(m.citations[0].is_brand_domain, 1);
});

test('Boundary 1.11: Null and undefined optional parameter resiliency', () => {
  const m = engine.calculateMetrics('Personio', 'Personio', undefined, null, undefined);
  assert.equal(m.brand_mentioned, 1);
  assert.equal(m.brand_domain_cited, 0);
  assert.equal(m.competitors.length, 0);
  assert.equal(m.citations.length, 0);
});

test('Boundary 1.12: Brand name containing regex special characters', () => {
  const specialBrand = 'A.I. Solution (v2+)';
  const text = 'Die beste Lösung ist A.I. Solution (v2+) im Markt.';
  const res = engine.findBrandUnicode(text, specialBrand);
  assert.equal(res.found, true);
  assert.equal(res.charIndex, 21);
});
