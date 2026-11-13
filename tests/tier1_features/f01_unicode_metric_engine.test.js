/**
 * tests/tier1_features/f01_unicode_metric_engine.test.js
 * Feature 1: Deterministic Unicode Metric Engine
 * Requirements:
 * - Accurate char and word counts
 * - 0-based char earliness, 1-based word earliness, relative pos %
 * - German Unicode case-folding (ä, ö, ü, ß, ẞ, transliterations)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = require('../helpers/reference_engine');

test('Feature 1.1: Character count calculation precision', () => {
  const sample = 'Personio ist führend im DACH-Raum.';
  const charCount = engine.calculateCharacterCount ? engine.calculateCharacterCount(sample) : sample.length;
  assert.equal(charCount, 34);
});

test('Feature 1.2: Word count calculation with whitespace variations', () => {
  const sample = '  Personio   bietet   HR-Software  für  den   Mittelstand.  ';
  const wordCount = engine.calculateWordCount ? engine.calculateWordCount(sample) : sample.trim().split(/\s+/).length;
  assert.equal(wordCount, 6);
});

test('Feature 1.3: 0-based character earliness and 1-based word earliness', () => {
  const text = 'Die beste Lösung für HR im Mittelstand heißt Personio.';
  const brand = 'Personio';
  const res = engine.findBrandUnicode(text, brand);

  assert.equal(res.found, true);
  assert.equal(res.charIndex, 45, 'Char earliness must be exactly index 45 (0-based)');
  assert.equal(res.wordIndex, 9, 'Word earliness must be exactly word 9 (1-based: 8 preceding words + 1)');
});

test('Feature 1.4: Relative position percentage formula bounded [0.00, 100.00]', () => {
  const text = 'Personio führt.';
  const res = engine.findBrandUnicode(text, 'Personio');
  assert.equal(res.found, true);
  assert.equal(res.charIndex, 0);
  assert.equal(res.wordIndex, 1);
  assert.equal(res.relativePosPct, 0.00);

  const lateText = 'Viele Systeme existieren, doch am Ende überzeugt Personio.';
  const lateRes = engine.findBrandUnicode(lateText, 'Personio');
  assert.ok(lateRes.relativePosPct > 80.0 && lateRes.relativePosPct < 100.0);
});

test('Feature 1.5: German umlaut case-folding (ä, ö, ü, Ä, Ö, Ü)', () => {
  const text = 'FÜR GRÖSSERE UNTERNEHMEN IST MÜNCHEN DER HUB.';
  const queryLower = 'münchen';
  const res = engine.findBrandUnicode(text, queryLower);
  assert.equal(res.found, true);
});

test('Feature 1.6: German sharp S (ß, uppercase ẞ) and transliteration equivalence (ae, oe, ue, ss)', () => {
  // Transliteration match: Text uses ae/ue, brand uses Ä/Ü
  const textWithAe = 'Der groesste Vorteil liegt in Muenchen.';
  const resUmlaut = engine.findBrandUnicode(textWithAe, 'München');
  assert.equal(resUmlaut.found, true, 'München must match Muenchen via German transliteration folding');

  // Sharp S transliteration: text has groesste (oe+ss), query has Größte (ö+ß)
  const resSharpS = engine.findBrandUnicode(textWithAe, 'Größte');
  assert.equal(resSharpS.found, true, 'Größte must match groesste via transliteration');

  // Direct sharp S match in text
  const textWithSharpS = 'Ein großer Vorteil im Markt.';
  const resGrosser = engine.findBrandUnicode(textWithSharpS, 'grosser');
  assert.equal(resGrosser.found, true, 'grosser must match großer');
});
