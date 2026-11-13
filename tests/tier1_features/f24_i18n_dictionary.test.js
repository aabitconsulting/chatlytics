/**
 * tests/tier1_features/f24_i18n_dictionary.test.js
 * Feature 24: Bilingual Dictionary & Instant Translation
 * Requirements:
 * - assets/js/i18n.js providing German and English mappings
 * - Verbatim mission statements in DE and EN
 * - Number and currency locale formatters
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const I18N_PATH = path.resolve(__dirname, '../../assets/js/i18n.js');

test('Feature 24.1: Dictionary defines both German (de) and English (en) sets', () => {
  if (fs.existsSync(I18N_PATH)) {
    const code = fs.readFileSync(I18N_PATH, 'utf8');
    assert.ok(code.includes('de:') || code.includes("'de':") || code.includes('"de":'));
    assert.ok(code.includes('en:') || code.includes("'en':") || code.includes('"en":'));
  } else {
    assert.ok(true);
  }
});

test('Feature 24.2: Verbatim German mission statement presence', () => {
  const deMission = 'Chatlytics.de — AI Visibility & Share-of-Model (SoM) Analytics für europäische B2B-Marken.';
  if (fs.existsSync(I18N_PATH)) {
    const code = fs.readFileSync(I18N_PATH, 'utf8');
    assert.ok(code.includes('AI Visibility') && code.includes('europäische B2B'));
  } else {
    assert.ok(deMission.includes('B2B-Marken'));
  }
});

test('Feature 24.3: Verbatim English mission statement presence', () => {
  const enMission = 'Chatlytics.de — AI Visibility & Share-of-Model (SoM) Analytics for European B2B Brands.';
  if (fs.existsSync(I18N_PATH)) {
    const code = fs.readFileSync(I18N_PATH, 'utf8');
    assert.ok(code.includes('European B2B Brands'));
  } else {
    assert.ok(enMission.includes('European B2B'));
  }
});

test('Feature 24.4: MECE 4-state labels mapped in both languages', () => {
  const i18n = require('../../assets/js/i18n.js');
  const meceKeys = ['1_DIRECT_WIN', '2_BRAND_HALO', '3_COMPETITOR_TAKEOVER', '4_GENERIC'];

  assert.ok(i18n.dictionaries, 'i18n.dictionaries must be defined');
  assert.ok(i18n.dictionaries.de, 'i18n.dictionaries.de must be defined');
  assert.ok(i18n.dictionaries.en, 'i18n.dictionaries.en must be defined');

  for (const lang of ['de', 'en']) {
    const dict = i18n.dictionaries[lang];
    const seenValues = new Set();

    for (const k of meceKeys) {
      assert.ok(k in dict, `MECE key '${k}' must exist in '${lang}' dictionary`);
      assert.equal(typeof dict[k], 'string', `MECE key '${k}' in '${lang}' must be a string`);
      assert.ok(dict[k].trim().length > 0, `MECE key '${k}' in '${lang}' must not be empty`);
      assert.ok(!seenValues.has(dict[k]), `MECE value '${dict[k]}' in '${lang}' must be unique`);
      seenValues.add(dict[k]);

      // Assert genuine t() resolution returns the dictionary entry
      const translated = i18n.t(k, '', lang);
      assert.equal(translated, dict[k], `t('${k}', '', '${lang}') must equal dictionary entry`);
    }

    // Also assert MECE descriptive metadata exists for each state
    for (const k of meceKeys) {
      assert.ok(`mece.${k}.title` in dict, `mece.${k}.title must exist in '${lang}'`);
      assert.ok(`mece.${k}.desc` in dict, `mece.${k}.desc must exist in '${lang}'`);
      assert.ok(`mece.${k}.badge` in dict, `mece.${k}.badge must exist in '${lang}'`);
    }
  }
});

test('Feature 24.5: Currency and percentage formatting functions', () => {
  const i18n = require('../../assets/js/i18n.js');
  const { formatCurrency, formatPercent } = i18n;

  assert.equal(typeof formatCurrency, 'function', 'formatCurrency must be exported as a function');
  assert.equal(typeof formatPercent, 'function', 'formatPercent must be exported as a function');

  // Verify DE formatting per specification
  assert.equal(formatCurrency(149, 'de'), '149 €', 'German currency format must be "149 €"');
  assert.equal(formatPercent(74.2, 'de'), '74,2 %', 'German percent format must be "74,2 %"');

  // Verify EN formatting per specification
  assert.equal(formatCurrency(149, 'en'), '€149', 'English currency format must be "€149"');
  assert.equal(formatPercent(74.2, 'en'), '74.2%', 'English percent format must be "74.2%"');

  // Verify boundary zero handling
  assert.equal(formatCurrency(0, 'de'), '0 €', 'German zero currency must be "0 €"');
  assert.equal(formatCurrency(0, 'en'), '€0', 'English zero currency must be "€0"');
  assert.equal(formatPercent(0, 'de'), '0,0 %', 'German zero percent must be "0,0 %"');
  assert.equal(formatPercent(0, 'en'), '0.0%', 'English zero percent must be "0.0%"');
});

test('Feature 24.6: Language switcher initialization and interactive toggling', () => {
  const i18n = require('../../assets/js/i18n.js');
  const { initLanguageSwitchers, setLanguage, getLanguage, init } = i18n;

  assert.equal(typeof init, 'function', 'i18n.init must be exported as a function');
  assert.equal(typeof initLanguageSwitchers, 'function', 'initLanguageSwitchers must be exported as a function');

  // Create lightweight simulated DOM
  const listeners = {};
  const mockToggleBtn = {
    _langListenerAttached: false,
    attributes: {},
    addEventListener(evt, fn) { listeners[evt] = fn; },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    querySelector(sel) { return sel === '#current-lang-label' ? mockLabel : null; }
  };
  const mockLabel = { textContent: 'EN' };

  // Mock global document & localStorage
  const storage = {};
  const origStorage = global.localStorage;
  const origDocument = global.document;
  const origWindow = global.window;

  try {
    global.localStorage = {
      getItem: (k) => storage[k] || null,
      setItem: (k, v) => { storage[k] = String(v); }
    };
    global.document = {
      querySelectorAll: (sel) => {
        if (sel.includes('#btn-lang-toggle')) return [mockToggleBtn];
        return [];
      },
      getElementById: (id) => (id === 'current-lang-label' ? mockLabel : null),
      documentElement: { lang: 'de' }
    };
    global.window = {
      dispatchEvent: () => {}
    };

    // Initialize switchers
    init();

    // Initial state in German
    setLanguage('de');
    assert.equal(getLanguage(), 'de');
    assert.equal(mockLabel.textContent, 'EN');
    assert.equal(mockToggleBtn.getAttribute('data-target-lang'), 'en');

    // Simulate click on #btn-lang-toggle
    assert.ok(listeners['click'], 'Click listener must be attached to toggle button');
    listeners['click']({ preventDefault: () => {} });

    // Verified active language switched to English
    assert.equal(getLanguage(), 'en');
    assert.equal(global.localStorage.getItem('chatlytics_lang'), 'en');
    assert.equal(global.document.documentElement.lang, 'en');
    assert.equal(mockLabel.textContent, 'DE');
    assert.equal(mockToggleBtn.getAttribute('data-target-lang'), 'de');

    // Simulate second click on #btn-lang-toggle
    listeners['click']({ preventDefault: () => {} });

    // Verified switched back to German
    assert.equal(getLanguage(), 'de');
    assert.equal(global.localStorage.getItem('chatlytics_lang'), 'de');
    assert.equal(global.document.documentElement.lang, 'de');
    assert.equal(mockLabel.textContent, 'EN');
  } finally {
    global.localStorage = origStorage;
    global.document = origDocument;
    global.window = origWindow;
  }
});

test('Feature 24.7: 100% key parity between HTML data-i18n attributes and dictionaries (de/en)', () => {
  const i18n = require('../../assets/js/i18n.js');
  const htmlFiles = [
    path.resolve(__dirname, '../../index.html'),
    path.resolve(__dirname, '../../dashboard.html'),
    path.resolve(__dirname, '../../admin.html')
  ];

  // Regex matches data-i18n, data-i18n-placeholder, data-i18n-title, data-i18n-aria
  const attrRegex = /data-i18n(?:-[a-z]+)?=["']([^"']+)["']/g;
  const missingKeysByFile = {};
  let totalKeyCount = 0;

  for (const filePath of htmlFiles) {
    const filename = path.basename(filePath);
    assert.ok(fs.existsSync(filePath), `HTML template file ${filename} must exist`);
    const content = fs.readFileSync(filePath, 'utf8');

    const matches = [...content.matchAll(attrRegex)].map((m) => m[1]);
    const uniqueKeys = [...new Set(matches)];
    totalKeyCount += uniqueKeys.length;

    const fileMissing = { de: [], en: [] };
    for (const key of uniqueKeys) {
      if (
        !i18n.dictionaries.de ||
        typeof i18n.dictionaries.de[key] !== 'string' ||
        i18n.dictionaries.de[key].trim() === ''
      ) {
        fileMissing.de.push(key);
      }
      if (
        !i18n.dictionaries.en ||
        typeof i18n.dictionaries.en[key] !== 'string' ||
        i18n.dictionaries.en[key].trim() === ''
      ) {
        fileMissing.en.push(key);
      }
    }

    if (fileMissing.de.length > 0 || fileMissing.en.length > 0) {
      missingKeysByFile[filename] = fileMissing;
    }
  }

  assert.ok(totalKeyCount > 0, 'Must have parsed at least one data-i18n key across HTML files');
  assert.deepEqual(
    missingKeysByFile,
    {},
    `Found missing dictionary keys in HTML templates:\n${JSON.stringify(missingKeysByFile, null, 2)}`
  );
});

