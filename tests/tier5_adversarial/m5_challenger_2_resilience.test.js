/**
 * tests/tier5_adversarial/m5_challenger_2_resilience.test.js
 * Adversarial UI Resilience, Edge-Case Data Binding, Offline Compliance & Debouncing Test Suite
 * Milestone 5 Challenger #2 (m5_challenger_2)
 *
 * Requirements & Adversarial Objectives:
 * 1. Zero-run empty states: Clean empty-state placeholders, zero NaN%, zero broken SVG bars, zero JS runtime crashes.
 * 2. 100% offline self-contained compliance: Zero external CDNs, zero external fonts, zero external imports, air-gapped readiness.
 * 3. Debounce & rapid click spamming: Safe debouncing on instant run button and demo seeder preventing duplicate dispatches.
 * 4. Formatting edge cases: Currency, percentage, and number formatters under 0, negative, extreme values, strings, and missing locales.
 * 5. Translation fallback: Corrupted/missing i18n keys safely fallback and never render as undefined.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '../..');
const I18N_PATH = path.join(ROOT_DIR, 'assets/js/i18n.js');
const ADMIN_JS_PATH = path.join(ROOT_DIR, 'assets/js/admin.js');
const APP_CSS_PATH = path.join(ROOT_DIR, 'assets/css/app.css');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');
const DASHBOARD_HTML_PATH = path.join(ROOT_DIR, 'dashboard.html');
const ADMIN_HTML_PATH = path.join(ROOT_DIR, 'admin.html');

// Helper to construct a mock DOM environment
function createMockDOM() {
  const elements = {};
  const mockDoc = {
    getElementById: (id) => {
      if (!elements[id]) {
        elements[id] = {
          id,
          textContent: '',
          innerHTML: '',
          className: '',
          disabled: false,
          style: {},
          classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            contains(c) { return this.classes.has(c); }
          },
          children: [],
          appendChild(child) {
            this.children.push(child);
          },
          setAttribute: (k, v) => {},
          getAttribute: (k) => null
        };
      }
      return elements[id];
    },
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        textContent: '',
        innerHTML: '',
        className: '',
        disabled: false,
        style: {},
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); },
          remove(c) { this.classes.delete(c); },
          contains(c) { return this.classes.has(c); }
        },
        children: [],
        appendChild(child) {
          this.children.push(child);
        },
        setAttribute: (k, v) => {},
        getAttribute: (k) => null,
        remove: () => {},
        addEventListener: () => {}
      };
      return el;
    },
    createTextNode: (text) => ({ textContent: text }),
    querySelectorAll: (selector) => [],
    addEventListener: () => {}
  };

  const mockWin = {
    location: {
      search: '',
      origin: 'https://chatlytics.de',
      pathname: '/dashboard.html'
    },
    localStorage: {
      _store: {},
      getItem(k) { return this._store[k] || null; },
      setItem(k, v) { this._store[k] = String(v); },
      removeItem(k) { delete this._store[k]; }
    },
    navigator: {
      clipboard: {
        writeText: async (text) => true
      }
    }
  };

  return { mockDoc, mockWin, elements };
}

// =============================================================================
// SUITE 1: Zero-Run Empty State & Data Binding Resilience
// =============================================================================
test('Suite 1: Zero-Run Empty State & Data Binding Resilience', async (t) => {
  const { mockDoc, mockWin, elements } = createMockDOM();
  globalThis.document = mockDoc;
  globalThis.window = mockWin;

  const { dashboard, DashboardController, escapeHtml } = await import('../../assets/js/dashboard.js');

  await t.test('1.1: total_runs = 0 activates empty state container and hides data grid', () => {
    dashboard.renderDashboard({
      metrics: { total_runs: 0, som_score: 0, visibility_index: 0, avg_earliness: 0, citation_share: 0, credits_remaining: 40 }
    });

    assert.equal(elements['empty-state'].style.display, 'block', 'Empty state container must be displayed');
    assert.equal(elements['dashboard-data-grid'].style.display, 'none', 'Data grid must be hidden when total_runs is 0');
  });

  await t.test('1.2: All 6 KPI elements in zero-run state display clean zero values with NO NaN or undefined', () => {
    dashboard.renderZeroKPIs({ credits_remaining: 40 });

    const somText = elements['kpi-som'].textContent;
    const visText = elements['kpi-visibility'].textContent;
    const earlyText = elements['kpi-earliness'].textContent;
    const runsText = elements['kpi-runs'].textContent;
    const citText = elements['kpi-citations'].textContent;
    const credText = elements['kpi-credits'].textContent;

    assert.equal(somText, '0.0 %');
    assert.equal(visText, '0.0 %');
    assert.equal(earlyText, '0.0 %');
    assert.equal(runsText, '0');
    assert.equal(citText, '0.0 %');
    assert.equal(credText, '40');

    // Anti-NaN & Anti-undefined invariant
    const allKpis = [somText, visText, earlyText, runsText, citText, credText];
    for (const val of allKpis) {
      assert.ok(!val.includes('NaN'), `KPI value "${val}" must NOT contain NaN`);
      assert.ok(!val.includes('undefined'), `KPI value "${val}" must NOT contain undefined`);
      assert.ok(!val.includes('null'), `KPI value "${val}" must NOT contain null`);
    }
  });

  await t.test('1.3: Completely empty API reports payload ({}) defaults safely to empty state without throwing', () => {
    assert.doesNotThrow(() => {
      dashboard.renderDashboard({});
    }, 'renderDashboard({}) must not crash');

    assert.equal(elements['empty-state'].style.display, 'block');
    assert.equal(elements['dashboard-data-grid'].style.display, 'none');
  });

  await t.test('1.4: MECE trend calculation with zero category counts does NOT divide by zero or emit NaN%', () => {
    dashboard.renderMECETrend({}, 0);

    const winWidth = elements['mece-bar-win'].style.width;
    const haloWidth = elements['mece-bar-halo'].style.width;
    const takeoverWidth = elements['mece-bar-takeover'].style.width;
    const genericWidth = elements['mece-bar-generic'].style.width;

    assert.equal(winWidth, '0.0%');
    assert.equal(haloWidth, '0.0%');
    assert.equal(takeoverWidth, '0.0%');
    assert.equal(genericWidth, '0.0%');

    assert.equal(elements['mece-pct-win'].textContent, '(0.0%)');
    assert.equal(elements['mece-pct-halo'].textContent, '(0.0%)');
    assert.equal(elements['mece-pct-takeover'].textContent, '(0.0%)');
    assert.equal(elements['mece-pct-generic'].textContent, '(0.0%)');
  });

  await t.test('1.5: Competitor benchmark table with empty array or null input renders clean placeholder row', () => {
    dashboard.renderCompetitors([]);
    assert.ok(elements['competitors-tbody'].innerHTML.includes('Keine Wettbewerberdaten erfasst.'));

    dashboard.renderCompetitors(null);
    assert.ok(elements['competitors-tbody'].innerHTML.includes('Keine Wettbewerberdaten erfasst.'));

    dashboard.renderCompetitors(undefined);
    assert.ok(elements['competitors-tbody'].innerHTML.includes('Keine Wettbewerberdaten erfasst.'));
  });

  await t.test('1.6: Citations table with empty domain list renders clean placeholder row without throwing', () => {
    dashboard.renderCitations({ domains: [] });
    assert.ok(elements['citations-tbody'].innerHTML.includes('Keine Quellenzitierungen vorhanden.'));

    dashboard.renderCitations({});
    assert.ok(elements['citations-tbody'].innerHTML.includes('Keine Quellenzitierungen vorhanden.'));
  });

  await t.test('1.7: 4-Quadrant GEO panel with empty diagnostic defaults to NONE and safe prescription', () => {
    dashboard.renderGEOPanel({});
    assert.equal(elements['geo-active-badge'].textContent, 'Optimal · Spitzenreiter');
    assert.ok(elements['geo-prescription'].textContent.includes('Keine kritischen Abweichungen'));
    assert.equal(elements['geo-count-hijack'].textContent, '0');
    assert.equal(elements['geo-count-blindspot'].textContent, '0');
    assert.equal(elements['geo-count-trap'].textContent, '0');
    assert.equal(elements['geo-count-buried'].textContent, '0');
  });

  await t.test('1.8: PoP delta badge handling renders neutral dash (—) on null/undefined/NaN and signed % on valid delta', () => {
    dashboard.setDeltaBadge('kpi-som-delta', null);
    assert.equal(elements['kpi-som-delta'].textContent, '—');
    assert.ok(elements['kpi-som-delta'].className.includes('delta-neutral'));

    dashboard.setDeltaBadge('kpi-som-delta', undefined);
    assert.equal(elements['kpi-som-delta'].textContent, '—');

    dashboard.setDeltaBadge('kpi-som-delta', NaN);
    assert.equal(elements['kpi-som-delta'].textContent, '—');

    dashboard.setDeltaBadge('kpi-som-delta', 15.4);
    assert.equal(elements['kpi-som-delta'].textContent, '+15.4%');
    assert.ok(elements['kpi-som-delta'].className.includes('delta-positive'));

    dashboard.setDeltaBadge('kpi-som-delta', -8.2);
    assert.equal(elements['kpi-som-delta'].textContent, '-8.2%');
    assert.ok(elements['kpi-som-delta'].className.includes('delta-negative'));
  });

  await t.test('1.9: XSS sanitization in dynamic competitor and citations table rows', () => {
    const maliciousCompetitors = [{
      competitor_name: '<script>alert("xss")</script>',
      competitor_domain: '<img src=x onerror=alert(1)>',
      visibility_pct: 12.5,
      mentions: 3,
      recommendations: 1,
      avg_relative_pos: 45.2
    }];

    dashboard.renderCompetitors(maliciousCompetitors);
    const renderedHtml = elements['competitors-tbody'].children[0].innerHTML;
    assert.ok(!renderedHtml.includes('<script>'), 'Script tag must be escaped');
    assert.ok(renderedHtml.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
    assert.ok(renderedHtml.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });
});

// =============================================================================
// SUITE 2: 100% Offline Self-Contained & Air-Gapped Compliance Audit
// =============================================================================
test('Suite 2: 100% Offline Self-Contained Compliance Audit', async (t) => {
  const htmlFiles = [
    { name: 'index.html', path: INDEX_HTML_PATH },
    { name: 'dashboard.html', path: DASHBOARD_HTML_PATH },
    { name: 'admin.html', path: ADMIN_HTML_PATH }
  ];

  await t.test('2.1: Zero external CDN script tags across all HTML pages', () => {
    const cdnPatterns = [
      /cdn\.jsdelivr/i,
      /cdnjs\.cloudflare\.com/i,
      /unpkg\.com/i,
      /bootstrapcdn\.com/i,
      /googleapis\.com/i,
      /gstatic\.com/i,
      /google-analytics\.com/i,
      /googletagmanager\.com/i
    ];

    for (const file of htmlFiles) {
      const content = fs.readFileSync(file.path, 'utf8');
      for (const pattern of cdnPatterns) {
        assert.ok(!pattern.test(content), `File ${file.name} must NOT contain external reference matching ${pattern}`);
      }
    }
  });

  await t.test('2.2: Zero external stylesheets or remote font imports in HTML files', () => {
    for (const file of htmlFiles) {
      const content = fs.readFileSync(file.path, 'utf8');
      // Match <link rel="stylesheet" href="...">
      const linkMatches = content.match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || [];
      for (const link of linkMatches) {
        assert.ok(!link.includes('http://'), `External HTTP stylesheet detected in ${file.name}: ${link}`);
        assert.ok(!link.includes('https://'), `External HTTPS stylesheet detected in ${file.name}: ${link}`);
        assert.ok(!link.includes('//'), `External protocol-relative stylesheet detected in ${file.name}: ${link}`);
      }
    }
  });

  await t.test('2.3: Zero @import and zero remote url() assets in assets/css/app.css', () => {
    const css = fs.readFileSync(APP_CSS_PATH, 'utf8');
    assert.ok(!/@import/i.test(css), 'app.css must NOT contain @import rules');
    assert.ok(!/url\s*\(\s*['"]?https?:/i.test(css), 'app.css must NOT load remote assets via url()');
    assert.ok(!/url\s*\(\s*['"]?\/\//i.test(css), 'app.css must NOT load protocol-relative assets via url()');
  });

  await t.test('2.4: System font stacks only: No web fonts required in app.css font-family', () => {
    const css = fs.readFileSync(APP_CSS_PATH, 'utf8');
    assert.ok(css.includes('system-ui') || css.includes('-apple-system'), 'app.css must use OS system fonts for UI');
    assert.ok(css.includes('ui-monospace') || css.includes('SFMono-Regular') || css.includes('Consolas'), 'app.css must use system monospace fonts');
  });

  await t.test('2.5: All script and stylesheet link paths exist on disk (100% self-contained)', () => {
    for (const file of htmlFiles) {
      const content = fs.readFileSync(file.path, 'utf8');
      // Extract <script src="...">
      const scriptMatches = content.matchAll(/<script[^>]+src=["']([^"']+)["']/gi);
      for (const m of scriptMatches) {
        const src = m[1];
        if (src.startsWith('http')) continue; // Already audited above
        const localPath = path.resolve(ROOT_DIR, src);
        assert.ok(fs.existsSync(localPath), `Referenced script ${src} in ${file.name} must exist on disk at ${localPath}`);
      }

      // Extract <link rel="stylesheet" href="...">
      const linkMatches = content.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*>/gi);
      for (const m of linkMatches) {
        const href = m[1];
        if (href.startsWith('http') || href.endsWith('.ico') || href.includes('icon')) continue;
        const localPath = path.resolve(ROOT_DIR, href);
        assert.ok(fs.existsSync(localPath), `Referenced link ${href} in ${file.name} must exist on disk at ${localPath}`);
      }
    }
  });
});

// =============================================================================
// SUITE 3: Debounce & Rapid Click Spamming Resilience
// =============================================================================
test('Suite 3: Debounce & Rapid Click Spamming Resilience', async (t) => {
  const { mockDoc, mockWin, elements } = createMockDOM();
  globalThis.document = mockDoc;
  globalThis.window = mockWin;
  globalThis.localStorage = mockWin.localStorage;

  const { dashboard } = await import('../../assets/js/dashboard.js');
  const { apiClient } = await import('../../assets/js/api-client.js');

  // Prevent background loadDashboard timeout from failing
  apiClient.getReports = async () => ({ metrics: { total_runs: 0 } });

  await t.test('3.1: 50 concurrent / rapid clicks on instant run trigger button dispatch exactly ONCE', async () => {
    let dispatchCallCount = 0;
    // Mock apiClient.triggerRun with simulated async network latency
    apiClient.triggerRun = async () => {
      dispatchCallCount++;
      await new Promise(r => setTimeout(r, 60));
      return { status: 'queued', credits_remaining: 39 };
    };

    dashboard.selectedConfigId = 101;
    dashboard.isRunning = false;
    dashboard.isAuditMode = false;

    // Simulate aggressive multi-click / click spamming (50 rapid calls)
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(dashboard.handleTriggerRun());
    }

    await Promise.all(promises);

    assert.equal(dispatchCallCount, 1, 'Aggressive 50-click spamming must yield exactly 1 dispatch call');
    assert.equal(dashboard.isRunning, false, 'isRunning state must be restored to false after execution');
  });

  await t.test('3.2: Instant run trigger button is disabled during in-flight request and restored after completion', async () => {
    let capturedDisabledStateWhileInFlight = null;
    const btn = elements['btn-trigger-run'];
    btn.disabled = false;

    apiClient.triggerRun = async () => {
      capturedDisabledStateWhileInFlight = btn.disabled;
      await new Promise(r => setTimeout(r, 40));
      return { status: 'queued', credits_remaining: 38 };
    };

    dashboard.selectedConfigId = 101;
    dashboard.isRunning = false;

    await dashboard.handleTriggerRun();

    assert.equal(capturedDisabledStateWhileInFlight, true, 'Trigger button must be disabled during active dispatch');
    assert.equal(btn.disabled, false, 'Trigger button must be re-enabled after completion');
  });

  await t.test('3.3: Post-completion recovery allows subsequent single trigger click', async () => {
    let secondRunDispatched = false;
    apiClient.triggerRun = async () => {
      secondRunDispatched = true;
      return { status: 'queued', credits_remaining: 37 };
    };

    dashboard.selectedConfigId = 101;
    dashboard.isRunning = false;

    await dashboard.handleTriggerRun();
    assert.equal(secondRunDispatched, true, 'Subsequent click after prior execution finishes must succeed');
  });

  await t.test('3.4: Owner Cockpit 1-Click demo seeder safely debounces 50 rapid clicks to exactly 1 request', async () => {
    // Setup Admin environment
    globalThis.localStorage.setItem('chatlytics_token', 'test_admin_jwt');
    const admin = require('../../assets/js/admin.js');
    const { AdminState } = admin;

    let seederFetchCount = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('seed_demo_data')) {
        seederFetchCount++;
        await new Promise(r => setTimeout(r, 60));
        return {
          ok: true,
          json: async () => ({
            status: 'success',
            data: { seeded_accounts: ['demo@test.de'], configs_created: 1, runs_created: 5, users: [], pagination: { total: 1, total_pages: 1 } }
          })
        };
      }
      return {
        ok: true,
        json: async () => ({ status: 'success', data: { users: [], pagination: { total: 0, total_pages: 1 } } })
      };
    };

    const triggerDemoSeeder = mockWin.ChatlyticsAdmin?.triggerDemoSeeder;
    assert.equal(typeof triggerDemoSeeder, 'function', 'triggerDemoSeeder must be exported on ChatlyticsAdmin');

    AdminState.isSeeding = false;
    const spamPromises = [];
    for (let i = 0; i < 50; i++) {
      spamPromises.push(triggerDemoSeeder());
    }

    const results = await Promise.all(spamPromises);
    const trueResults = results.filter(r => r === true);
    const falseResults = results.filter(r => r === false);

    assert.equal(trueResults.length, 1, 'Only exactly 1 click invocation should succeed');
    assert.equal(falseResults.length, 49, 'All 49 concurrent duplicate clicks must be rejected (return false)');
    assert.equal(seederFetchCount, 1, 'Backend seed endpoint must be called exactly once');
    assert.equal(AdminState.isSeeding, false, 'AdminState.isSeeding must reset to false after completion');
  });
});

// =============================================================================
// SUITE 4: Formatting Edge Cases & Mathematical Boundary Values
// =============================================================================
test('Suite 4: Formatting Edge Cases & Mathematical Boundary Values', async (t) => {
  const i18n = require('../../assets/js/i18n.js');
  const { formatCurrency, formatPercent, formatNumber, formatDate } = i18n;

  await t.test('4.1: Currency formatting with zero: 0 € (DE) and €0 (EN)', () => {
    assert.equal(formatCurrency(0, 'de'), '0 €');
    assert.equal(formatCurrency(0, 'en'), '€0');
    assert.equal(formatCurrency('0', 'de'), '0 €');
    assert.equal(formatCurrency('0', 'en'), '€0');
  });

  await t.test('4.2: Currency formatting with negative amounts preserves sign', () => {
    assert.equal(formatCurrency(-149, 'de'), '-149 €');
    assert.equal(formatCurrency(-149, 'en'), '€-149');
    assert.equal(formatCurrency(-0.5, 'de'), '-0.5 €');
  });

  await t.test('4.3: Currency formatting with extreme decimals and pricing tiers', () => {
    assert.equal(formatCurrency(1950.5, 'de'), '1950.5 €');
    assert.equal(formatCurrency(399, 'de'), '399 €');
    assert.equal(formatCurrency(149, 'en'), '€149');
    assert.equal(formatCurrency(0.0001, 'de'), '0.0001 €');
  });

  await t.test('4.4: Currency formatting with null, undefined, or string dirty inputs', () => {
    assert.equal(formatCurrency(null, 'de'), '0 €');
    assert.equal(formatCurrency(undefined, 'en'), '€0');
    assert.equal(formatCurrency('149 €', 'de'), '149 €');
    assert.equal(formatCurrency('€399', 'en'), '€399');
    assert.equal(formatCurrency('non-numeric', 'de'), '0 €');
  });

  await t.test('4.5: Percentage formatting with zero: 0,0 % (DE) and 0.0% (EN)', () => {
    assert.equal(formatPercent(0, 'de'), '0,0 %');
    assert.equal(formatPercent(0, 'en'), '0.0%');
    assert.equal(formatPercent('0', 'de'), '0,0 %');
  });

  await t.test('4.6: Percentage formatting with negative values', () => {
    assert.equal(formatPercent(-12.5, 'de'), '-12,5 %');
    assert.equal(formatPercent(-12.5, 'en'), '-12.5%');
    assert.equal(formatPercent(-0.1, 'de'), '-0,1 %');
  });

  await t.test('4.7: Percentage formatting with extreme precision and rounding boundaries', () => {
    assert.equal(formatPercent(99.999, 'de', 1), '100,0 %');
    assert.equal(formatPercent(99.999, 'de', 2), '100,00 %');
    assert.equal(formatPercent(0.001, 'de', 1), '0,0 %');
    assert.equal(formatPercent(0.001, 'de', 3), '0,001 %');
  });

  await t.test('4.8: Percentage formatting NaN and non-numeric guard: NEVER emits NaN%', () => {
    const nanDe = formatPercent(NaN, 'de');
    const nanEn = formatPercent(NaN, 'en');
    const nullDe = formatPercent(null, 'de');
    const undefEn = formatPercent(undefined, 'en');
    const strDe = formatPercent('corrupted_val', 'de');

    assert.equal(nanDe, '0,0 %');
    assert.equal(nanEn, '0.0%');
    assert.equal(nullDe, '0,0 %');
    assert.equal(undefEn, '0.0%');
    assert.equal(strDe, '0,0 %');

    assert.ok(!nanDe.includes('NaN'), 'Must NOT return NaN%');
    assert.ok(!nanEn.includes('NaN'), 'Must NOT return NaN%');
  });

  await t.test('4.9: Number and Date formatting resilience under edge cases', () => {
    assert.equal(formatNumber(1000000, 'de'), '1.000.000');
    assert.equal(formatNumber(1000000, 'en'), '1,000,000');
    assert.equal(formatNumber(0, 'de'), '0');
    assert.equal(formatNumber(NaN, 'de'), '0');
    assert.equal(formatNumber('invalid', 'en'), '0');

    assert.doesNotThrow(() => {
      formatDate('invalid-date-string');
      formatDate(null);
      formatDate(undefined);
    });
  });
});

// =============================================================================
// SUITE 5: Translation Fallback & Dictionary Integrity
// =============================================================================
test('Suite 5: Translation Fallback & Dictionary Integrity', async (t) => {
  const i18n = require('../../assets/js/i18n.js');
  const { t: translate, dictionaries, translatePage } = i18n;

  await t.test('5.1: Missing dictionary key with explicit fallback returns fallback string', () => {
    const res = translate('completely.nonexistent.key.xyz', 'Sicherer Fallback-Text');
    assert.equal(res, 'Sicherer Fallback-Text');
  });

  await t.test('5.2: Missing dictionary key without fallback returns key name, NEVER undefined', () => {
    const res = translate('completely.nonexistent.key.xyz');
    assert.equal(res, 'completely.nonexistent.key.xyz');
    assert.notEqual(res, undefined);
    assert.notEqual(res, 'undefined');
  });

  await t.test('5.3: Null, undefined, and empty string key inputs return safe string without throwing', () => {
    assert.equal(translate(null, 'Fallback'), 'Fallback');
    assert.equal(translate(undefined, 'Fallback'), 'Fallback');
    assert.equal(translate('', 'Fallback'), 'Fallback');
    assert.equal(translate(null), '');
    assert.equal(translate(undefined), '');
  });

  await t.test('5.4: Prototype pollution resistance: Object prototypes never leak as translations', () => {
    const protoKeys = ['toString', 'valueOf', 'constructor', '__proto__', 'isPrototypeOf'];
    for (const key of protoKeys) {
      const res = translate(key, 'Safe');
      assert.equal(res, 'Safe', `Prototype key "${key}" must not resolve to native function`);
    }
  });

  await t.test('5.5: Bilingual dictionaries have non-empty string values for all keys', () => {
    const languages = ['de', 'en'];
    for (const lang of languages) {
      const dict = dictionaries[lang];
      assert.ok(dict, `Dictionary for "${lang}" must exist`);
      const keys = Object.keys(dict);
      assert.ok(keys.length >= 80, `Dictionary for "${lang}" must contain at least 80 key-value pairs (found ${keys.length})`);

      for (const k of keys) {
        const val = dict[k];
        assert.equal(typeof val, 'string', `Key "${k}" in ${lang} must map to a string`);
        assert.ok(val.trim().length > 0, `Key "${k}" in ${lang} must not be empty string`);
        assert.notEqual(val, 'undefined', `Key "${k}" in ${lang} must not be string "undefined"`);
        assert.notEqual(val, 'null', `Key "${k}" in ${lang} must not be string "null"`);
      }
    }
  });

  await t.test('5.6: Mandatory Verbatim Mission Statements exist in both languages', () => {
    const deMission = dictionaries.de['mission.statement'];
    const enMission = dictionaries.en['mission.statement'];

    assert.equal(
      deMission,
      'Chatlytics.de — AI Visibility & Share-of-Model (SoM) Analytics für europäische B2B-Marken.'
    );
    assert.equal(
      enMission,
      'Chatlytics.de — AI Visibility & Share-of-Model (SoM) Analytics for European B2B Brands.'
    );
  });

  await t.test('5.7: DOM Translation fallback audit: Missing/unmatched data-i18n keys NEVER render as undefined', () => {
    const htmlFiles = [
      { name: 'index.html', path: INDEX_HTML_PATH },
      { name: 'dashboard.html', path: DASHBOARD_HTML_PATH },
      { name: 'admin.html', path: ADMIN_HTML_PATH }
    ];

    for (const file of htmlFiles) {
      const content = fs.readFileSync(file.path, 'utf8');
      const matches = content.matchAll(/data-i18n(?:-placeholder|-title|-aria)?=["']([^"']+)["']/g);
      for (const m of matches) {
        const key = m[1];
        // Simulate translate lookup with dummy fallback
        const deTranslation = translate(key, 'Fallback Content', 'de');
        const enTranslation = translate(key, 'Fallback Content', 'en');

        assert.notEqual(deTranslation, undefined, `Key ${key} in ${file.name} must not translate to undefined`);
        assert.notEqual(deTranslation, 'undefined', `Key ${key} in ${file.name} must not translate to "undefined"`);
        assert.notEqual(enTranslation, undefined, `Key ${key} in ${file.name} must not translate to undefined`);
        assert.notEqual(enTranslation, 'undefined', `Key ${key} in ${file.name} must not translate to "undefined"`);
      }
    }
  });

  await t.test('5.8: Core UI navigation, pricing, MECE and GEO keys are present in both DE and EN', () => {
    const coreKeys = [
      'nav.brand', 'nav.tagline', 'nav.features', 'nav.mece', 'nav.pricing',
      'nav.dashboard', 'nav.admin', 'nav.login', 'nav.signup', 'nav.logout',
      '1_DIRECT_WIN', '2_BRAND_HALO', '3_COMPETITOR_TAKEOVER', '4_GENERIC',
      '1_CITATION_HIJACK', '2_PARAMETRIC_BLINDSPOT', '3_BRAND_HALO_TRAP', '4_BURIED_WINNER', 'NONE',
      'pricing.free_name', 'pricing.starter_name', 'pricing.growth_name', 'pricing.managed_name',
      'pricing.free_price', 'pricing.starter_price', 'pricing.growth_price', 'pricing.managed_price'
    ];

    for (const k of coreKeys) {
      assert.ok(dictionaries.de[k], `Core key "${k}" must exist in dictionaries.de`);
      assert.ok(dictionaries.en[k], `Core key "${k}" must exist in dictionaries.en`);
    }
  });
});
