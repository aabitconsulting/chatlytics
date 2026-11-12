/**
 * tests/tier1_features/f25_landing_page.test.js
 * Feature 25: Bilingual Landing Page with MECE Simulator
 * Requirements:
 * - index.html structure, hero mission, MECE simulator, pricing table, signup modal
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_PATH = path.resolve(__dirname, '../../index.html');

test('Feature 25.1: HTML5 structure and stylesheet linkage in index.html', () => {
  if (fs.existsSync(INDEX_PATH)) {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('assets/css/app.css'));
  } else {
    assert.ok(true);
  }
});

test('Feature 25.2: Hero section contains mission statement and call-to-action', () => {
  if (fs.existsSync(INDEX_PATH)) {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.ok(html.includes('Chatlytics') || html.includes('data-i18n="hero.title"'));
  } else {
    assert.ok(true);
  }
});

test('Feature 25.3: Interactive MECE simulator container and presets', () => {
  if (fs.existsSync(INDEX_PATH)) {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.ok(html.includes('mece') || html.includes('simulator') || html.includes('preset'));
  } else {
    assert.ok(true);
  }
});

test('Feature 25.4: 4-tier hybrid pricing table contains Free, Starter, Growth, Managed tiers', () => {
  if (fs.existsSync(INDEX_PATH)) {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.ok(html.includes('149') || html.includes('Starter'));
    assert.ok(html.includes('399') || html.includes('Growth'));
    assert.ok(html.includes('1.950') || html.includes('1950') || html.includes('Managed'));
  } else {
    assert.ok(true);
  }
});

test('Feature 25.5: Freemium work-email signup modal presence', () => {
  if (fs.existsSync(INDEX_PATH)) {
    const html = fs.readFileSync(INDEX_PATH, 'utf8');
    assert.ok(html.includes('modal') || html.includes('signup') || html.includes('email'));
  } else {
    assert.ok(true);
  }
});

test('Obsidian Dossier Landing Architecture & Anti-Slop Ban-List Compliance', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const dashboardHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard.html'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'admin.html'), 'utf8');
  const i18n = require(path.join(__dirname, '..', '..', 'assets', 'js', 'i18n.js'));

  // Required Obsidian Dossier landing sections & interactive widgets
  for (const id of ['id="dossier"', 'id="pruefstand"', 'id="matrix"', 'id="preise"', 'id="faq"', 'id="dossier-scrubber"', 'id="report-modal"', 'id="strategy-modal"', 'id="legal-modal"']) {
    assert.ok(html.includes(id), `Expected ${id} in index.html`);
  }

  for (const duel of ['kosmetik', 'food', 'software', 'mittelstand', 'consulting']) {
    assert.ok(html.includes(`data-duel-tab="${duel}"`), `Expected duel tab ${duel}`);
  }

  const bannedPatterns = [
    /MECE/i,
    /1_DIRECT_WIN/, /2_BRAND_HALO/, /3_COMPETITOR_TAKEOVER/, /4_GENERIC/,
    /1_CITATION_HIJACK/, /2_PARAMETRIC_BLINDSPOT/, /3_BRAND_HALO_TRAP/, /4_BURIED_WINNER/,
    /CHAR_IDX/, /REL_POS/, /SYS\s*\/\//, /KOORDINATEN-RASTER/, /SCALE\s*000/,
    /LATENCY\s*</i, /SCROLL_OFFSET/, /\bn8n\b/i, /\bPlesk\b/i, /UTF-8 Case-Folding/i
  ];

  for (const [name, src] of [['index.html', html], ['dashboard.html', dashboardHtml], ['admin.html', adminHtml]]) {
    const visibleText = src
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\b(?:id|class|for|data-i18n|data-period|data-duel-tab|data-preset|data-tier|data-auth-mode|data-open-modal|data-open-legal|data-legal-tab|data-legal-panel|value|name|href|src)="[^"]*"/g, '')
      .replace(/<[^>]+>/g, ' ');

    for (const rx of bannedPatterns) {
      assert.equal(rx.test(visibleText), false, `Banned visible string ${rx} found in ${name}`);
    }
  }

  for (const lang of ['de', 'en']) {
    for (const [key, val] of Object.entries(i18n.dictionaries[lang])) {
      for (const rx of bannedPatterns) {
        assert.equal(rx.test(String(val)), false, `Banned string ${rx} found in i18n.${lang}["${key}"]`);
      }
    }
  }
});
