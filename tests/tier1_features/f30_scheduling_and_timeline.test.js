/**
 * tests/tier1_features/f30_scheduling_and_timeline.test.js
 * Feature 30: High-Frequency Scheduling (12x daily -> 1x weekly) & Time-Series Comparison Visualization
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const API_DIR = path.join(PROJECT_ROOT, 'api');

const SQLITE_SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    company_name TEXT NULL,
    role TEXT DEFAULT 'user',
    tier TEXT DEFAULT 'free',
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
    schedule_interval TEXT DEFAULT 'every_120m',
    datasets_per_day INTEGER DEFAULT 12,
    status TEXT DEFAULT 'active',
    initial_test_used INTEGER DEFAULT 0,
    full_started_at DATETIME NULL,
    last_run_at DATETIME NULL,
    next_run_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE llm_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    custom_id TEXT NULL,
    batch_id TEXT NULL,
    execution_strategy TEXT NOT NULL DEFAULT 'prompt_caching',
    prompt_cache_key TEXT NULL,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    is_test_run INTEGER NOT NULL DEFAULT 0,
    prompt TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'openai',
    model TEXT NOT NULL DEFAULT 'gpt-6-luna',
    brand_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'completed',
    brand_mentioned INTEGER DEFAULT 0,
    brand_prominence_rank INTEGER NULL,
    char_earliness INTEGER NULL,
    word_earliness INTEGER NULL,
    relative_position_pct REAL NULL,
    total_chars INTEGER DEFAULT 0,
    total_words INTEGER DEFAULT 0,
    mece_category TEXT NOT NULL DEFAULT '4_GENERIC',
    geo_quadrant TEXT NOT NULL DEFAULT 'NONE',
    has_citations INTEGER DEFAULT 0,
    brand_cited INTEGER DEFAULT 0,
    competitor_cited INTEGER DEFAULT 0,
    raw_prompt_payload TEXT NULL,
    raw_response_text TEXT NULL,
    raw_response_payload TEXT NULL,
    error_message TEXT NULL,
    run_duration_ms INTEGER NULL,
    cost_credits INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE run_competitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    competitor_name TEXT NOT NULL,
    competitor_domain TEXT NULL,
    mentioned INTEGER DEFAULT 1,
    char_earliness INTEGER NULL,
    word_earliness INTEGER NULL,
    relative_position_pct REAL NULL,
    prominence_rank INTEGER NULL,
    recommended INTEGER DEFAULT 0,
    sentiment TEXT DEFAULT 'neutral',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE run_citations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    citation_url TEXT NULL,
    citation_domain TEXT NOT NULL,
    citation_title TEXT NULL,
    is_brand_domain INTEGER DEFAULT 0,
    is_competitor_domain INTEGER DEFAULT 0,
    citation_index INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE batch_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    custom_id TEXT UNIQUE NOT NULL,
    prompt_cache_key TEXT NULL DEFAULT NULL,
    execution_strategy TEXT NOT NULL DEFAULT 'prompt_caching',
    provider_batch_id TEXT NULL DEFAULT NULL,
    run_id INTEGER NULL DEFAULT NULL,
    user_id INTEGER NOT NULL,
    config_id INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    brand_name TEXT NOT NULL,
    brand_domains TEXT NOT NULL,
    competitors TEXT NOT NULL,
    search_enabled INTEGER NOT NULL DEFAULT 1,
    is_test_run INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
    scheduled_for DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at DATETIME NULL DEFAULT NULL,
    completed_at DATETIME NULL DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

function runPhp(phpCode, env = {}) {
  const fullScript = `<?php
error_reporting(E_ALL);
ini_set('display_errors', '1');
${phpCode}
`;
  const res = spawnSync('php', ['-d', 'extension=pdo_sqlite', '-d', 'extension=sqlite3', '-d', 'log_errors=1', '-d', 'error_log=php://stderr'], {
    cwd: PROJECT_ROOT,
    input: fullScript,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 15000
  });

  let parsed = null;
  const stdout = (res.stdout || '').trim();
  if (stdout) {
    try {
      parsed = JSON.parse(stdout);
    } catch {
      const m = stdout.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch {}
      }
    }
  }

  return {
    status: res.status,
    stdout,
    stderr: (res.stderr || '').trim(),
    parsed
  };
}

async function startTempPhpServer(routerPhpPath) {
  return await new Promise((resolve, reject) => {
    const port = 34000 + Math.floor(Math.random() * 10000);
    const proc = spawn(
      'php',
      ['-d', 'extension=pdo_sqlite', '-d', 'extension=sqlite3', '-S', `127.0.0.1:${port}`, routerPhpPath],
      { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Timed out waiting for temporary PHP server'));
    }, 6000);

    const checkReady = async () => {
      for (let i = 0; i < 30; i++) {
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

test('Feature 30.1: Frontend schedule helpers compute exact 4-tier frequencies, tier locks, and credit projections', async () => {
  const cfgMod = await import('../../assets/js/configs.js');

  assert.equal(cfgMod.getScheduleRunsPerDay('every_120m'), 12);
  assert.equal(cfgMod.getScheduleRunsPerDay('every_60m'), 24);
  assert.equal(cfgMod.getScheduleRunsPerDay('every_30m'), 48);
  assert.equal(cfgMod.getScheduleRunsPerDay('every_15m'), 96);
  // Legacy schedule tokens map to 4-tier equivalents
  assert.equal(cfgMod.getScheduleRunsPerDay('every_2h'), 12);
  assert.equal(cfgMod.getScheduleRunsPerDay('daily'), 12);

  assert.equal(cfgMod.isHighFrequencySchedule('every_120m'), false);
  assert.equal(cfgMod.isHighFrequencySchedule('every_60m'), true);
  assert.equal(cfgMod.isHighFrequencySchedule('every_30m'), true);
  assert.equal(cfgMod.isHighFrequencySchedule('every_15m'), true);

  assert.equal(cfgMod.canUserUseScheduleInterval({ tier: 'free', role: 'user' }, 'every_120m'), true);
  assert.equal(cfgMod.canUserUseScheduleInterval({ tier: 'free', role: 'user' }, 'every_60m'), false);
  assert.equal(cfgMod.canUserUseScheduleInterval({ tier: 'free', role: 'user' }, 'every_30m'), false);
  assert.equal(cfgMod.canUserUseScheduleInterval({ tier: 'free', role: 'user' }, 'every_15m'), false);
  assert.equal(cfgMod.canUserUseScheduleInterval({ tier: 'starter', role: 'user' }, 'every_60m'), true);
  assert.equal(cfgMod.canUserUseScheduleInterval({ tier: 'free', role: 'admin' }, 'every_15m'), true);

  const est = cfgMod.calculateEstimatedCredits(3, 4, 'every_120m');
  assert.equal(est.perRun, 12);
  assert.equal(est.runsPerDay, 12);
  assert.equal(est.perDay, 144);
  assert.equal(est.perMonth, 4320);

  const precisionEst = cfgMod.calculateEstimatedCredits(2, 2, 'every_15m');
  assert.equal(precisionEst.perRun, 4);
  assert.equal(precisionEst.runsPerDay, 96);
  assert.equal(precisionEst.perDay, 384);
});

test('Feature 30.2: Dashboard timeline helpers align sparse comparison slots without false zero drops', async () => {
  const dashMod = await import('../../assets/js/dashboard.js');

  const aligned = dashMod.buildTimelineAlignedSeries(
    [
      { slot_index: 1, date_point: '2026-11-02', som_score: 62.5, total_runs: 4 },
      { slot_index: 8, date_point: '2026-11-09', som_score: 75.0, total_runs: 4 }
    ],
    [
      { slot_index: 1, date_point: '2026-10-03', som_score: 40.0, total_runs: 4 },
      { slot_index: 8, date_point: '2026-10-10', som_score: 50.0, total_runs: 4 }
    ],
    10,
    'som_score'
  );

  assert.equal(aligned.length, 10);
  assert.equal(aligned[0].primaryValue, null);
  assert.equal(aligned[1].primaryValue, 62.5);
  assert.equal(aligned[2].primaryValue, null, 'Empty gap slot must stay null, never 0');
  assert.equal(aligned[8].primaryValue, 75.0);
  assert.equal(aligned[8].compareValue, 50.0);

  const dayTs = dashMod.computeSlotTimestamp('2026-11-01', 4, 'day');
  assert.equal(dashMod.formatTimelineAxisLabel(dayTs, 'day', 'de'), '05.11.');

  const modelSeries = dashMod.buildModelTimelineAlignedSeries(
    [
      { slot_index: 0, provider: 'openai', model: 'gpt-6-luna', som_score: 70 },
      { slot_index: 2, provider: 'openai', model: 'gpt-6-luna', som_score: 90 },
      { slot_index: 1, provider: 'gemini', model: 'gemini-3.5-flash', som_score: 50 }
    ],
    3,
    'som_score'
  );
  assert.equal(modelSeries.length, 2);
  const geminiSeries = modelSeries.find((s) => s.provider === 'gemini');
  const openaiSeries = modelSeries.find((s) => s.provider === 'openai');
  assert.equal(openaiSeries.slots[0].value, 70);
  assert.equal(openaiSeries.slots[1].value, null);
  assert.equal(openaiSeries.slots[2].value, 90);
  assert.equal(geminiSeries.slots[1].value, 50);

  const svgPath = dashMod.buildSvgLinePath([{ x: 10, y: 20 }, { x: 110, y: 40 }]);
  assert.equal(svgPath, 'M 10.00 20.00 L 110.00 40.00');
});

test('Feature 30.3: Static XSS guard and UI control presence in dashboard.html & JS modules', () => {
  const html = fs.readFileSync(path.join(PROJECT_ROOT, 'dashboard.html'), 'utf8');
  for (const requiredId of [
    'btn-edit-config',
    'btn-toggle-config-status',
    'period-comparison-bar',
    'custom-start-date',
    'custom-end-date',
    'compare-mode-select',
    'compare-start-date',
    'compare-end-date',
    'btn-apply-date-filters',
    'timeline-card',
    'timeline-metric-tabs',
    'timeline-svg-host',
    'timeline-tooltip',
    'cfg-tier-hint',
    'cfg-credit-preview'
  ]) {
    assert.ok(html.includes(`id="${requiredId}"`), `dashboard.html must contain #${requiredId}`);
  }

  for (const requiredFlowBId of [
    'btn-full-start-config',
    'first-day-banner',
    'timeline-prompt-select',
    'timeline-model-legend',
    'user-results-section'
  ]) {
    assert.ok(html.includes(`id="${requiredFlowBId}"`), `dashboard.html must contain #${requiredFlowBId}`);
  }

  for (const val of ['every_120m', 'every_60m', 'every_30m', 'every_15m']) {
    assert.ok(html.includes(`value="${val}"`), `dashboard.html #cfg-interval must have option ${val}`);
  }

  for (const removed of ['value="manual"', 'value="daily"', 'value="weekly"', 'data-period="24h"']) {
    assert.equal(html.includes(removed), false, `dashboard.html must not expose removed control ${removed}`);
  }

  for (const file of ['assets/js/configs.js', 'assets/js/dashboard.js']) {
    const lines = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (line.includes('.innerHTML =') && line.includes('${') && !line.includes('escapeHtml(') && !line.includes('badgeHtml')) {
        assert.fail(`Unsafe .innerHTML template interpolation at ${file}:${idx + 1}`);
      }
    });
  }
});

test('Feature 30.4: Backend scheduling tier-gating and immediate next_run_at via real SQLite HTTP router', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlytics-f30-'));
  const dbPath = path.join(tmpDir, 'test.sqlite').replace(/\\/g, '/');
  const routerPath = path.join(tmpDir, 'router.php');

  fs.writeFileSync(routerPath, `<?php
if ($_SERVER['REQUEST_URI'] === '/__ping') {
  header('Content-Type: text/plain');
  echo 'ok';
  exit;
}
require_once '${API_DIR.replace(/\\/g, '/')}/bootstrap.php';
require_once '${API_DIR.replace(/\\/g, '/')}/db.php';
$pdo = new PDO('sqlite:${dbPath}');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->sqliteCreateFunction('NOW', function() { return date('Y-m-d H:i:s'); });
Database::setConnection($pdo);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (strpos($path, '/api/configs.php') !== false) {
  require '${API_DIR.replace(/\\/g, '/')}/configs.php';
  exit;
}
http_response_code(404);
`, 'utf8');

  const initRes = runPhp(`
    $pdo = new PDO('sqlite:${dbPath}');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec(${JSON.stringify(SQLITE_SCHEMA)});
    $pdo->exec("
      INSERT INTO users (id, email, password_hash, role, tier, credits_remaining, status, api_key) VALUES
      (1, 'free@company.de', 'hash', 'user', 'free', 40, 'active', 'free_key_1234567890'),
      (2, 'pro@company.de', 'hash', 'user', 'starter', 500, 'active', 'pro_key_1234567890');
    ");
    echo json_encode(['seeded' => true]);
  `);
  assert.equal(initRes.status, 0, initRes.stderr);

  const server = await startTempPhpServer(routerPath);
  try {
    // 1. Free user blocked from paid every_60m tier with HTTP 403
    const freeBlockedRes = await fetch(`${server.baseUrl}/api/configs.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer free_key_1234567890'
      },
      body: JSON.stringify({
        brand_name: 'FreeBlocked',
        brand_domains: ['freeblocked.de'],
        keywords_prompts: ['Bestes Tool?'],
        schedule_interval: 'every_60m'
      })
    });
    assert.equal(freeBlockedRes.status, 403, 'Free tier must be blocked from paid every_60m accuracy');

    // 2. Free user allowed starter tier every_120m (12/day) in Flow-B draft state (next_run_at null until Full Start)
    const freeOkRes = await fetch(`${server.baseUrl}/api/configs.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer free_key_1234567890'
      },
      body: JSON.stringify({
        name: 'Free Starter Accuracy',
        brand_name: 'FreeBrand',
        brand_domains: ['freebrand.de'],
        keywords_prompts: ['Bestes Tool?'],
        schedule_interval: 'every_120m'
      })
    });
    assert.equal(freeOkRes.status, 201);
    const freeOkCfg = (await freeOkRes.json()).config;
    assert.equal(freeOkCfg.schedule_interval, 'every_120m');
    assert.equal(freeOkCfg.datasets_per_day, 12);
    assert.equal(freeOkCfg.runs_per_day, 12);
    assert.equal(freeOkCfg.full_started_at, null);
    assert.equal(freeOkCfg.next_run_at, null);
    assert.equal(freeOkCfg.can_trigger_test_run, true);

    // 3. Starter user creates every_60m config, then triggers Full Start -> sets full_started_at & immediate next_run_at <= NOW()
    const starterRes = await fetch(`${server.baseUrl}/api/configs.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer pro_key_1234567890'
      },
      body: JSON.stringify({
        name: 'Starter Intraday Profile',
        brand_name: 'ProBrand',
        brand_domains: ['probrand.de'],
        keywords_prompts: ['Top B2B SaaS?'],
        schedule_interval: 'every_60m'
      })
    });
    assert.equal(starterRes.status, 201);
    const createdCfg = (await starterRes.json()).config;
    assert.equal(createdCfg.schedule_interval, 'every_60m');
    assert.equal(createdCfg.runs_per_day, 24);
    assert.equal(createdCfg.full_started_at, null);
    assert.equal(createdCfg.next_run_at, null);

    const startRes = await fetch(`${server.baseUrl}/api/configs.php?id=${createdCfg.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer pro_key_1234567890'
      },
      body: JSON.stringify({ action: 'full_start' })
    });
    assert.equal(startRes.status, 200);
    const startedCfg = (await startRes.json()).config;
    assert.ok(startedCfg.full_started_at, 'Full Start must set full_started_at');
    assert.equal(startedCfg.can_trigger_test_run, false);
    assert.ok(startedCfg.next_run_at, 'Full Started config must have immediate next_run_at');
    assert.ok(
      new Date(startedCfg.next_run_at.replace(' ', 'T')).getTime() <= Date.now() + 10000,
      'Full Started config next_run_at must be due immediately'
    );

    // 4. Partial PUT pause -> next_run_at cleared; resume -> immediate next_run_at restored
    const pauseRes = await fetch(`${server.baseUrl}/api/configs.php?id=${createdCfg.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer pro_key_1234567890'
      },
      body: JSON.stringify({ status: 'paused' })
    });
    assert.equal(pauseRes.status, 200);
    const pauseBody = await pauseRes.json();
    assert.equal(pauseBody.config.status, 'paused');

    const resumeRes = await fetch(`${server.baseUrl}/api/configs.php?id=${createdCfg.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer pro_key_1234567890'
      },
      body: JSON.stringify({ status: 'active' })
    });
    assert.equal(resumeRes.status, 200);
    const resumeBody = await resumeRes.json();
    assert.equal(resumeBody.config.status, 'active');
    assert.ok(resumeBody.config.next_run_at, 'Resumed Full Started config must set next_run_at');

    // 5. Post-Full-Start prompt mutation must fail with HTTP 409
    const mutateRes = await fetch(`${server.baseUrl}/api/configs.php?id=${createdCfg.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer pro_key_1234567890'
      },
      body: JSON.stringify({ keywords_prompts: ['Changed prompt after start?'] })
    });
    assert.equal(mutateRes.status, 409, 'Prompts must be immutable after Full Start');
  } finally {
    server.proc.kill();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Feature 30.5: n8n_queue.php polls every_120m Full-Started schedules, generates custom_ids, advances by +120m, and avoids multi-prompt truncation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlytics-q30-'));
  const dbPath = path.join(tmpDir, 'queue.sqlite').replace(/\\/g, '/');
  const setupRes = runPhp(String.raw`
    require_once '${API_DIR.replace(/\\/g, '/')}/bootstrap.php';
    require_once '${API_DIR.replace(/\\/g, '/')}/db.php';

    $pdo = new PDO('sqlite:${dbPath}');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->sqliteCreateFunction('NOW', function() { return date('Y-m-d H:i:s'); });
    $pdo->exec(${JSON.stringify(SQLITE_SCHEMA)});

    $pastDue = date('Y-m-d H:i:s', time() - 60);
    $pdo->prepare("INSERT INTO users (id, email, password_hash, role, tier, credits_remaining, status) VALUES (1, 'q@co.de', 'h', 'user', 'starter', 100, 'active')")->execute();
    $pdo->prepare("INSERT INTO tracking_configs (id, user_id, name, brand_name, brand_domains, keywords_prompts, competitors, target_llms, search_enabled, schedule_interval, datasets_per_day, status, full_started_at, next_run_at) VALUES (9, 1, 'Paused', 'B0', '[\"b0.de\"]', '[\"P0\"]', '[\"Comp\"]', '[\"openai\"]', 1, 'every_120m', 12, 'paused', :fs, :due)")->execute([':fs' => $pastDue, ':due' => $pastDue]);
    $pdo->prepare("INSERT INTO tracking_configs (id, user_id, name, brand_name, brand_domains, keywords_prompts, competitors, target_llms, search_enabled, schedule_interval, datasets_per_day, status, full_started_at, next_run_at) VALUES (10, 1, 'C1', 'B1', '[\"b1.de\"]', '[\"P1\",\"P2\",\"P3\"]', '[\"Comp\"]', '[\"openai\"]', 1, 'every_120m', 12, 'active', :fs, :due)")->execute([':fs' => $pastDue, ':due' => $pastDue]);
    $pdo->prepare("INSERT INTO tracking_configs (id, user_id, name, brand_name, brand_domains, keywords_prompts, competitors, target_llms, search_enabled, schedule_interval, datasets_per_day, status, full_started_at, next_run_at) VALUES (11, 1, 'C2', 'B2', '[\"b2.de\"]', '[\"Q1\",\"Q2\",\"Q3\"]', '[\"Comp\"]', '[\"openai\"]', 1, 'every_120m', 12, 'active', :fs, :due)")->execute([':fs' => $pastDue, ':due' => $pastDue]);

    Database::setConnection($pdo);
    $cfg = Config::get();
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET['action'] = 'poll';
    $_GET['limit'] = '4';
    $_SERVER['HTTP_X_N8N_SECRET'] = $cfg['n8n']['shared_secret'];

    require '${API_DIR.replace(/\\/g, '/')}/n8n_queue.php';
  `);

  try {
    assert.equal(setupRes.status, 0, setupRes.stderr || setupRes.stdout);
    assert.ok(setupRes.parsed, setupRes.stdout);
    assert.equal(setupRes.parsed.jobs_count, 3, `Queue response unexpected: ${setupRes.stdout} | stderr: ${setupRes.stderr}`);
    assert.equal(setupRes.parsed.jobs[0].config_id, 10);
    assert.match(setupRes.parsed.jobs[0].custom_id, /^cl_u1_c10_/);

    const verifyRes = runPhp(`
      $pdo = new PDO('sqlite:${dbPath}');
      $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
      $c10 = $pdo->query("SELECT id, schedule_interval, last_run_at, next_run_at FROM tracking_configs WHERE id = 10")->fetch();
      $c11 = $pdo->query("SELECT id, schedule_interval, last_run_at, next_run_at FROM tracking_configs WHERE id = 11")->fetch();
      echo json_encode([
        'c10_diff_seconds' => strtotime($c10['next_run_at']) - strtotime($c10['last_run_at']),
        'c11_is_past_due' => strtotime($c11['next_run_at']) < time(),
        'credits' => (int)$pdo->query("SELECT credits_remaining FROM users WHERE id = 1")->fetchColumn(),
        'batch_requests' => (int)$pdo->query("SELECT COUNT(*) FROM batch_requests WHERE config_id = 10")->fetchColumn()
      ]);
    `);
    assert.equal(verifyRes.status, 0, verifyRes.stderr);
    assert.equal(verifyRes.parsed.batch_requests, 3, 'All 3 prompt items must be persisted in batch_requests');
    assert.ok(verifyRes.parsed.c10_diff_seconds >= 7198 && verifyRes.parsed.c10_diff_seconds <= 7205, `Expected +7200s (+120m), got ${verifyRes.parsed.c10_diff_seconds}s`);
    assert.equal(verifyRes.parsed.c11_is_past_due, true, 'Deferred Config 11 must keep past-due next_run_at for next poll');
    assert.equal(verifyRes.parsed.credits, 97, '3 prompts x 1 LLM = 3 credits deducted atomically');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Feature 30.6: reports.php enforces daily granularity, suppresses Day-1 aggregates, provides per-model timelines, and filters by prompt', () => {
  const buildCode = (isDayOne, extraGet = '') => `
    require_once '${API_DIR.replace(/\\/g, '/')}/bootstrap.php';
    require_once '${API_DIR.replace(/\\/g, '/')}/db.php';

    $pdo = new PDO('sqlite::memory:');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->sqliteCreateFunction('NOW', function() { return date('Y-m-d H:i:s'); });
    $pdo->exec(${JSON.stringify(SQLITE_SCHEMA)});

    $pdo->prepare("INSERT INTO users (id, email, password_hash, role, tier, credits_remaining, status, magic_audit_token) VALUES (1, 'r@co.de', 'h', 'user', 'starter', 80, 'active', 'audit_tok_f30_1234567890')")->execute();
    $anchor = ${isDayOne ? "date('Y-m-d H:i:s')" : "'2026-09-01 08:00:00'"};
    $pdo->prepare("INSERT INTO tracking_configs (id, user_id, name, brand_name, brand_domains, keywords_prompts, competitors, target_llms, schedule_interval, datasets_per_day, status, full_started_at, created_at) VALUES (1, 1, 'R1', 'BrandX', ?, ?, ?, ?, 'every_120m', 12, 'active', ?, ?)")->execute([
      json_encode(['brandx.de']),
      json_encode(['P1', 'P2']),
      json_encode(['Comp']),
      json_encode(['openai', 'gemini']),
      $anchor,
      $anchor
    ]);

    $insertRun = $pdo->prepare("INSERT INTO llm_runs (user_id, config_id, provider, model, prompt, brand_name, status, brand_mentioned, brand_cited, relative_position_pct, mece_category, geo_quadrant, is_test_run, created_at) VALUES (1, 1, ?, ?, ?, 'BrandX', 'completed', ?, ?, ?, ?, 'NONE', ?, ?)");
    if (${isDayOne ? 'true' : 'false'}) {
      $insertRun->execute(['openai', 'gpt-6-luna', 'P1', 1, 1, 20.0, '1_DIRECT_WIN', 0, date('Y-m-d H:i:s', time() - 1200)]);
    } else {
      $insertRun->execute(['openai', 'gpt-6-luna', 'P1', 1, 1, 15.0, '1_DIRECT_WIN', 0, '2026-10-10 10:00:00']);
      $insertRun->execute(['openai', 'gpt-6-luna', 'P1', 1, 0, 40.0, '2_BRAND_HALO', 0, '2026-10-12 14:00:00']);
      $insertRun->execute(['gemini', 'gemini-3.5-flash', 'P2', 0, 0, null, '4_GENERIC', 0, '2026-10-11 12:00:00']);
      $insertRun->execute(['openai', 'gpt-6-luna', 'P1', 0, 1, null, '4_GENERIC', 0, '2026-09-10 10:00:00']);
    }

    Database::setConnection($pdo);
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET['audit_token'] = 'audit_tok_f30_1234567890';
    ${extraGet}
    require '${API_DIR.replace(/\\/g, '/')}/reports.php';
  `;

  // 1. Day-1 config suppresses aggregate dashboard metrics and timelines
  const resDay1 = runPhp(buildCode(true, "$_GET['period'] = '7d'; $_GET['config_id'] = '1';"));
  assert.equal(resDay1.status, 0, resDay1.stderr || resDay1.stdout);
  assert.ok(resDay1.parsed);
  assert.equal(resDay1.parsed.is_first_day, true);
  assert.equal(resDay1.parsed.metrics.total_runs, 0);
  assert.equal(resDay1.parsed.timeline.length, 0);
  assert.equal(resDay1.parsed.model_timeline.length, 0);

  // 2. Daily-only enforcement even if period=24h is passed
  const resDailyOnly = runPhp(buildCode(false, "$_GET['period'] = '24h'; $_GET['compare_mode'] = 'previous';"));
  assert.equal(resDailyOnly.status, 0, resDailyOnly.stderr || resDailyOnly.stdout);
  assert.equal(resDailyOnly.parsed.date_range.granularity, 'day');

  // 3. Multi-model unfiltered custom range returns both models & available prompts
  const resAllCustom = runPhp(buildCode(false, "$_GET['period'] = 'custom'; $_GET['start_date'] = '2026-10-10'; $_GET['end_date'] = '2026-10-12'; $_GET['compare_mode'] = 'none';"));
  assert.equal(resAllCustom.status, 0, resAllCustom.stderr || resAllCustom.stdout);
  assert.equal(resAllCustom.parsed.is_first_day, false);
  assert.equal(resAllCustom.parsed.metrics.total_runs, 3);
  assert.deepEqual(resAllCustom.parsed.available_prompts, ['P1', 'P2']);
  assert.ok(resAllCustom.parsed.model_timeline.some((m) => m.provider === 'gemini'));

  // 4. Prompt-filtered custom range + custom comparison period
  const resCustom = runPhp(buildCode(false, "$_GET['period'] = 'custom'; $_GET['start_date'] = '2026-10-10'; $_GET['end_date'] = '2026-10-12'; $_GET['prompt'] = 'P1'; $_GET['compare_mode'] = 'custom'; $_GET['compare_start_date'] = '2026-09-10'; $_GET['compare_end_date'] = '2026-09-12';"));
  assert.equal(resCustom.status, 0, resCustom.stderr || resCustom.stdout);
  assert.equal(resCustom.parsed.date_range.granularity, 'day');
  assert.equal(resCustom.parsed.date_range.total_slots, 3);
  assert.equal(resCustom.parsed.metrics.total_runs, 2);
  assert.equal(resCustom.parsed.timeline[0].slot_index, 0);
  assert.equal(resCustom.parsed.timeline[1].slot_index, 2);
  assert.equal(resCustom.parsed.comparison_timeline[0].slot_index, 0);
  assert.equal(resCustom.parsed.comparison_timeline[0].citation_share, 100);
  assert.equal(resCustom.parsed.pop_comparison.citation_delta, -50);

  // 5. None compare mode
  const resNone = runPhp(buildCode(false, "$_GET['period'] = 'custom'; $_GET['start_date'] = '2026-10-10'; $_GET['end_date'] = '2026-10-12'; $_GET['compare_mode'] = 'none';"));
  assert.equal(resNone.status, 0);
  assert.equal(resNone.parsed.date_range.compare_mode, 'none');
  assert.equal(resNone.parsed.comparison_timeline.length, 0);
  assert.equal(resNone.parsed.pop_comparison.som_delta, null);
});
