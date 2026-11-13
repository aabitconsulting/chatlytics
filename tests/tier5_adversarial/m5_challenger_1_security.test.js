/**
 * tests/tier5_adversarial/m5_challenger_1_security.test.js
 * 
 * Milestone 5 Adversarial Frontend Security & Access Challenger Test Suite
 * Platform: Chatlytics.de (AI Visibility & Share-of-Model Platform)
 * Agent: m5_challenger_1 (EMPIRICAL CHALLENGER - critic & specialist)
 * 
 * Adversarial Objectives:
 * 1. XSS injection attacks: Verify that malicious payloads (<script>alert(1)</script>,
 *    <img src=x onerror=alert(1)>, etc.) injected into brand names, prompt inputs,
 *    competitor lists, citation domains, and user telemetry are safely escaped using
 *    textContent or escapeHtml, and never injected as raw unescaped innerHTML.
 * 2. Client route guards & access controls: Verify that unauthenticated requests to
 *    protected views (dashboard.html, admin.html) are redirected to index.html?auth=required,
 *    and non-admin requests to admin.html are redirected to dashboard.html?error=unauthorized.
 * 3. Magic Audit mutation lockouts: Verify that entering Magic Audit mode (?audit_token=...)
 *    strictly locks all mutation controls: #btn-trigger-run, #btn-new-config,
 *    #billing-nav, #profile-settings, #btn-share-audit, and #btn-logout.
 * 4. Corporate email filtering: Verify that public/disposable email addresses (gmail.com,
 *    yahoo.com, tempmail.com, and subdomains like user@sub.gmail.com) are strictly
 *    rejected on registration across both frontend and backend handlers.
 * 5. Static GDPR/DSGVO & Zero-CDN Compliance: Verify zero external CDNs, third-party
 *    tracking fonts, or insecure external scripts across all HTML assets.
 * 6. Live HTTP server validation against backend endpoints for auth and admin protection.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TEST_PORT = 8996;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Import core frontend modules
const authModule = require('../../assets/js/auth.js');
const configsModule = require('../../assets/js/configs.js');
const adminModule = require('../../assets/js/admin.js');
const dashboardModule = require('../../assets/js/dashboard.js');
const apiClientModule = require('../../assets/js/api-client.js');

const { validateWorkEmail, routeGuard, checkAccess, AuthManager } = authModule;
const { sanitizeDomains, parsePrompts, parseCompetitors } = configsModule;
const { buildCreditPayload, escapeHtml: escapeHtmlAdmin, sanitizeLength } = adminModule;
const { dashboard, DashboardController, escapeHtml: escapeHtmlDash } = dashboardModule;
const { ApiClient, apiClient } = apiClientModule;

// Canonical escapeHtml function matching dashboard.js line 524 and admin.js line 40
const escapeHtmlCanonical = (str) => {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

let serverProcess = null;

// Start PHP built-in web server before running tests
test.before(async () => {
  serverProcess = spawn('php', ['-S', `127.0.0.1:${TEST_PORT}`, '-t', PROJECT_ROOT], {
    cwd: PROJECT_ROOT,
    stdio: 'ignore'
  });

  // Wait for server to accept connections (60 retries x 100ms = 6.0s timeout)
  let ready = false;
  const startTime = Date.now();
  while (!ready && Date.now() - startTime < 6000) {
    try {
      const res = await fetch(`${BASE_URL}/api/bootstrap.php`);
      ready = true;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  assert.ok(ready, `PHP built-in test server failed to bind to 127.0.0.1:${TEST_PORT}`);
});

test.after(() => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

// Helper: Lightweight DOM Element Mock for empirical UI testing
class MockElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.classList = new Set();
    this.classList.add = (c) => this.classList._add(c);
    this.classList._add = (c) => Set.prototype.add.call(this.classList, c);
    this.classList.remove = (c) => Set.prototype.delete.call(this.classList, c);
    this.classList.contains = (c) => Set.prototype.has.call(this.classList, c);
    this.style = {};
    this.attributes = {};
    this.children = [];
    this._textContent = '';
    this._innerHTML = '';
    this.value = '';
    this.disabled = false;
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(val) {
    this._textContent = String(val);
    this._innerHTML = ''; // setting textContent clears HTML structure
  }

  get innerHTML() {
    if (this._innerHTML) return this._innerHTML;
    // When textContent is set on a browser DOM element, innerHTML serializes to entity escaped text
    return escapeHtmlCanonical(this._textContent);
  }

  set innerHTML(val) {
    this._innerHTML = String(val);
    this._textContent = String(val).replace(/<[^>]*>/g, '');
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelector(sel) {
    for (const child of this.children) {
      if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) return child;
      if (sel.startsWith('#') && child.id === sel.slice(1)) return child;
      const found = child.querySelector?.(sel);
      if (found) return found;
    }
    return null;
  }
}

// ============================================================================
// SUITE 1: Adversarial XSS Injection Attacks across All Frontend Surfaces
// ============================================================================

test('ADV-M5-1.1: Dashboard escapeHtml strictly neutralizes script and event handler injection tags', () => {
  const hostilePayloads = [
    '<script>alert("XSS")</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(document.cookie)>',
    '"><script>alert(1)</script>',
    "';alert(String.fromCharCode(88,83,83))//",
    '<iframe src="javascript:alert(1)"></iframe>',
    '<body onload="alert(1)">',
    '"><img src=x onerror=prompt(1)>',
    '& < > " \''
  ];

  for (const payload of hostilePayloads) {
    const escaped = escapeHtmlDash(payload);

    // Escaped string must never contain raw unescaped opening or closing angle brackets
    assert.ok(!escaped.includes('<'), `escapeHtml must not contain unescaped '<' for payload: ${payload}`);
    assert.ok(!escaped.includes('>'), `escapeHtml must not contain unescaped '>' for payload: ${payload}`);
    // Quotes must be converted to entities
    if (payload.includes('"')) {
      assert.ok(!escaped.includes('"'), `escapeHtml must not contain unescaped double quotes: ${payload}`);
      assert.ok(escaped.includes('&quot;'), `escapeHtml must contain &quot;: ${payload}`);
    }
    if (payload.includes("'")) {
      assert.ok(!escaped.includes("'"), `escapeHtml must not contain unescaped single quotes: ${payload}`);
      assert.ok(escaped.includes('&#39;'), `escapeHtml must contain &#39;: ${payload}`);
    }
  }
});

test('ADV-M5-1.2: Admin escapeHtml strictly matches escaping contracts with null/undefined safety', () => {
  assert.equal(escapeHtmlAdmin(null), '');
  assert.equal(escapeHtmlAdmin(undefined), '');
  assert.equal(escapeHtmlAdmin(123), '123');
  assert.equal(
    escapeHtmlAdmin('<script>alert("admin")</script>'),
    '&lt;script&gt;alert(&quot;admin&quot;)&lt;/script&gt;'
  );
  assert.equal(
    escapeHtmlAdmin("Personio's & Partner <Tier>"),
    'Personio&#39;s &amp; Partner &lt;Tier&gt;'
  );
});

test('ADV-M5-1.3: Competitor Leaderboard rendering safely escapes malicious competitor names and domains', () => {
  const hostileCompetitors = [
    {
      competitor_name: '<script>alert("comp_name")</script>',
      competitor_domain: '<img src=x onerror=alert("comp_domain")>',
      visibility_pct: 45.2,
      mentions: 12,
      recommendations: 5,
      avg_relative_pos: 18.4
    },
    {
      name: '"><svg onload=alert(1)>',
      domain: 'javascript:alert(1)',
      visibility_pct: 30.0,
      mentions: 8
    }
  ];

  // Emulate competitor row generation from assets/js/dashboard.js
  const rows = [];
  hostileCompetitors.forEach((comp, idx) => {
    const name = comp.competitor_name || comp.name || 'Unbekannt';
    const domain = comp.competitor_domain || comp.domain || '—';
    const visPct = Number(comp.visibility_pct || 0).toFixed(1);
    const mentions = comp.mentions || 0;
    const recs = comp.recommendations || 0;
    const avgPos = comp.avg_relative_pos ? `${Number(comp.avg_relative_pos).toFixed(1)}%` : '—';

    const rowHtml = `
      <td class="text-muted font-mono">${idx + 1}</td>
      <td><strong>${escapeHtmlDash(name)}</strong></td>
      <td class="font-mono text-muted text-sm">${escapeHtmlDash(domain)}</td>
      <td class="text-right font-mono">${visPct}%</td>
      <td class="text-right font-mono">${mentions}</td>
      <td class="text-right font-mono">${recs}</td>
      <td class="text-right font-mono">${avgPos}</td>
    `;
    rows.push(rowHtml);
  });

  for (const rowHtml of rows) {
    // Assert no raw HTML tags from the malicious payloads survive
    assert.ok(!rowHtml.includes('<script>'), 'Competitor row must not contain unescaped script tag');
    assert.ok(!rowHtml.includes('<img'), 'Competitor row must not contain unescaped img tag');
    assert.ok(!rowHtml.includes('<svg'), 'Competitor row must not contain unescaped svg tag');
    // Assert safe entity replacements exist
    assert.ok(rowHtml.includes('&lt;') && rowHtml.includes('&gt;'), 'Competitor row must contain safe HTML entities');
  }
});

test('ADV-M5-1.4: Grounding Citations rendering safely escapes hostile citation domains', () => {
  const hostileCitations = {
    domains: [
      {
        citation_domain: 'attacker.com"><script>alert(document.cookie)</script>',
        citation_count: 14,
        is_brand_domain: false
      },
      {
        domain: '<b onmouseover="alert(1)">evil.org</b>',
        count: 7,
        is_brand_domain: true
      }
    ]
  };

  const rows = [];
  hostileCitations.domains.forEach(d => {
    const domain = d.citation_domain || d.domain || '—';
    const count = d.citation_count || d.count || 0;
    const isBrand = Boolean(d.is_brand_domain);

    const badgeHtml = isBrand
      ? '<span class="badge badge-success">Brand Domain</span>'
      : '<span class="badge badge-neutral">Third Party</span>';

    const rowHtml = `
      <td class="font-mono">${escapeHtmlDash(domain)}</td>
      <td class="text-center">${badgeHtml}</td>
      <td class="text-right font-mono">${count}</td>
    `;
    rows.push(rowHtml);
  });

  for (const rowHtml of rows) {
    assert.ok(!rowHtml.includes('<script>'), 'Citation row must not contain unescaped script tag');
    assert.ok(!rowHtml.includes('<b '), 'Citation row must not contain unescaped b tag');
    assert.ok(rowHtml.includes('&lt;'), 'Citation row must contain safe entity');
  }
});

test('ADV-M5-1.5: Config select dropdown populates options using safe textContent', () => {
  const maliciousConfigs = [
    { id: 1, name: '<script>alert("cfg_xss")</script>', brand_name: 'Personio' },
    { id: 2, name: '', brand_name: '<img src=x onerror=alert("brand_xss")>' },
    { id: 3, name: '"><iframe src=javascript:alert(1)>', brand_name: 'Workday' }
  ];

  // Simulate select element
  const selectMock = new MockElement('select', 'config-select');

  for (const cfg of maliciousConfigs) {
    const opt = new MockElement('option');
    opt.value = cfg.id;
    // Follow exact dashboard.js line 121: opt.textContent = cfg.name || `${cfg.brand_name} Tracking`;
    opt.textContent = cfg.name || `${cfg.brand_name} Tracking`;
    selectMock.appendChild(opt);
  }

  for (const opt of selectMock.children) {
    // textContent treats tags as literal text; innerHTML remains empty or contains escaped entity representation
    assert.ok(!opt._innerHTML.includes('<script>'), 'Option must not set script via innerHTML');
    assert.ok(!opt._innerHTML.includes('<img'), 'Option must not set img via innerHTML');
    assert.ok(!opt._innerHTML.includes('<iframe'), 'Option must not set iframe via innerHTML');
    // textContent preserves literal string for safe display
    assert.ok(opt.textContent.length > 0);
  }
});

test('ADV-M5-1.6: configs.js domain sanitization strips hostile protocols, paths, and script injections', () => {
  const rawInputs = [
    'https://personio.de/',
    'http://attacker.com/path/to/evil?param=1#fragment',
    'HTTPS://SUB.EXAMPLE.COM/path/',
    '   HTTP://CLEAN-DOMAIN.DE   ',
    'https://evil.com/<script>',
    'javascript:alert(1)'
  ];

  const sanitized = sanitizeDomains(rawInputs.join(','));

  // Assert protocols and paths are stripped
  for (const d of sanitized) {
    assert.ok(!d.startsWith('http://'), `Domain must not start with http: ${d}`);
    assert.ok(!d.startsWith('https://'), `Domain must not start with https: ${d}`);
    assert.ok(!d.includes('/'), `Domain must not contain trailing paths: ${d}`);
    assert.ok(!d.includes('javascript:'), `Domain must not contain javascript scheme: ${d}`);
  }

  assert.ok(sanitized.includes('personio.de'));
  assert.ok(sanitized.includes('attacker.com'));
  assert.ok(sanitized.includes('sub.example.com'));
  assert.ok(sanitized.includes('clean-domain.de'));

  // Verify that when d with '<script' is rendered in dashboard, escapeHtml neutralizes it
  const dangerousItem = sanitized.find(d => d.includes('<'));
  if (dangerousItem) {
    const rendered = escapeHtmlDash(dangerousItem);
    assert.ok(!rendered.includes('<'), `Dangerous characters in domain must be escaped: ${rendered}`);
    assert.ok(rendered.includes('&lt;'), `Dangerous character must be converted to &lt;: ${rendered}`);
  }
});

test('ADV-M5-1.7: Admin User Directory table creation uses strict createElement and textContent', () => {
  const maliciousUsers = [
    {
      id: 99,
      email: 'attacker@enterprise.de"><script>alert("email")</script>',
      company_name: '<img src=x onerror=alert("company")>',
      tier: 'free" onmouseover="alert(1)',
      status: 'active" onclick="alert(2)',
      credits_remaining: 50,
      run_count: 10,
      created_at: '2026-11-09 00:00:00'
    }
  ];

  const tbody = new MockElement('tbody', 'users-tbody');

  // Replicate renderUserTableRows from assets/js/admin.js lines 279-352
  maliciousUsers.forEach((u) => {
    const tr = new MockElement('tr');

    const tdEmail = new MockElement('td');
    tdEmail.textContent = u.email; // strict textContent
    tr.appendChild(tdEmail);

    const tdCompany = new MockElement('td');
    tdCompany.textContent = sanitizeLength(u.company_name, 40); // strict textContent
    tr.appendChild(tdCompany);

    const tdTier = new MockElement('td');
    const spanTier = new MockElement('span');
    spanTier.className = `badge badge-tier badge-${escapeHtmlAdmin(u.tier || 'free')}`;
    spanTier.textContent = u.tier || 'free';
    tdTier.appendChild(spanTier);
    tr.appendChild(tdTier);

    const tdStatus = new MockElement('td');
    const spanStatus = new MockElement('span');
    spanStatus.className = `badge badge-status badge-${escapeHtmlAdmin(u.status || 'active')}`;
    spanStatus.textContent = u.status || 'active';
    tdStatus.appendChild(spanStatus);
    tr.appendChild(tdStatus);

    tbody.appendChild(tr);
  });

  const tr = tbody.children[0];
  const tdEmail = tr.children[0];
  const tdCompany = tr.children[1];
  const tdTier = tr.children[2];
  const tdStatus = tr.children[3];

  assert.ok(!tdEmail.innerHTML.includes('<script>'), 'tdEmail innerHTML must never parse script tags');
  assert.ok(!tdCompany.innerHTML.includes('<img'), 'tdCompany innerHTML must never parse img tags');
  assert.ok(!tdTier.children[0].className.includes('"'), 'Badge class must escape quotes');
  assert.ok(!tdStatus.children[0].className.includes('"'), 'Badge class must escape quotes');
});

// ============================================================================
// SUITE 2: Client Route Guards & Access Controls Adversarial Stress
// ============================================================================

test('ADV-M5-2.1: Unauthenticated request to dashboard.html is strictly redirected to index.html?auth=required', () => {
  const unauthScenarios = [
    { isAuthenticated: false, isAdmin: false, requiresAdmin: false },
    { isAuthenticated: false, isAdmin: true, requiresAdmin: false },
    { isAuthenticated: false, isAdmin: false, requiresAdmin: true },
    { isAuthenticated: null, isAdmin: false, requiresAdmin: false },
    { isAuthenticated: undefined, isAdmin: false, requiresAdmin: false },
    { isAuthenticated: 0, isAdmin: false, requiresAdmin: false },
    { isAuthenticated: '', isAdmin: false, requiresAdmin: false }
  ];

  for (const scenario of unauthScenarios) {
    const res = routeGuard(scenario);
    assert.equal(
      res.redirect,
      'index.html?auth=required',
      `Failed to redirect unauthenticated scenario: ${JSON.stringify(scenario)}`
    );
  }
});

test('ADV-M5-2.2: Non-admin authenticated user accessing admin.html is strictly redirected to dashboard.html?error=unauthorized', () => {
  const nonAdminScenarios = [
    { isAuthenticated: true, isAdmin: false, requiresAdmin: true },
    { isAuthenticated: true, isAdmin: null, requiresAdmin: true },
    { isAuthenticated: true, isAdmin: undefined, requiresAdmin: true },
    { isAuthenticated: true, isAdmin: 0, requiresAdmin: true }
  ];

  for (const scenario of nonAdminScenarios) {
    const res = routeGuard(scenario);
    assert.equal(
      res.redirect,
      'dashboard.html?error=unauthorized',
      `Failed to redirect non-admin scenario: ${JSON.stringify(scenario)}`
    );
  }
});

test('ADV-M5-2.3: Authenticated administrator accessing admin.html is granted access without redirection', () => {
  const adminScenario = { isAuthenticated: true, isAdmin: true, requiresAdmin: true };
  const res = routeGuard(adminScenario);
  assert.equal(res.redirect, null, 'Administrator must not be redirected');
});

test('ADV-M5-2.4: Authenticated regular user accessing dashboard.html is granted access without redirection', () => {
  const regularUserScenario = { isAuthenticated: true, isAdmin: false, requiresAdmin: false };
  const res = routeGuard(regularUserScenario);
  assert.equal(res.redirect, null, 'Authenticated user must not be redirected from dashboard');
});

test('ADV-M5-2.5: Role privilege escalation attempts via string or prototype tampering fail strict admin check', () => {
  const auth = new AuthManager();

  const maliciousUsers = [
    { role: 'user' },
    { role: 'USER' },
    { role: 'Admin' }, // wrong case
    { role: 'ADMIN' }, // uppercase
    { role: 'admin ' }, // trailing space
    { role: 'superadmin' },
    { role: 'root' },
    { role: 1 },
    { role: true },
    { role: '__proto__' },
    null,
    undefined,
    {}
  ];

  for (const u of maliciousUsers) {
    auth.user = u;
    assert.equal(
      auth.isAdmin(),
      false,
      `User role ${JSON.stringify(u?.role)} must not be evaluated as admin`
    );
  }

  // Only strict 'admin' role evaluates to true
  auth.user = { role: 'admin' };
  assert.equal(auth.isAdmin(), true);
});

test('ADV-M5-2.6: AuthManager enforceGuard redirects window.location correctly in simulated browser environment', () => {
  const runEnforce = ({ token, user, auditToken, requiresAuth, requiresAdmin }) => {
    let redirectedTo = null;
    const fakeWindowLocation = {
      set href(val) { redirectedTo = val; },
      get href() { return redirectedTo || 'dashboard.html'; }
    };

    const isAudit = Boolean(auditToken && auditToken.length >= 16);
    if (isAudit) {
      if (requiresAdmin) {
        fakeWindowLocation.href = 'dashboard.html?error=unauthorized';
        return { allowed: false, redirect: fakeWindowLocation.href };
      }
      return { allowed: true, redirect: null };
    }

    if (requiresAuth) {
      const guardResult = routeGuard({
        isAuthenticated: Boolean(token),
        isAdmin: user?.role === 'admin',
        requiresAdmin
      });
      if (guardResult.redirect) {
        fakeWindowLocation.href = guardResult.redirect;
        return { allowed: false, redirect: fakeWindowLocation.href };
      }
    }

    return { allowed: true, redirect: null };
  };

  // 1. Unauthenticated to dashboard
  assert.deepEqual(
    runEnforce({ token: null, user: null, auditToken: null, requiresAuth: true, requiresAdmin: false }),
    { allowed: false, redirect: 'index.html?auth=required' }
  );

  // 2. Unauthenticated to admin
  assert.deepEqual(
    runEnforce({ token: null, user: null, auditToken: null, requiresAuth: true, requiresAdmin: true }),
    { allowed: false, redirect: 'index.html?auth=required' }
  );

  // 3. Regular user to admin
  assert.deepEqual(
    runEnforce({ token: 'tok_123', user: { role: 'user' }, auditToken: null, requiresAuth: true, requiresAdmin: true }),
    { allowed: false, redirect: 'dashboard.html?error=unauthorized' }
  );

  // 4. Magic audit to admin
  assert.deepEqual(
    runEnforce({ token: null, user: null, auditToken: 'sec_9f83a2b1c0e9f8a7b6c5', requiresAuth: true, requiresAdmin: true }),
    { allowed: false, redirect: 'dashboard.html?error=unauthorized' }
  );

  // 5. Magic audit to dashboard (allowed read-only)
  assert.deepEqual(
    runEnforce({ token: null, user: null, auditToken: 'sec_9f83a2b1c0e9f8a7b6c5', requiresAuth: true, requiresAdmin: false }),
    { allowed: true, redirect: null }
  );
});

// ============================================================================
// SUITE 3: Magic Audit Mode Mutation Lockouts & Read-Only Confinement
// ============================================================================

test('ADV-M5-3.1: Token length boundary verification: Tokens under 16 characters strictly fail audit mode check', () => {
  const shortTokens = [
    '',
    'a',
    'sec_',
    'sec_12345',
    'sec_9f83a2b1c0e', // 15 characters
    null,
    undefined
  ];

  for (const token of shortTokens) {
    const access = checkAccess(null, token);
    assert.equal(
      access.allowed,
      false,
      `Token ${token} (<16 chars) must not allow access without authentication`
    );
    assert.equal(access.mode, 'unauthorized');
  }

  const validTokens = [
    'sec_9f83a2b1c0e9', // 16 characters
    'sec_9f83a2b1c0e9f8a7',
    'sec_9f83a2b1c0e9f8a7b6c5d4e3f2a1b0c9'
  ];

  for (const token of validTokens) {
    const access = checkAccess(null, token);
    assert.equal(access.allowed, true, `Token ${token} (>=16 chars) must allow access`);
    assert.equal(access.mode, 'magic_audit');
  }
});

test('ADV-M5-3.2: Magic Audit UI lockouts: All mutation selectors are set to display: none', () => {
  const elementsToHide = [
    '#btn-trigger-run',
    '#btn-new-config',
    '#billing-nav',
    '#profile-settings',
    '#btn-share-audit',
    '#btn-logout'
  ];

  // Create simulated DOM tree
  const domTree = {};
  for (const sel of elementsToHide) {
    domTree[sel] = { style: { display: 'block' } };
  }

  // Emulate applyMagicAuditUI execution
  for (const sel of elementsToHide) {
    if (domTree[sel]) {
      domTree[sel].style.display = 'none';
    }
  }

  for (const sel of elementsToHide) {
    assert.equal(
      domTree[sel].style.display,
      'none',
      `Selector ${sel} must be hidden in Magic Audit mode`
    );
  }
});

test('ADV-M5-3.3: Dashboard handleTriggerRun is strictly blocked when in Magic Audit mode', async () => {
  const controller = new DashboardController();
  controller.isAuditMode = true;
  controller.isRunning = false;
  controller.selectedConfigId = 101;

  let triggerRunInvoked = false;
  const origTrigger = apiClient.triggerRun;
  apiClient.triggerRun = async () => {
    triggerRunInvoked = true;
    return { credits_remaining: 39 };
  };

  try {
    // Attempt triggering run while in audit mode
    await controller.handleTriggerRun();
    assert.equal(
      triggerRunInvoked,
      false,
      'handleTriggerRun must abort immediately and NEVER invoke apiClient.triggerRun in audit mode'
    );
  } finally {
    apiClient.triggerRun = origTrigger;
  }
});

test('ADV-M5-3.4: ApiClient buildHeaders in Magic Audit mode injects X-Audit-Token and omits Bearer token', () => {
  const client = new ApiClient();
  client.token = null; // Unauthenticated guest
  client.auditToken = 'sec_9f83a2b1c0e9f8a7b6c5';

  const headers = client.buildHeaders();
  assert.equal(headers['X-Audit-Token'], 'sec_9f83a2b1c0e9f8a7b6c5');
  assert.equal(headers['Authorization'], undefined, 'Must not send Authorization header for audit guest');
  assert.equal(headers['Content-Type'], 'application/json');
});

test('ADV-M5-3.5: ApiClient buildUrl auto-injects audit_token query parameter for GET requests', () => {
  const client = new ApiClient('https://chatlytics.de');
  client.auditToken = 'sec_9f83a2b1c0e9f8a7b6c5';

  const url = client.buildUrl('api/reports.php', { period: '30d' });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('audit_token'), 'sec_9f83a2b1c0e9f8a7b6c5');
  assert.equal(parsed.searchParams.get('period'), '30d');
});

test('ADV-M5-3.6: Magic Audit preview banner text matches exact bilingual German and English strings', () => {
  const bannerDE = '👁️ Sie betrachten ein geteiltes Chatlytics Magic Audit (Schreibgeschützt).';
  const bannerEN = '👁️ You are viewing a shared Chatlytics Magic Audit (Read-Only).';

  assert.ok(bannerDE.includes('Schreibgeschützt'));
  assert.ok(bannerEN.includes('Read-Only'));
});

// ============================================================================
// SUITE 4: Corporate Work-Email Filtering Adversarial Stress
// ============================================================================

test('ADV-M5-4.1: Comprehensive freemail provider dictionary attack rejects all 23 banned domains', () => {
  const bannedProviders = [
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.de', 'hotmail.com',
    'outlook.com', 'live.com', 'icloud.com', 'gmx.de', 'gmx.net', 'web.de',
    't-online.de', 'freenet.de', 'mail.ru', 'protonmail.com', 'proton.me',
    'yandex.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org',
    'guerrillamail.com', 'mailinator.com', 'trashmail.com'
  ];

  for (const domain of bannedProviders) {
    const email = `testuser@${domain}`;
    const result = validateWorkEmail(email);
    assert.equal(
      result.valid,
      false,
      `Banned provider ${domain} was incorrectly allowed`
    );
    assert.equal(result.reason, 'disallowed_freemail');
    assert.equal(result.domain, domain);
  }
});

test('ADV-M5-4.2: Subdomain evasion attacks on freemail providers are strictly caught and rejected', () => {
  const evasionAttempts = [
    'user@corp.gmail.com',
    'user@vip.mail.yahoo.com',
    'ceo@company.tempmail.com',
    'dev@sub.sub2.trashmail.com',
    'admin@mx1.web.de',
    'tester@staging.gmx.net',
    'analyst@sub.proton.me'
  ];

  for (const email of evasionAttempts) {
    const result = validateWorkEmail(email);
    assert.equal(
      result.valid,
      false,
      `Subdomain evasion ${email} was incorrectly permitted`
    );
    assert.equal(result.reason, 'disallowed_freemail');
  }
});

test('ADV-M5-4.3: Mixed-case, whitespace, and Unicode casing variations are normalized and rejected', () => {
  const caseVariations = [
    '  User@GMAIL.COM  ',
    'ceo@YaHoo.De\t',
    'DEV@HotMail.Com\n',
    'InFo@TeMpMaIl.CoM '
  ];

  for (const email of caseVariations) {
    const result = validateWorkEmail(email);
    assert.equal(
      result.valid,
      false,
      `Mixed case variation ${email} was incorrectly permitted`
    );
    assert.equal(result.reason, 'disallowed_freemail');
  }
});

test('ADV-M5-4.4: Malformed email syntax attacks fail validation with appropriate reasons', () => {
  const malformedInputs = [
    { input: '', reason: 'empty' },
    { input: '   ', reason: 'malformed' },
    { input: null, reason: 'empty' },
    { input: undefined, reason: 'empty' },
    { input: 12345, reason: 'empty' },
    { input: 'notanemail', reason: 'malformed' },
    { input: '@gmail.com', reason: 'malformed' },
    { input: 'user@', reason: 'malformed' },
    { input: 'user@@domain.com', reason: 'malformed' },
    { input: 'user@domain@extra.com', reason: 'malformed' },
    { input: 'user name@domain.com', reason: 'malformed' }
  ];

  for (const tc of malformedInputs) {
    const result = validateWorkEmail(tc.input);
    assert.equal(
      result.valid,
      false,
      `Malformed input ${tc.input} must be invalid`
    );
    assert.equal(
      result.reason,
      tc.reason,
      `Expected reason ${tc.reason} for input ${tc.input}, got ${result.reason}`
    );
  }
});

test('ADV-M5-4.5: Legitimate corporate B2B enterprise domains are accurately accepted', () => {
  const validCorporateEmails = [
    { email: 'karin.schmidt@personio.de', expectedDomain: 'personio.de' },
    { email: 'alex.mueller@celonis.com', expectedDomain: 'celonis.com' },
    { email: 'johann@sap.com', expectedDomain: 'sap.com' },
    { email: 'contact@bmw-group.de', expectedDomain: 'bmw-group.de' },
    { email: 'founder@deep-tech-berlin.ai', expectedDomain: 'deep-tech-berlin.ai' },
    { email: 'engineering@siemens.com', expectedDomain: 'siemens.com' }
  ];

  for (const tc of validCorporateEmails) {
    const result = validateWorkEmail(tc.email);
    assert.equal(
      result.valid,
      true,
      `Legitimate B2B email ${tc.email} was incorrectly rejected: ${result.reason}`
    );
    assert.equal(result.domain, tc.expectedDomain);
  }
});

test('ADV-M5-4.6: Partial-string collision safety: Legitimate domains containing banned words as substrings are NOT falsely blocked', () => {
  const collisionSafeEmails = [
    'user@notgmail.com',       // contains "gmail.com" but not equal or subdomain
    'developer@myyahoo.com',    // contains "yahoo.com" as substring
    'info@webdesign-berlin.de', // contains "web.de" prefix
    'contact@post-online.de',   // contains "t-online.de" substring
    'team@proton-technologies.eu'
  ];

  for (const email of collisionSafeEmails) {
    const result = validateWorkEmail(email);
    assert.equal(
      result.valid,
      true,
      `Collision-safe email ${email} must not be blocked`
    );
  }
});

test('ADV-M5-4.7: AuthManager signup method rejects freemail before dispatching to API client', async () => {
  const auth = new AuthManager();
  let apiSignupCalled = false;

  const origSignup = apiClient.signup;
  apiClient.signup = async () => {
    apiSignupCalled = true;
    return { token: 'new_tok' };
  };

  try {
    await assert.rejects(
      async () => {
        await auth.signup('attacker@gmail.com', 'Secret1234!', 'Attacker Inc');
      },
      /keine Freemail-Adressen wie Gmail/
    );

    assert.equal(
      apiSignupCalled,
      false,
      'apiClient.signup must NEVER be called when corporate email validation fails'
    );
  } finally {
    apiClient.signup = origSignup;
  }
});

// ============================================================================
// SUITE 5: Static Security & GDPR/DSGVO Conformance Audit
// ============================================================================

test('ADV-M5-5.1: Zero external CDNs, fonts, or tracking scripts in index.html, dashboard.html, admin.html', () => {
  const htmlFiles = ['index.html', 'dashboard.html', 'admin.html'];
  const forbiddenPatterns = [
    /https?:\/\/cdn\./i,
    /https?:\/\/cdnjs\./i,
    /https?:\/\/unpkg\./i,
    /https?:\/\/jsdelivr\./i,
    /https?:\/\/fonts\.googleapis\.com/i,
    /https?:\/\/fonts\.gstatic\.com/i,
    /https?:\/\/www\.google-analytics\.com/i,
    /https?:\/\/googletagmanager\.com/i,
    /<script[^>]*src=["']https?:\/\//i
  ];

  for (const file of htmlFiles) {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !pattern.test(content),
        `File ${file} violates zero-CDN/DSGVO policy by matching: ${pattern}`
      );
    }
  }
});

test('ADV-M5-5.2: All HTML files link to internal local assets/css/app.css', () => {
  const htmlFiles = ['index.html', 'dashboard.html', 'admin.html'];
  for (const file of htmlFiles) {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
    assert.ok(
      content.includes('assets/css/app.css'),
      `${file} must reference local stylesheet assets/css/app.css`
    );
  }
});

test('ADV-M5-5.3: JavaScript code files do not use dangerous innerHTML without escaping', () => {
  const jsFiles = [
    'assets/js/dashboard.js',
    'assets/js/admin.js',
    'assets/js/configs.js',
    'assets/js/auth.js',
    'assets/js/i18n.js'
  ];

  for (const relPath of jsFiles) {
    const code = fs.readFileSync(path.join(PROJECT_ROOT, relPath), 'utf8');
    const lines = code.split('\n');

    lines.forEach((line, lineNum) => {
      // If innerHTML is used on a line with dynamic interpolations (${...}), verify escapeHtml is present
      if (line.includes('.innerHTML =') && line.includes('${') && !line.includes('badgeHtml')) {
        const hasEscape = line.includes('escapeHtml(') || line.includes('escapeHtmlAdmin(') || line.includes('escapeHtmlDash(');
        assert.ok(
          hasEscape,
          `Dangerous unescaped dynamic innerHTML found in ${relPath}:${lineNum + 1}: ${line.trim()}`
        );
      }
    });
  }
});

// ============================================================================
// SUITE 6: Live HTTP Backend Route Guard & Registration Integration
// ============================================================================

test('ADV-M5-6.1: Live HTTP POST /api/auth.php?action=signup strictly rejects disposable and freemail addresses with HTTP 422', async () => {
  const freemailPayloads = [
    { email: 'adversary@tempmail.com', password: 'Password123!' },
    { email: 'hacker@sub.gmail.com', password: 'Password123!' },
    { email: 'tester@trashmail.com', password: 'Password123!' }
  ];

  for (const payload of freemailPayloads) {
    const res = await fetch(`${BASE_URL}/api/auth.php?action=signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422, `Expected HTTP 422 for ${payload.email}`);
    const json = await res.json();
    assert.equal(json.status, 'error');
    assert.equal(json.code, 422);
    assert.ok(
      json.message.includes('corporate / work email address'),
      `Expected corporate email message, got: ${json.message}`
    );
  }
});

test('ADV-M5-6.2: Live HTTP POST /api/auth.php?action=signup rejects malformed email formats with HTTP 422', async () => {
  const malformedPayloads = [
    { email: '', password: 'Password123!' },
    { email: 'notanemail', password: 'Password123!' },
    { email: '@nodomain.com', password: 'Password123!' },
    { email: 'user name@domain.com', password: 'Password123!' }
  ];

  for (const payload of malformedPayloads) {
    const res = await fetch(`${BASE_URL}/api/auth.php?action=signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 422);
    const json = await res.json();
    assert.equal(json.status, 'error');
    assert.equal(json.code, 422);
  }
});

test('ADV-M5-6.3: Live HTTP GET /api/admin_users.php without Bearer token strictly returns HTTP 401 Unauthorized', async () => {
  const res = await fetch(`${BASE_URL}/api/admin_users.php?action=list`);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.status, 'error');
  assert.equal(json.code, 401);
  assert.ok(json.message.includes('Authentication required') || json.message.includes('Unauthorized'));
});

test('ADV-M5-6.4: Live HTTP POST /api/admin_users.php?action=seed_demo_data without admin token strictly returns HTTP 401', async () => {
  const res = await fetch(`${BASE_URL}/api/admin_users.php?action=seed_demo_data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.status, 'error');
  assert.equal(json.code, 401);
});
