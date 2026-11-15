/**
 * tests/tier1_features/f32_run_feedback_ux.test.js
 * Feature 32: Consequential Action Confirmation, Dual Run-Lock Cooldown & Live Progress Feedback
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const API_DIR = path.join(PROJECT_ROOT, 'api');
const JS_DIR = path.join(PROJECT_ROOT, 'assets/js');

async function startTempPhpServer(routerPhpPath) {
  return await new Promise((resolve, reject) => {
    const port = 36000 + Math.floor(Math.random() * 9000);
    const proc = spawn(
      'php',
      ['-d', 'extension=pdo_sqlite', '-d', 'extension=sqlite3', '-S', `127.0.0.1:${port}`, routerPhpPath],
      { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stderrBuf = '';
    proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Timed out waiting for temp PHP server (${stderrBuf})`));
    }, 6000);

    const checkReady = async () => {
      for (let i = 0; i < 40; i++) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/__ping`);
          if (r.ok) {
            clearTimeout(timeout);
            resolve({ proc, baseUrl: `http://127.0.0.1:${port}` });
            return;
          }
        } catch {}
        await new Promise(r => setTimeout(r, 80));
      }
    };
    checkReady();
  });
}

async function startMockWebhookServer() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { received.push(JSON.parse(body)); } catch { received.push(body); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'queued' }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}/webhook/chatlytics-run`,
    received,
    close() {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      return new Promise(resolve => server.close(resolve));
    }
  };
}

function createFakeClassList(initial = []) {
  const set = new Set(initial.filter(Boolean));
  return {
    add: (...cls) => cls.forEach(c => set.add(c)),
    remove: (...cls) => cls.forEach(c => set.delete(c)),
    contains: (c) => set.has(c),
    toggle: (c, force) => {
      if (force === undefined) {
        if (set.has(c)) { set.delete(c); return false; }
        set.add(c); return true;
      }
      if (force) set.add(c); else set.delete(c);
      return Boolean(force);
    },
    toString: () => [...set].join(' ')
  };
}

function createFakeElement(tagName = 'div', id = '', initialClasses = []) {
  const listeners = new Map();
  const attrs = new Map();
  const children = [];
  let _className = initialClasses.join(' ');
  const classList = createFakeClassList(initialClasses);

  const el = {
    tagName: tagName.toUpperCase(),
    id,
    disabled: false,
    hidden: false,
    textContent: '',
    innerHTML: '',
    href: '',
    type: '',
    dataset: {},
    children,
    classList,
    get className() {
      return _className || classList.toString();
    },
    set className(val) {
      _className = String(val || '');
      const next = createFakeClassList(_className.split(/\s+/));
      el.classList = next;
    },
    get firstChild() {
      return children[0] || null;
    },
    appendChild(child) {
      children.push(child);
      child.parentNode = el;
      return child;
    },
    replaceChildren(...nodes) {
      children.length = 0;
      nodes.forEach(n => el.appendChild(n));
    },
    remove() {
      if (el.parentNode && Array.isArray(el.parentNode.children)) {
        const idx = el.parentNode.children.indexOf(el);
        if (idx >= 0) el.parentNode.children.splice(idx, 1);
      }
    },
    setAttribute(k, v) {
      attrs.set(k, String(v));
      if (k === 'id') el.id = String(v);
      if (k === 'class') el.className = String(v);
    },
    getAttribute(k) {
      return attrs.get(k) ?? null;
    },
    removeAttribute(k) {
      attrs.delete(k);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    async trigger(type, event = {}) {
      const fns = listeners.get(type) || [];
      for (const fn of fns) {
        await fn({ preventDefault() {}, currentTarget: el, ...event });
      }
    },
    querySelector(sel) {
      if (sel === '.modal-backdrop') return el._backdrop || null;
      return null;
    },
    focus() {
      el.focused = true;
    },
    scrollIntoView() {}
  };
  return el;
}

function buildDashboardMockEnv() {
  const storageMap = new Map();
  const localMap = new Map();

  const elements = new Map();
  const register = (id, tag = 'div', classes = []) => {
    const el = createFakeElement(tag, id, classes);
    elements.set(id, el);
    return el;
  };

  const btnTrigger = register('btn-trigger-run', 'button', ['btn', 'btn-primary']);
  btnTrigger.innerHTML = '<svg></svg>Abfrage starten';
  const btnEmpty = register('btn-empty-trigger', 'button', ['btn', 'btn-primary']);
  btnEmpty.innerHTML = 'Ersten Audit-Run starten';
  const btnToggle = register('btn-toggle-config-status', 'button', ['btn', 'btn-secondary']);
  btnToggle.textContent = 'Pausieren';

  register('header-credits-val', 'span').textContent = '40';
  register('run-status-banner', 'div', ['run-status-banner', 'hidden']);
  register('run-status-indicator', 'span');
  register('run-status-title', 'div');
  register('run-status-detail', 'div');
  register('run-status-badge', 'span');
  register('run-status-dismiss', 'button');

  const confirmModal = register('action-confirm-modal', 'div', ['modal', 'modal-hidden']);
  confirmModal._backdrop = createFakeElement('div', '', ['modal-backdrop']);
  register('confirm-modal-title', 'h3');
  register('confirm-modal-message', 'p');
  register('confirm-modal-summary', 'div');
  register('confirm-modal-warning', 'div');
  register('confirm-modal-close', 'button');
  register('confirm-modal-cancel', 'button');
  register('confirm-modal-submit', 'button', ['btn', 'btn-primary']);
  register('toast-container', 'div', ['toast-container']);

  const body = createFakeElement('body');
  const docListeners = new Map();

  global.sessionStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k)
  };
  global.localStorage = {
    getItem: (k) => (localMap.has(k) ? localMap.get(k) : null),
    setItem: (k, v) => localMap.set(k, String(v)),
    removeItem: (k) => localMap.delete(k)
  };
  global.window = global;
  global.addEventListener = () => {};
  global.document = {
    body,
    activeElement: null,
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => createFakeElement(tag),
    querySelectorAll: () => [],
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    }
  };

  return { elements, storageMap, btnTrigger, btnEmpty, btnToggle };
}

test('Feature 32.1: trigger_run.php returns expected_runs/llm_count/prompt_count & reports.php?action=run_status polls tenant-scoped progress safely under HY093', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlytics-f32-'));
  const dbPath = path.join(tmpDir, 'f32.sqlite').replace(/\\/g, '/');
  const routerPath = path.join(tmpDir, 'router.php');
  const webhook = await startMockWebhookServer();
  let server = null;

  try {
    fs.writeFileSync(routerPath, `<?php
if ($_SERVER['REQUEST_URI'] === '/__ping') {
  header('Content-Type: text/plain');
  echo 'ok';
  exit;
}
require_once '${API_DIR.replace(/\\/g, '/')}/bootstrap.php';
require_once '${API_DIR.replace(/\\/g, '/')}/db.php';

$cfg = Config::get();
$cfg['n8n']['webhook_url'] = '${webhook.url}';
$cfg['n8n']['shared_secret'] = 'f32_test_secret';
Config::set($cfg);

$pdo = new PDO('sqlite:${dbPath}');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->sqliteCreateFunction('NOW', function() { return date('Y-m-d H:i:s'); });
Database::setConnection($pdo);

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (strpos($path, '/api/trigger_run.php') !== false) {
  require '${API_DIR.replace(/\\/g, '/')}/trigger_run.php';
  exit;
}
if (strpos($path, '/api/reports.php') !== false) {
  require '${API_DIR.replace(/\\/g, '/')}/reports.php';
  exit;
}
http_response_code(404);
`, 'utf8');

    const initPhp = `
      $pdo = new PDO('sqlite:${dbPath}');
      $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $pdo->exec("
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          company_name TEXT NULL,
          role TEXT DEFAULT 'user',
          tier TEXT DEFAULT 'starter',
          credits_remaining INTEGER DEFAULT 40,
          status TEXT DEFAULT 'active',
          api_key TEXT NULL,
          magic_audit_token TEXT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE tracking_configs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          brand_name TEXT NOT NULL,
          brand_domains TEXT NOT NULL,
          keywords_prompts TEXT NOT NULL,
          competitors TEXT NOT NULL,
          target_llms TEXT NOT NULL,
          search_enabled INTEGER DEFAULT 1,
          schedule_interval TEXT DEFAULT 'daily',
          status TEXT DEFAULT 'active',
          last_run_at DATETIME NULL,
          next_run_at DATETIME NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE llm_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          config_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          prompt TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT 'openai',
          model TEXT NOT NULL DEFAULT 'gpt-6-luna',
          brand_name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'completed',
          raw_prompt_payload TEXT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users (id, email, password_hash, company_name, role, tier, credits_remaining, status, api_key, magic_audit_token) VALUES
          (1, 'alice@acme.de', 'h', 'Acme GmbH', 'user', 'starter', 25, 'active', 'alice_tok_f32', 'audit_tok_f32_1234567890'),
          (2, 'bob@other.de', 'h', 'Other GmbH', 'user', 'starter', 25, 'active', 'bob_tok_f32', NULL);
      ");
      $stmt = $pdo->prepare("INSERT INTO tracking_configs (id, user_id, name, brand_name, brand_domains, keywords_prompts, competitors, target_llms, search_enabled, schedule_interval, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'daily', 'active')");
      $stmt->execute([10, 1, 'Multi Matrix', 'Acme', '["acme.de"]', '["Prompt A","Prompt B"]', '["Comp"]', '["openai","gemini","mistral"]']);
    `;
    const initRes = spawnSync('php', ['-d', 'extension=pdo_sqlite', '-d', 'extension=sqlite3', '-r', initPhp], { encoding: 'utf8' });
    assert.equal(initRes.status, 0, initRes.stderr || initRes.stdout);

    server = await startTempPhpServer(routerPath);

    // 1. trigger_run.php returns exact 2 prompts x 3 LLMs = 6 expected_runs
    const trigRes = await fetch(`${server.baseUrl}/api/trigger_run.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer alice_tok_f32'
      },
      body: JSON.stringify({ config_id: 10, response_mode: 'async' })
    });
    assert.equal(trigRes.status, 200);
    const trigJson = await trigRes.json();
    const runData = trigJson.data || trigJson;
    assert.match(runData.run_id, /^run_[0-9]+_[a-f0-9]+$/);
    assert.equal(runData.expected_runs, 6);
    assert.equal(runData.llm_count, 3);
    assert.equal(runData.prompt_count, 2);
    assert.equal(runData.credits_deducted, 6);
    assert.equal(runData.credits_remaining, 19);

    // 2. Poll initially -> 0 ingested
    const poll0 = await fetch(`${server.baseUrl}/api/reports.php?action=run_status&run_id=${encodeURIComponent(runData.run_id)}`, {
      headers: { 'Authorization': 'Bearer alice_tok_f32' }
    });
    assert.equal(poll0.status, 200);
    const poll0Data = (await poll0.json()).data;
    assert.equal(poll0Data.ingested_count, 0);
    assert.equal(poll0Data.completed_count, 0);

    // 3. Insert 3 ingested rows for Alice's run_id (2 completed, 1 failed) + 1 unrelated row with malformed JSON
    const seedRunPhp = `
      $pdo = new PDO('sqlite:${dbPath}');
      $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $ins = $pdo->prepare("INSERT INTO llm_runs (config_id, user_id, prompt, status, raw_prompt_payload) VALUES (?, ?, ?, ?, ?)");
      $payload = json_encode(['run_id' => '${runData.run_id}']);
      $ins->execute([10, 1, 'Prompt A', 'completed', $payload]);
      $ins->execute([10, 1, 'Prompt A', 'completed', $payload]);
      $ins->execute([10, 1, 'Prompt B', 'failed', $payload]);
      $ins->execute([10, 1, 'Legacy Row', 'completed', 'not-valid-json']);
    `;
    const seedRes = spawnSync('php', ['-d', 'extension=pdo_sqlite', '-d', 'extension=sqlite3', '-r', seedRunPhp], { encoding: 'utf8' });
    assert.equal(seedRes.status, 0, seedRes.stderr || seedRes.stdout);

    // 4. Alice sees exact 3 ingested (2 completed, 1 failed); malformed row safely skipped
    const poll1 = await fetch(`${server.baseUrl}/api/reports.php?action=run_status&run_id=${encodeURIComponent(runData.run_id)}`, {
      headers: { 'Authorization': 'Bearer alice_tok_f32' }
    });
    assert.equal(poll1.status, 200);
    const poll1Data = (await poll1.json()).data;
    assert.equal(poll1Data.ingested_count, 3);
    assert.equal(poll1Data.completed_count, 2);
    assert.equal(poll1Data.failed_count, 1);

    // 5. Bob (other tenant) sees 0 for Alice's run_id (tenant isolation)
    const bobPoll = await fetch(`${server.baseUrl}/api/reports.php?action=run_status&run_id=${encodeURIComponent(runData.run_id)}`, {
      headers: { 'Authorization': 'Bearer bob_tok_f32' }
    });
    assert.equal(bobPoll.status, 200);
    const bobData = (await bobPoll.json()).data;
    assert.equal(bobData.ingested_count, 0);

    // 6. Invalid run_id format rejected with 422; Magic Audit token rejected with 403
    const badId = await fetch(`${server.baseUrl}/api/reports.php?action=run_status&run_id=bad_id!`, {
      headers: { 'Authorization': 'Bearer alice_tok_f32' }
    });
    assert.equal(badId.status, 422);

    const auditBlocked = await fetch(`${server.baseUrl}/api/reports.php?action=run_status&run_id=${encodeURIComponent(runData.run_id)}&audit_token=audit_tok_f32_1234567890`);
    assert.equal(auditBlocked.status, 403);
  } finally {
    if (server?.proc) { await new Promise((r) => { if (server.proc.exitCode !== null) return r(); server.proc.once("close", r); server.proc.kill(); setTimeout(r, 300); }); }
    await webhook.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Feature 32.2: DashboardController enforces confirm modal, dual-button cooldown lock, sessionStorage restore, and early poll unlock', async () => {
  const env = buildDashboardMockEnv();
  const { DashboardController } = await import('../../assets/js/dashboard.js');
  const { configs } = await import('../../assets/js/configs.js');
  const { apiClient } = await import('../../assets/js/api-client.js');

  const origLoadReports = apiClient.getReports.bind(apiClient);
  const origTriggerRun = apiClient.triggerRun.bind(apiClient);
  const origGetRunStatus = apiClient.getRunStatus.bind(apiClient);
  const origToggleConfig = configs.toggleConfigStatus.bind(configs);

  let triggerCalls = 0;
  let pollCalls = 0;
  let ingestedMock = 0;
  let toggleCalls = 0;

  try {
    configs.configs = [
      {
        id: 10,
        name: 'Acme Core',
        brand_name: 'Acme',
        keywords_prompts: ['P1', 'P2'],
        target_llms: ['openai', 'gemini', 'mistral'],
        status: 'active',
        schedule_interval: 'every_120m',
        initial_test_used: 0,
        full_started_at: null
      },
      {
        id: 11,
        name: 'Acme Untested',
        brand_name: 'Acme',
        keywords_prompts: ['P1', 'P2'],
        target_llms: ['openai', 'gemini', 'mistral'],
        status: 'active',
        schedule_interval: 'every_120m',
        initial_test_used: 0,
        full_started_at: null
      }
    ];

    apiClient.getReports = async () => ({ metrics: { total_runs: 12 }, timeline: [] });
    apiClient.triggerRun = async () => {
      triggerCalls++;
      return {
        status: 'queued',
        run_id: 'run_1700000000_abcdef1',
        expected_runs: 6,
        credits_deducted: 6,
        credits_remaining: 34
      };
    };
    apiClient.getRunStatus = async () => {
      pollCalls++;
      return {
        run_id: 'run_1700000000_abcdef1',
        ingested_count: ingestedMock,
        completed_count: ingestedMock,
        failed_count: 0
      };
    };
    configs.toggleConfigStatus = async (cfg) => {
      toggleCalls++;
      cfg.status = cfg.status === 'paused' ? 'active' : 'paused';
      return cfg;
    };

    let loadDashboardCalls = 0;
    const ctrl = new DashboardController();
    ctrl.selectedConfigId = 10;
    ctrl.updateCreditBadge(40);
    ctrl.loadDashboard = async () => { loadDashboardCalls++; };
    ctrl.setupEventListeners();

    // 1. Clicking trigger opens confirm modal instead of immediately calling API
    await ctrl.requestTriggerRun(env.btnTrigger);
    assert.equal(triggerCalls, 0);
    const modal = env.elements.get('action-confirm-modal');
    const confirmSubmit = env.elements.get('confirm-modal-submit');
    assert.equal(modal.classList.contains('modal-hidden'), false);
    assert.equal(confirmSubmit.disabled, false);

    // 2. Confirm dispatches run once, locks BOTH #btn-trigger-run & #btn-empty-trigger, persists sessionStorage
    await confirmSubmit.trigger('click');
    assert.equal(triggerCalls, 1);
    assert.equal(env.btnTrigger.disabled, true);
    assert.equal(env.btnEmpty.disabled, true);
    assert.equal(ctrl.getAvailableCredits(), 34);
    assert.equal(env.elements.get('run-status-banner').classList.contains('hidden'), false);
    assert.ok(env.storageMap.get('chatlytics_active_run'));

    // 3. Attempting rapid extra clicks while locked does NOT fire a second run
    await ctrl.requestTriggerRun(env.btnTrigger);
    await ctrl.requestTriggerRun(env.btnEmpty);
    assert.equal(triggerCalls, 1);

    // 4. Reload persistence: fresh controller reads sessionStorage and immediately locks both buttons
    ctrl.clearRunTimers();
    const ctrl2 = new DashboardController();
    ctrl2.selectedConfigId = 10;
    ctrl2.loadDashboard = async () => { loadDashboardCalls++; };
    ctrl2.setupConfirmAndBannerListeners();
    await ctrl2.restoreActiveRunTracking();
    assert.equal(env.btnTrigger.disabled, true);
    assert.equal(env.btnEmpty.disabled, true);
    assert.ok(ctrl2.cooldownUntil > Date.now());

    // 5. Partial ingestion keeps buttons locked and updates progress count
    ingestedMock = 2;
    await ctrl2.pollRunStatus();
    assert.ok(pollCalls >= 1);
    assert.equal(env.btnTrigger.disabled, true);
    assert.match(env.elements.get('run-status-detail').textContent, /2 \/ 6/);

    // 6. Full ingestion clears active cooldown/sessionStorage and keeps test-run buttons locked under Flow B
    ingestedMock = 6;
    await ctrl2.pollRunStatus();
    assert.ok(loadDashboardCalls >= 2, 'Dashboard should refresh upon partial progress and final completion');
    assert.equal(ctrl2.getTestRunLockReason(configs.configs[0]), 'test_used');
    assert.equal(env.btnTrigger.disabled, true);
    assert.equal(env.btnEmpty.disabled, true);
    assert.equal(ctrl2.cooldownUntil, 0);
    assert.equal(env.storageMap.has('chatlytics_active_run'), false);
    assert.equal(env.elements.get('run-status-banner').classList.contains('is-complete'), true);
    ctrl2.clearRunTimers();

    // 7. Switching to untested config unlocks trigger CTA; insufficient credits disables Confirm CTA cleanly
    ctrl2.selectedConfigId = 11;
    ctrl2.syncRunButtonsState();
    assert.equal(env.btnTrigger.disabled, false);
    ctrl2.updateCreditBadge(3);
    await ctrl2.requestTriggerRun(env.btnTrigger);
    assert.equal(env.elements.get('confirm-modal-submit').disabled, true);
    assert.equal(env.elements.get('confirm-modal-warning').hidden, false);
    ctrl2.closeConfirmModal();

    // 8. Pausing config requires modal confirmation before mutating
    await env.btnToggle.trigger('click');
    assert.equal(toggleCalls, 0);
    assert.equal(modal.classList.contains('modal-hidden'), false);
    await env.elements.get('confirm-modal-submit').trigger('click');
    assert.equal(toggleCalls, 1);
  } finally {
    apiClient.getReports = origLoadReports;
    apiClient.triggerRun = origTriggerRun;
    apiClient.getRunStatus = origGetRunStatus;
    configs.toggleConfigStatus = origToggleConfig;
  }
});

test('Feature 32.3: Static security & UX parity audit across notifications.js, dashboard.js, and dashboard.html', () => {
  const dashJs = fs.readFileSync(path.join(JS_DIR, 'dashboard.js'), 'utf8');
  const notifyJs = fs.readFileSync(path.join(JS_DIR, 'notifications.js'), 'utf8');
  const dashHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'dashboard.html'), 'utf8');

  assert.equal(/\balert\s*\(/.test(dashJs), false, 'Native alert() must not exist in dashboard.js');
  assert.equal(/\.innerHTML\s*=/.test(notifyJs), false, 'notifications.js must never assign innerHTML');
  assert.ok(dashHtml.includes('id="run-status-banner"'), 'dashboard.html must contain #run-status-banner');
  assert.ok(dashHtml.includes('id="action-confirm-modal"'), 'dashboard.html must contain #action-confirm-modal');
  assert.ok(dashHtml.includes('id="toast-container"'), 'dashboard.html must contain #toast-container');
});
