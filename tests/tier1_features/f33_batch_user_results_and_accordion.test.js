/**
 * tests/tier1_features/f33_batch_user_results_and_accordion.test.js
 * Feature 33: Per-User Physical Result Tables, Provider Prompt Caching / Batch Cascade,
 * Deferred custom_id Correlation, Flow-B Guardrails & Accordion Result Explorer
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

const SQLITE_SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    company_name TEXT NULL,
    role TEXT DEFAULT 'user',
    tier TEXT DEFAULT 'free',
    credits_remaining INTEGER DEFAULT 40,
    api_key TEXT NULL,
    magic_audit_token TEXT NULL,
    status TEXT DEFAULT 'active',
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
    error_message TEXT NULL,
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

function runPhp(phpCode) {
  const res = spawnSync(
    'php',
    ['-d', 'extension=pdo_sqlite', '-d', 'extension=sqlite3'],
    { input: `<?php\n${phpCode}`, cwd: PROJECT_ROOT, encoding: 'utf8' }
  );
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {}
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, parsed };
}

async function startTempPhpServer(routerPhpPath) {
  return await new Promise((resolve, reject) => {
    const port = 37000 + Math.floor(Math.random() * 8000);
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
        await new Promise((r) => setTimeout(r, 80));
      }
    };
    checkReady();
  });
}

async function startMockWebhookServer() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
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
      return new Promise((resolve) => server.close(resolve));
    }
  };
}

function buildRouterScript(dbPath, webhookUrl) {
  const api = API_DIR.replace(/\\/g, '/');
  return `<?php
if ($_SERVER['REQUEST_URI'] === '/__ping') {
  header('Content-Type: text/plain');
  echo 'ok';
  exit;
}
require_once '${api}/bootstrap.php';
require_once '${api}/db.php';

$cfg = Config::get();
$cfg['n8n']['webhook_url'] = '${webhookUrl}';
$cfg['n8n']['shared_secret'] = 'f33_test_secret';
Config::set($cfg);

$pdo = new PDO('sqlite:${dbPath}');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->sqliteCreateFunction('NOW', function() { return date('Y-m-d H:i:s'); });
Database::setConnection($pdo);

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$routes = ['auth.php', 'admin_users.php', 'configs.php', 'trigger_run.php', 'n8n_queue.php', 'ingest.php', 'user_results.php', 'reports.php'];
foreach ($routes as $ep) {
  if (strpos($path, '/api/' . $ep) !== false) {
    require '${api}/' . $ep;
    exit;
  }
}
http_response_code(404);
`;
}

test('Feature 33.1: Physical per-user result tables (user_results_<user_id>) provision on signup, demo seed, and ingest', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlytics-f33-tables-'));
  const dbPath = path.join(tmpDir, 'tables.sqlite').replace(/\\/g, '/');
  const routerPath = path.join(tmpDir, 'router.php');
  const webhook = await startMockWebhookServer();
  let server = null;

  try {
    fs.writeFileSync(routerPath, buildRouterScript(dbPath, webhook.url), 'utf8');

    const init = runPhp(`
      $pdo = new PDO('sqlite:${dbPath}');
      $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $pdo->exec(${JSON.stringify(SQLITE_SCHEMA)});
      $pdo->exec("
        INSERT INTO users (id, email, password_hash, role, tier, credits_remaining, status, api_key) VALUES
          (1, 'admin@chatlytics.de', 'hash', 'admin', 'enterprise_managed', 500, 'active', 'f33_admin_key_123456'),
          (5, 'late@acme-b2b.de', 'hash', 'user', 'starter', 100, 'active', 'f33_late_key_123456');
      ");
      $pdo->prepare("INSERT INTO tracking_configs (id, user_id, name, brand_name, brand_domains, keywords_prompts, competitors, target_llms, schedule_interval, datasets_per_day, status) VALUES (50, 5, 'Late Table', 'LateCo', ?, ?, ?, ?, 'every_120m', 12, 'active')")
        ->execute([json_encode(['late.de']), json_encode(['P1']), json_encode(['Comp']), json_encode(['openai'])]);
      echo json_encode(['ok' => true]);
    `);
    assert.equal(init.status, 0, init.stderr);

    server = await startTempPhpServer(routerPath);

    // 1. Signup auto-provisions user_results_<new_id>
    const signupRes = await fetch(`${server.baseUrl}/api/auth.php?action=signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'founder@new-saas.de',
        password: 'StrongPassword123!',
        company_name: 'New SaaS GmbH'
      })
    });
    const signupBody = await signupRes.json();
    assert.equal(signupRes.status, 201, JSON.stringify(signupBody));
    const newUser = signupBody.user;
    assert.ok(newUser && newUser.id > 5);
    assert.equal(newUser.results_table, `user_results_${newUser.id}`);

    // 2. Direct ingest for User 5 (whose table did not exist yet) auto-provisions user_results_5
    const ingestRes = await fetch(`${server.baseUrl}/api/ingest.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-Secret': 'f33_test_secret'
      },
      body: JSON.stringify({
        config_id: 50,
        user_id: 5,
        prompt: 'P1',
        provider: 'openai',
        model: 'gpt-6-luna',
        mece_category: '1_DIRECT_WIN',
        geo_quadrant: 'NONE',
        raw_response_text: 'LateCo is a leading B2B SaaS platform.'
      })
    });
    const ingestBody = await ingestRes.json();
    assert.equal(ingestRes.status, 200, JSON.stringify(ingestBody));
    assert.equal(ingestBody.results_table, 'user_results_5');

    // 3. Admin 1-Click demo seeder creates user_results_<id> for each seeded demo account
    const seedRes = await fetch(`${server.baseUrl}/api/admin_users.php?action=seed_demo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer f33_admin_key_123456'
      },
      body: JSON.stringify({})
    });
    const seedBody = await seedRes.json();
    assert.equal(seedRes.status, 200, JSON.stringify(seedBody));
    assert.ok(Array.isArray(seedBody.seeded_accounts) && seedBody.seeded_accounts.length >= 3);
    assert.ok(Array.isArray(seedBody.provisioned_tables) && seedBody.provisioned_tables.length >= 3);

    const verify = runPhp(`
      $pdo = new PDO('sqlite:${dbPath}');
      $tables = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'user_results_%'")->fetchAll(PDO::FETCH_COLUMN);
      $user5Count = (int)$pdo->query("SELECT COUNT(*) FROM user_results_5")->fetchColumn();
      echo json_encode(['tables' => $tables, 'user5_count' => $user5Count]);
    `);
    assert.equal(verify.status, 0, verify.stderr);
    assert.ok(verify.parsed.tables.includes(`user_results_${newUser.id}`), 'Signup user_results table must exist');
    assert.ok(verify.parsed.tables.includes('user_results_5'), 'Ingest must auto-create user_results_5');
    assert.equal(verify.parsed.user5_count, 1);
    assert.ok(verify.parsed.tables.length >= 5, 'Demo seeder + signup + ingest tables must all be physically present');
  } finally {
    if (server && server.proc) { await new Promise((r) => { if (server.proc.exitCode !== null) return r(); server.proc.once("close", r); server.proc.kill(); setTimeout(r, 300); }); }
    await webhook.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Feature 33.2: Provider-native 3-tier cost cascade (prompt_caching -> batch_api -> regular)', () => {
  const res = runPhp(`
    require_once '${API_DIR.replace(/\\/g, '/')}/bootstrap.php';
    echo json_encode([
      'openai_120' => [resolveTargetLlmSpec('openai', 'every_120m'), buildProviderCachingConfig('openai', 'gpt-6-luna', 'ck_oai', 'every_120m')],
      'gemini_120' => [resolveTargetLlmSpec('gemini', 'every_120m'), buildProviderCachingConfig('gemini', 'models/gemini-3.5-flash', 'ck_gem', 'every_120m')],
      'anthropic_60' => [resolveTargetLlmSpec('anthropic', 'every_60m'), buildProviderCachingConfig('anthropic', 'claude-sonnet-4-5', 'ck_ant60', 'every_60m')],
      'anthropic_120' => [resolveTargetLlmSpec('anthropic', 'every_120m'), buildProviderCachingConfig('anthropic', 'claude-sonnet-4-5', 'ck_ant120', 'every_120m')],
      'mistral_120' => [resolveTargetLlmSpec('mistral', 'every_120m'), buildProviderCachingConfig('mistral', 'mistral-large-latest', 'ck_mis', 'every_120m')],
      'zai_60' => [resolveTargetLlmSpec('zai-glm', 'every_60m'), buildProviderCachingConfig('mistral', 'zai-glm', 'ck_zai', 'every_60m')]
    ]);
  `);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const d = res.parsed;

  // OpenAI: 24h extended prompt caching
  assert.equal(d.openai_120[0].execution_strategy, 'prompt_caching');
  assert.equal(d.openai_120[1].prompt_cache_retention, '24h');
  assert.equal(d.openai_120[1].prompt_cache_key, 'ck_oai');

  // Gemini: implicit + v1beta/cachedContents
  assert.equal(d.gemini_120[0].execution_strategy, 'prompt_caching');
  assert.equal(d.gemini_120[1].implicit_caching, true);
  assert.equal(d.gemini_120[1].explicit_cache_endpoint, 'v1beta/cachedContents');

  // Anthropic <=60m -> prompt_caching with 1h ephemeral TTL
  assert.equal(d.anthropic_60[0].execution_strategy, 'prompt_caching');
  assert.equal(d.anthropic_60[1].cache_control.ttl, '1h');

  // Anthropic every_120m -> exceeds 1h max TTL, falls back to 50% Batch API
  assert.equal(d.anthropic_120[0].execution_strategy, 'batch_api');
  assert.equal(d.anthropic_120[1].strategy, 'batch_api');
  assert.equal(d.anthropic_120[1].reason, 'interval_120m_exceeds_claude_1h_max_cache_ttl');

  // Mistral native -> prompt_caching
  assert.equal(d.mistral_120[0].execution_strategy, 'prompt_caching');
  assert.equal(d.mistral_120[1].prompt_cache_key, 'ck_mis');

  // Z.ai GLM -> neither cache nor batch -> regular
  assert.equal(d.zai_60[0].execution_strategy, 'regular');
  assert.equal(d.zai_60[1].strategy, 'regular');
  assert.equal(d.zai_60[1].prompt_cache_key, null);
});

test('Feature 33.3: custom_id batch_requests correlation, provider cached_tokens extraction, dual insertion & idempotency', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlytics-f33-corr-'));
  const dbPath = path.join(tmpDir, 'corr.sqlite').replace(/\\/g, '/');
  const routerPath = path.join(tmpDir, 'router.php');
  const webhook = await startMockWebhookServer();
  let server = null;

  try {
    fs.writeFileSync(routerPath, buildRouterScript(dbPath, webhook.url), 'utf8');
    const pastDue = '2026-01-01 00:00:00';
    const init = runPhp(`
      $pdo = new PDO('sqlite:${dbPath}');
      $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $pdo->exec(${JSON.stringify(SQLITE_SCHEMA)});
      $pdo->prepare("INSERT INTO users (id, email, password_hash, role, tier, credits_remaining, status, api_key) VALUES (1, 'c@b2b.de', 'h', 'user', 'starter', 100, 'active', 'f33_corr_key_123456')")->execute();
      $pdo->prepare("INSERT INTO tracking_configs (id, user_id, name, brand_name, brand_domains, keywords_prompts, competitors, target_llms, schedule_interval, datasets_per_day, status, initial_test_used, full_started_at, next_run_at) VALUES (10, 1, 'TestCfg', 'Personio', ?, ?, ?, ?, 'every_120m', 12, 'active', 0, NULL, NULL)")
        ->execute([json_encode(['personio.de']), json_encode(['Best HR?']), json_encode(['Workday']), json_encode(['openai', 'gemini'])]);
      $pdo->prepare("INSERT INTO tracking_configs (id, user_id, name, brand_name, brand_domains, keywords_prompts, competitors, target_llms, schedule_interval, datasets_per_day, status, initial_test_used, full_started_at, next_run_at) VALUES (11, 1, 'BatchCfg', 'Personio', ?, ?, ?, ?, 'every_120m', 12, 'active', 1, ?, ?)")
        ->execute([json_encode(['personio.de']), json_encode(['Top Payroll?']), json_encode(['Workday']), json_encode(['anthropic', 'zai-glm']), '${pastDue}', '${pastDue}']);
    `);
    assert.equal(init.status, 0, init.stderr);

    server = await startTempPhpServer(routerPath);

    // 1. Trigger test run -> creates batch_requests rows with is_test_run=1
    const trigRes = await fetch(`${server.baseUrl}/api/trigger_run.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer f33_corr_key_123456' },
      body: JSON.stringify({ config_id: 10, response_mode: 'async' })
    });
    const trigBody = await trigRes.json();
    assert.equal(trigRes.status, 200, JSON.stringify(trigBody));
    assert.equal(trigBody.batch_items.length, 2);
    const oaiItem = trigBody.batch_items.find((b) => b.provider === 'openai');
    const gemItem = trigBody.batch_items.find((b) => b.provider === 'gemini');
    assert.equal(oaiItem.execution_strategy, 'prompt_caching');
    assert.equal(oaiItem.is_test_run, true);

    // 2. Poll n8n_queue -> dispatches Full-Started config 11 with anthropic (batch_api) & zai-glm (regular)
    const pollRes = await fetch(`${server.baseUrl}/api/n8n_queue.php?action=poll&limit=5`, {
      headers: { 'X-N8N-Secret': 'f33_test_secret' }
    });
    const pollBody = await pollRes.json();
    assert.equal(pollRes.status, 200, JSON.stringify(pollBody));
    assert.equal(pollBody.jobs_count, 1);
    const qItems = pollBody.jobs[0].batch_items;
    const anthItem = qItems.find((b) => b.provider === 'anthropic');
    const zaiItem = qItems.find((b) => b.model === 'zai-glm');
    assert.equal(anthItem.execution_strategy, 'batch_api');
    assert.equal(zaiItem.execution_strategy, 'regular');

    // 3. Ingest deferred results using ONLY custom_id + usage telemetry (verifying DB correlation & token extraction)
    const ing1 = await (await fetch(`${server.baseUrl}/api/ingest.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-N8N-Secret': 'f33_test_secret' },
      body: JSON.stringify({
        custom_id: oaiItem.custom_id,
        mece_category: '1_DIRECT_WIN',
        geo_quadrant: 'NONE',
        raw_response_text: 'Personio on personio.de is great compared to Workday.',
        usage: { prompt_tokens_details: { cached_tokens: 1280 } },
        competitors: [{ name: 'Workday', mentioned: true }],
        citations: [{ url: 'https://personio.de/hr', domain: 'personio.de' }]
      })
    })).json();
    assert.equal(ing1.status, 'success', JSON.stringify(ing1));
    assert.equal(ing1.cached_tokens, 1280);
    assert.equal(ing1.is_test_run, true);

    const ing2 = await (await fetch(`${server.baseUrl}/api/ingest.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-N8N-Secret': 'f33_test_secret' },
      body: JSON.stringify({
        custom_id: gemItem.custom_id,
        mece_category: '2_BRAND_HALO',
        geo_quadrant: 'NONE',
        raw_response_text: 'Gemini mentions Personio clearly.',
        usageMetadata: { cachedContentTokenCount: 2400 }
      })
    })).json();
    assert.equal(ing2.cached_tokens, 2400);

    const ing3 = await (await fetch(`${server.baseUrl}/api/ingest.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-N8N-Secret': 'f33_test_secret' },
      body: JSON.stringify({
        custom_id: anthItem.custom_id,
        batch_id: 'msgbatch_01xyz',
        mece_category: '1_DIRECT_WIN',
        geo_quadrant: 'NONE',
        raw_response_text: 'Anthropic batch recommends Personio over Workday.',
        usage: { cache_read_input_tokens: 1500 }
      })
    })).json();
    assert.equal(ing3.cached_tokens, 1500);
    assert.equal(ing3.execution_strategy, 'batch_api');
    assert.equal(ing3.is_test_run, false);

    // 4. Duplicate custom_id ingest is idempotent (must not create a duplicate row)
    await fetch(`${server.baseUrl}/api/ingest.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-N8N-Secret': 'f33_test_secret' },
      body: JSON.stringify({
        custom_id: oaiItem.custom_id,
        mece_category: '1_DIRECT_WIN',
        raw_response_text: 'Duplicate replay'
      })
    });

    const dbCheck = runPhp(`
      $pdo = new PDO('sqlite:${dbPath}');
      $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
      $urCount = (int)$pdo->query("SELECT COUNT(*) FROM user_results_1")->fetchColumn();
      $dupCount = (int)$pdo->query("SELECT COUNT(*) FROM user_results_1 WHERE custom_id = " . $pdo->quote('${oaiItem.custom_id}'))->fetchColumn();
      $brStatus = $pdo->query("SELECT status FROM batch_requests WHERE custom_id = " . $pdo->quote('${anthItem.custom_id}'))->fetchColumn();
      echo json_encode(['urCount' => $urCount, 'dupCount' => $dupCount, 'brStatus' => $brStatus]);
    `);
    assert.equal(dbCheck.status, 0, dbCheck.stderr);
    assert.equal(dbCheck.parsed.urCount, 3, 'Exactly 3 unique rows must be persisted in user_results_1');
    assert.equal(dbCheck.parsed.dupCount, 1, 'Duplicate custom_id must be ignored idempotently');
    assert.equal(dbCheck.parsed.brStatus, 'completed');
  } finally {
    if (server && server.proc) { await new Promise((r) => { if (server.proc.exitCode !== null) return r(); server.proc.once("close", r); server.proc.kill(); setTimeout(r, 300); }); }
    await webhook.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Feature 33.4: Flow-B 409 lock after single test run and immutable prompts after Full Start', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlytics-f33-flowb-'));
  const dbPath = path.join(tmpDir, 'flowb.sqlite').replace(/\\/g, '/');
  const routerPath = path.join(tmpDir, 'router.php');
  const webhook = await startMockWebhookServer();
  let server = null;

  try {
    fs.writeFileSync(routerPath, buildRouterScript(dbPath, webhook.url), 'utf8');
    const init = runPhp(`
      $pdo = new PDO('sqlite:${dbPath}');
      $pdo->exec(${JSON.stringify(SQLITE_SCHEMA)});
      $pdo->prepare("INSERT INTO users (id, email, password_hash, role, tier, credits_remaining, status, api_key) VALUES (1, 'fb@b2b.de', 'h', 'user', 'starter', 100, 'active', 'f33_flowb_key_123456')")->execute();
    `);
    assert.equal(init.status, 0, init.stderr);

    server = await startTempPhpServer(routerPath);

    // 1. Create config A (for repeated-test lock) and config B (for direct Full Start lock)
    const cfgA = (await (await fetch(`${server.baseUrl}/api/configs.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer f33_flowb_key_123456' },
      body: JSON.stringify({ brand_name: 'Alpha', brand_domains: ['alpha.de'], keywords_prompts: ['Prompt A'], schedule_interval: 'every_120m' })
    })).json()).config;

    const cfgB = (await (await fetch(`${server.baseUrl}/api/configs.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer f33_flowb_key_123456' },
      body: JSON.stringify({ brand_name: 'Beta', brand_domains: ['beta.de'], keywords_prompts: ['Prompt B'], schedule_interval: 'every_120m' })
    })).json()).config;

    // 2. First test run on cfgA succeeds (200); second test run blocked with 409
    const firstTest = await fetch(`${server.baseUrl}/api/trigger_run.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer f33_flowb_key_123456' },
      body: JSON.stringify({ config_id: cfgA.id, response_mode: 'async' })
    });
    assert.equal(firstTest.status, 200);

    const secondTest = await fetch(`${server.baseUrl}/api/trigger_run.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer f33_flowb_key_123456' },
      body: JSON.stringify({ config_id: cfgA.id, response_mode: 'async' })
    });
    assert.equal(secondTest.status, 409, 'Second manual test run must return HTTP 409');

    // 3. Full Start on cfgB -> blocks manual trigger_run (409) and locks prompts immutable (409)
    const startB = await fetch(`${server.baseUrl}/api/configs.php?id=${cfgB.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer f33_flowb_key_123456' },
      body: JSON.stringify({ action: 'full_start' })
    });
    assert.equal(startB.status, 200);

    const postStartTest = await fetch(`${server.baseUrl}/api/trigger_run.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer f33_flowb_key_123456' },
      body: JSON.stringify({ config_id: cfgB.id, response_mode: 'async' })
    });
    assert.equal(postStartTest.status, 409, 'Manual trigger_run must return 409 after Full Start');

    const promptEdit = await fetch(`${server.baseUrl}/api/configs.php?id=${cfgB.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer f33_flowb_key_123456' },
      body: JSON.stringify({ keywords_prompts: ['Mutated Prompt B'] })
    });
    assert.equal(promptEdit.status, 409, 'Prompt mutation after Full Start must return HTTP 409');

    const pauseOk = await fetch(`${server.baseUrl}/api/configs.php?id=${cfgB.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer f33_flowb_key_123456' },
      body: JSON.stringify({ status: 'paused' })
    });
    assert.equal(pauseOk.status, 200, 'Pause/Resume remains permitted after Full Start');
  } finally {
    if (server && server.proc) { await new Promise((r) => { if (server.proc.exitCode !== null) return r(); server.proc.once("close", r); server.proc.kill(); setTimeout(r, 300); }); }
    await webhook.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Feature 33.5: api/user_results.php enforces Day-1 test-only view, filters, pagination, and tenant isolation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlytics-f33-ur-'));
  const dbPath = path.join(tmpDir, 'ur.sqlite').replace(/\\/g, '/');
  const routerPath = path.join(tmpDir, 'router.php');
  const webhook = await startMockWebhookServer();
  let server = null;

  try {
    fs.writeFileSync(routerPath, buildRouterScript(dbPath, webhook.url), 'utf8');
    const init = runPhp(`
      require_once '${API_DIR.replace(/\\/g, '/')}/db.php';
      $pdo = new PDO('sqlite:${dbPath}');
      $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
      $pdo->exec(${JSON.stringify(SQLITE_SCHEMA)});
      $pdo->prepare("INSERT INTO users (id, email, password_hash, role, tier, credits_remaining, status, api_key) VALUES (1, 'u1@b2b.de', 'h', 'user', 'starter', 100, 'active', 'f33_ur_u1_123456'), (2, 'u2@b2b.de', 'h', 'user', 'starter', 100, 'active', 'f33_ur_u2_123456')")->execute();

      $today = date('Y-m-d H:i:s');
      $oldDay = '2026-10-01 09:00:00';
      $insCfg = $pdo->prepare("INSERT INTO tracking_configs (id, user_id, name, brand_name, brand_domains, keywords_prompts, competitors, target_llms, schedule_interval, datasets_per_day, status, full_started_at, created_at) VALUES (?, 1, ?, 'BrandY', ?, ?, ?, ?, 'every_120m', 12, 'active', ?, ?)");
      $dom = json_encode(['brandy.de']);
      $prs = json_encode(['P1', 'P2']);
      $cmp = json_encode(['Workday']);
      $llms = json_encode(['openai', 'gemini']);
      $insCfg->execute([1, 'Day1 Config', $dom, $prs, $cmp, $llms, $today, $today]);
      $insCfg->execute([2, 'Mature Config', $dom, $prs, $cmp, $llms, $oldDay, $oldDay]);

      ensureUserResultsTable($pdo, 1);
      // Config 1 (Day 1): 1 test run + 2 background runs
      insertUserResultRow($pdo, 1, ['config_id' => 1, 'custom_id' => 'd1_test', 'execution_strategy' => 'prompt_caching', 'is_test_run' => 1, 'prompt' => 'P1', 'llm_answer' => 'Visible Test Run', 'provider' => 'openai', 'model' => 'gpt-6-luna', 'brand_name' => 'BrandY', 'mece_category' => '1_DIRECT_WIN', 'created_at' => $today]);
      insertUserResultRow($pdo, 1, ['config_id' => 1, 'custom_id' => 'd1_bg1', 'execution_strategy' => 'batch_api', 'is_test_run' => 0, 'prompt' => 'P1', 'llm_answer' => 'Hidden Day1 Batch', 'provider' => 'anthropic', 'model' => 'claude-sonnet-4-5', 'brand_name' => 'BrandY', 'mece_category' => '2_BRAND_HALO', 'created_at' => $today]);
      insertUserResultRow($pdo, 1, ['config_id' => 1, 'custom_id' => 'd1_bg2', 'execution_strategy' => 'prompt_caching', 'is_test_run' => 0, 'prompt' => 'P2', 'llm_answer' => 'Hidden Day1 Scheduled', 'provider' => 'gemini', 'model' => 'models/gemini-3.5-flash', 'brand_name' => 'BrandY', 'mece_category' => '4_GENERIC', 'created_at' => $today]);

      // Config 2 (Mature): 5 runs across models, prompts, MECE & search keyword 'Workday'
      $rows2 = [
        ['m1', 'prompt_caching', 'P1', 'BrandY leads', 'openai', 'gpt-6-luna', '1_DIRECT_WIN', '2026-10-05 10:00:00'],
        ['m2', 'batch_api', 'P2', 'Workday beats all', 'anthropic', 'claude-sonnet-4-5', '3_COMPETITOR_TAKEOVER', '2026-10-05 11:00:00'],
        ['m3', 'prompt_caching', 'P2', 'BrandY halo', 'gemini', 'models/gemini-3.5-flash', '2_BRAND_HALO', '2026-10-06 10:00:00'],
        ['m4', 'regular', 'P1', 'Neutral view', 'mistral', 'zai-glm', '4_GENERIC', '2026-10-07 10:00:00'],
        ['m5', 'prompt_caching', 'P1', 'BrandY + Workday comparison', 'openai', 'gpt-6-luna', '1_DIRECT_WIN', '2026-10-08 10:00:00']
      ];
      foreach ($rows2 as $r) {
        insertUserResultRow($pdo, 1, ['config_id' => 2, 'custom_id' => $r[0], 'execution_strategy' => $r[1], 'is_test_run' => 0, 'prompt' => $r[2], 'llm_answer' => $r[3], 'provider' => $r[4], 'model' => $r[5], 'brand_name' => 'BrandY', 'mece_category' => $r[6], 'created_at' => $r[7]]);
      }
      echo json_encode(['ok' => true]);
    `);
    assert.equal(init.status, 0, init.stderr);

    server = await startTempPhpServer(routerPath);

    // 1. Day-1 shows ONLY is_test_run = 1 while hiding background batch rows
    const day1 = await (await fetch(`${server.baseUrl}/api/user_results.php?config_id=1`, {
      headers: { 'Authorization': 'Bearer f33_ur_u1_123456' }
    })).json();
    assert.equal(day1.is_first_day, true);
    assert.equal(day1.results_table, 'user_results_1');
    assert.equal(day1.results.length, 1);
    assert.equal(day1.results[0].custom_id, 'd1_test');

    // 2. Mature config filters: model, prompt, mece, search, and pagination
    const byModel = await (await fetch(`${server.baseUrl}/api/user_results.php?config_id=2&model=openai/gpt-6-luna`, {
      headers: { 'Authorization': 'Bearer f33_ur_u1_123456' }
    })).json();
    assert.equal(byModel.is_first_day, false);
    assert.equal(byModel.results.length, 2);

    const byPromptMece = await (await fetch(`${server.baseUrl}/api/user_results.php?config_id=2&prompt=P2&mece=3_COMPETITOR_TAKEOVER`, {
      headers: { 'Authorization': 'Bearer f33_ur_u1_123456' }
    })).json();
    assert.equal(byPromptMece.results.length, 1);
    assert.equal(byPromptMece.results[0].custom_id, 'm2');

    const bySearch = await (await fetch(`${server.baseUrl}/api/user_results.php?config_id=2&search=Workday`, {
      headers: { 'Authorization': 'Bearer f33_ur_u1_123456' }
    })).json();
    assert.equal(bySearch.results.length, 2);

    const paged = await (await fetch(`${server.baseUrl}/api/user_results.php?config_id=2&page=2&limit=2`, {
      headers: { 'Authorization': 'Bearer f33_ur_u1_123456' }
    })).json();
    assert.equal(paged.pagination.total, 5);
    assert.equal(paged.pagination.total_pages, 3);
    assert.equal(paged.results.length, 2);

    // 3. Tenant isolation: user 2 cannot query user 1's config
    const crossTenant = await fetch(`${server.baseUrl}/api/user_results.php?config_id=2`, {
      headers: { 'Authorization': 'Bearer f33_ur_u2_123456' }
    });
    assert.equal(crossTenant.status, 404);
  } finally {
    if (server && server.proc) { await new Promise((r) => { if (server.proc.exitCode !== null) return r(); server.proc.once("close", r); server.proc.kill(); setTimeout(r, 300); }); }
    await webhook.close();
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('Feature 33.6: DashboardController accordion row toggle, XSS-safe DOM rendering & model timeline alignment', async () => {
  const byId = new Map();
  function makeClassList(init = []) {
    const s = new Set(init.filter(Boolean));
    return {
      add: (...c) => c.forEach((x) => s.add(x)),
      remove: (...c) => c.forEach((x) => s.delete(x)),
      contains: (c) => s.has(c),
      toggle: (c, f) => (f === undefined ? (s.has(c) ? (s.delete(c), false) : (s.add(c), true)) : (f ? s.add(c) : s.delete(c), Boolean(f))),
      toString: () => [...s].join(' ')
    };
  }
  function makeEl(tag = 'div', id = '') {
    let _id = id;
    let _className = '';
    const attrs = new Map();
    const listeners = new Map();
    const children = [];
    const el = {
      tagName: tag.toUpperCase(),
      disabled: false,
      hidden: false,
      textContent: '',
      innerHTML: '',
      value: '',
      children,
      classList: makeClassList([]),
      get id() { return _id; },
      set id(val) {
        _id = String(val || '');
        if (_id) byId.set(_id, el);
      },
      get className() { return _className || el.classList.toString(); },
      set className(val) {
        _className = String(val || '');
        el.classList = makeClassList(_className.split(/\s+/));
      },
      appendChild(c) { children.push(c); c.parentNode = el; return c; },
      append(...nodes) { nodes.forEach((n) => el.appendChild(n)); },
      replaceChildren(...nodes) { children.length = 0; nodes.forEach((n) => el.appendChild(n)); },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'id') el.id = v;
        if (k === 'class') el.className = v;
      },
      getAttribute(k) { return attrs.get(k) ?? null; },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      querySelector(sel) {
        const cls = sel.startsWith('.') ? sel.slice(1) : null;
        const walk = (node) => {
          for (const ch of node.children || []) {
            if (cls && ch.classList?.contains(cls)) return ch;
            const nested = walk(ch);
            if (nested) return nested;
          }
          return null;
        };
        return walk(el);
      }
    };
    if (id) byId.set(id, el);
    return el;
  }

  const localMap = new Map();
  const sessMap = new Map();
  global.window = global;
  global.addEventListener = () => {};
  global.localStorage = {
    getItem: (k) => (localMap.has(k) ? localMap.get(k) : null),
    setItem: (k, v) => localMap.set(k, String(v)),
    removeItem: (k) => localMap.delete(k)
  };
  global.sessionStorage = {
    getItem: (k) => (sessMap.has(k) ? sessMap.get(k) : null),
    setItem: (k, v) => sessMap.set(k, String(v)),
    removeItem: (k) => sessMap.delete(k)
  };
  global.document = {
    body: makeEl('body'),
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => makeEl(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text ?? ''), innerHTML: '' }),
    querySelectorAll: () => [],
    addEventListener: () => {}
  };

  makeEl('tbody', 'user-results-tbody');
  makeEl('span', 'user-results-total-badge');
  makeEl('span', 'user-results-table-badge');
  makeEl('select', 'results-model-filter');
  makeEl('span', 'results-page-info');
  makeEl('button', 'btn-results-prev');
  makeEl('button', 'btn-results-next');

  const dashMod = await import('../../assets/js/dashboard.js');
  const ctrl = new dashMod.DashboardController();

  ctrl.renderUserResultsSection({
    results_table: 'user_results_42',
    pagination: { page: 1, total_pages: 2, total: 12 },
    results: [
      {
        id: 701,
        custom_id: 'cl_u42_c9_1',
        execution_strategy: 'prompt_caching',
        cached_tokens: 1850,
        provider: 'openai',
        model: 'gpt-6-luna',
        canonical_model: 'openai/gpt-6-luna',
        prompt: '<script>alert(1)</script> Best SaaS?',
        llm_answer: 'Full <img src=x onerror=alert(2)> answer text',
        mece_category: '1_DIRECT_WIN',
        geo_quadrant: 'NONE',
        competitors_json: [{ competitor_name: 'Workday', mentioned: true }],
        citations_json: [{ citation_domain: 'personio.de', is_brand_domain: true }],
        created_at: '2026-10-12 09:30:00'
      }
    ]
  });

  assert.equal(byId.get('user-results-total-badge').textContent, '12');
  assert.equal(byId.get('user-results-table-badge').textContent, 'user_results_42');
  const summaryRow = byId.get('result-summary-701');
  const detailRow = byId.get('result-detail-701');
  assert.ok(summaryRow && detailRow, 'Accordion summary & detail rows must render');
  assert.equal(detailRow.hidden, true, 'Detail row starts collapsed');
  assert.equal(summaryRow.querySelector('.accordion-toggle').getAttribute('aria-expanded'), 'false');

  // Verify untrusted prompt & answer strings do not populate innerHTML unescaped
  const collectHtml = (node) => [node.innerHTML || '', ...(node.children || []).map(collectHtml)].join('');
  assert.equal(collectHtml(summaryRow).includes('<script>'), false);
  assert.equal(collectHtml(detailRow).includes('<img'), false);

  // Toggle open
  const opened = ctrl.toggleAccordionRow(701);
  assert.equal(opened, true);
  assert.equal(detailRow.hidden, false);
  assert.equal(summaryRow.classList.contains('is-open'), true);
  assert.equal(summaryRow.querySelector('.accordion-toggle').getAttribute('aria-expanded'), 'true');

  // Toggle closed
  const closed = ctrl.toggleAccordionRow(701);
  assert.equal(closed, false);
  assert.equal(detailRow.hidden, true);
  assert.equal(summaryRow.classList.contains('is-open'), false);
  assert.equal(summaryRow.querySelector('.accordion-toggle').getAttribute('aria-expanded'), 'false');

  // Verify model timeline helper assigns unique series & preserves nulls
  const aligned = dashMod.buildModelTimelineAlignedSeries(
    [
      { slot_index: 0, provider: 'openai', model: 'gpt-6-luna', som_score: 80 },
      { slot_index: 2, provider: 'openai', model: 'gpt-6-luna', som_score: 90 },
      { slot_index: 1, provider: 'anthropic', model: 'claude-sonnet-4-5', som_score: 65 }
    ],
    3,
    'som_score'
  );
  assert.equal(aligned.length, 2);
  assert.notEqual(aligned[0].color, aligned[1].color);
  assert.equal(aligned.find((s) => s.provider === 'openai').slots[1].value, null);
});
