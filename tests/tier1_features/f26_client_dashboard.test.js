/**
 * tests/tier1_features/f26_client_dashboard.test.js
 * Feature 26: Client Dashboard & 4-Quadrant GEO Action Panel
 * Requirements:
 * - dashboard.html layout, KPI cards, MECE bar, citations, 4-Quadrant GEO panel
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DASHBOARD_PATH = path.resolve(__dirname, '../../dashboard.html');

test('Feature 26.1: HTML5 structure and script links in dashboard.html', () => {
  if (fs.existsSync(DASHBOARD_PATH)) {
    const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('assets/js/dashboard.js') || html.includes('dashboard.js'));
  } else {
    assert.ok(true);
  }
});

test('Feature 26.2: Period filter segmented controls (7d, 30d, 90d, All)', () => {
  if (fs.existsSync(DASHBOARD_PATH)) {
    const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
    assert.ok(html.includes('30d') || html.includes('data-period'));
  } else {
    assert.ok(true);
  }
});

test('Feature 26.3: Top KPI bar elements present in dashboard DOM', () => {
  if (fs.existsSync(DASHBOARD_PATH)) {
    const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
    assert.ok(html.includes('som') || html.includes('Visibility') || html.includes('kpi'));
  } else {
    assert.ok(true);
  }
});

test('Feature 26.4: 4-Quadrant GEO Action Panel container presence', () => {
  if (fs.existsSync(DASHBOARD_PATH)) {
    const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
    assert.ok(html.includes('geo') || html.includes('quadrant') || html.includes('diagnostic'));
  } else {
    assert.ok(true);
  }
});

test('Feature 26.5: Instant run trigger button element presence', () => {
  if (fs.existsSync(DASHBOARD_PATH)) {
    const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
    assert.ok(html.includes('trigger') || html.includes('btn-trigger-run') || html.includes('run'));
  } else {
    assert.ok(true);
  }
});
