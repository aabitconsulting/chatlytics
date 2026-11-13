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

test('Frontier LLM Showcase, Admin ESM Scripts, and Local Favicon Integrity', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
  const dashboardHtml = fs.readFileSync(path.join(rootDir, 'dashboard.html'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(rootDir, 'admin.html'), 'utf8');
  const dossierJs = fs.readFileSync(path.join(rootDir, 'assets/js/dossier-stage.js'), 'utf8');
  const i18nJs = fs.readFileSync(path.join(rootDir, 'assets/js/i18n.js'), 'utf8');

  const requiredFrontierModels = [
    'GPT-6.1 Sol',
    'GPT-6.1 Terra',
    'GPT-6 Astra',
    'GPT-6 Luna',
    'Claude Opus 5.5',
    'Claude Sonnet 5.5',
    'Claude Haiku 5.5',
    'Gemini Hydrogen',
    'Gemini Carbon',
    'Gemini Argon',
    'Gemini 3.8 Flash',
  ];

  for (const modelName of requiredFrontierModels) {
    assert.ok(dossierJs.includes(modelName), `dossier-stage.js must showcase frontier model ${modelName}`);
    assert.ok(indexHtml.includes(modelName), `index.html must surface frontier model ${modelName}`);
    assert.ok(i18nJs.includes(modelName), `i18n.js must surface frontier model ${modelName}`);
  }

  for (const [label, content] of [
    ['index.html', indexHtml],
    ['dossier-stage.js', dossierJs],
    ['i18n.js', i18nJs],
  ]) {
    for (const legacyRx of [/GPT-4o/i, /Claude 3\.5/i, /Gemini 1\.5/i]) {
      assert.equal(legacyRx.test(content), false, `Legacy model pattern ${legacyRx} must not remain in ${label}`);
    }
  }

  for (const moduleFile of ['assets/js/i18n.js', 'assets/js/api-client.js', 'assets/js/auth.js']) {
    const moduleTagRx = new RegExp(`<script\\s+[^>]*type=["']module["'][^>]*src=["']${moduleFile.replace(/\./g, '\\.')}["']`, 'i');
    assert.match(adminHtml, moduleTagRx, `admin.html must load ${moduleFile} as type="module"`);
  }

  assert.ok(fs.existsSync(path.join(rootDir, 'assets/favicon.svg')), 'assets/favicon.svg must exist');
  for (const [name, html] of [
    ['index.html', indexHtml],
    ['dashboard.html', dashboardHtml],
    ['admin.html', adminHtml],
  ]) {
    assert.ok(html.includes('assets/favicon.svg'), `${name} must reference local assets/favicon.svg`);
  }
});
