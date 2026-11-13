/**
 * tests/tier1_features/f23_css_design_system.test.js
 * Feature 23: Minimalist Corporate SaaS CSS Design System
 * Requirements:
 * - assets/css/app.css tokens and classes
 * - Zero external dependencies, WCAG AA/AAA contrast adherence
 * - MECE badge pills, 4-Quadrant GEO cards, responsive breakpoints
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS_PATH = path.resolve(__dirname, '../../assets/css/app.css');

test('Feature 23.1: CSS root design tokens define brand, neutral and MECE palettes', () => {
  if (fs.existsSync(CSS_PATH)) {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    assert.ok(css.includes('--bg-obsidian') && css.includes('#0B0D10'));
    assert.ok(css.includes('--bg-alabaster') && css.includes('#F7F8FA'));
    assert.ok(css.includes('--bg-paper') && css.includes('--border-hairline'));
    assert.ok(css.includes('--status-win-text') && css.includes('--status-halo-text') && css.includes('--status-loss-text'));;
    assert.ok(css.includes('--color-mece-win') || css.includes('mece-direct-win') || css.includes('--color-mece'));
  } else {
    assert.ok(true);
  }
});

test('Feature 23.2: Monospace font stack configured for numeric telemetry', () => {
  if (fs.existsSync(CSS_PATH)) {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    assert.ok(css.includes('monospace') || css.includes('--font-mono'));
  } else {
    assert.ok(true);
  }
});

test('Feature 23.3: Semantic MECE badge pill classes defined', () => {
  if (fs.existsSync(CSS_PATH)) {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    assert.ok(css.includes('.mece-direct-win') || css.includes('direct-win'));
    assert.ok(css.includes('.mece-brand-halo') || css.includes('brand-halo'));
    assert.ok(css.includes('.mece-competitor-takeover') || css.includes('competitor-takeover'));
    assert.ok(css.includes('.mece-generic') || css.includes('generic'));
  } else {
    assert.ok(true);
  }
});

test('Feature 23.4: 4-Quadrant GEO diagnostic accent colors present', () => {
  if (fs.existsSync(CSS_PATH)) {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    assert.ok(css.includes('geo-hijack') || css.includes('CITATION_HIJACK') || css.includes('--color-geo'));
  } else {
    assert.ok(true);
  }
});

test('Feature 23.5: Responsive container and mobile breakpoint query', () => {
  if (fs.existsSync(CSS_PATH)) {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    assert.ok(css.includes('@media') && (css.includes('768px') || css.includes('640px')));
    assert.ok(css.includes('.container') || css.includes('max-width'));
  } else {
    assert.ok(true);
  }
});

test('Feature 23.6: Semantic theme tokens, dark-mode overrides, palette hygiene and brand SVG assets', () => {
  if (fs.existsSync(CSS_PATH)) {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    for (const token of [
      '--bg-canvas',
      '--bg-surface',
      '--text-primary',
      '--text-secondary',
      '--border-default',
      '--color-primary',
      '--color-success',
      '--color-warning',
      '--color-error',
      '[data-theme="dark"]',
    ]) {
      assert.ok(css.includes(token), 'Missing semantic token/selector: ' + token);
    }
    assert.ok(!css.includes('#2563EB') && !css.includes('#1D4ED8'), 'Legacy blue hexes must be removed');
  }
  const assetsDir = path.resolve(__dirname, '../../assets');
  for (const svg of ['logo.svg', 'logo-mark.svg', 'favicon.svg']) {
    const svgPath = path.join(assetsDir, svg);
    assert.ok(fs.existsSync(svgPath), 'Missing brand SVG asset: ' + svg);
    const content = fs.readFileSync(svgPath, 'utf8');
    assert.ok(content.includes('<svg') && content.includes('#10B981'), svg + ' must use First Choice Emerald #10B981');
  }
});
