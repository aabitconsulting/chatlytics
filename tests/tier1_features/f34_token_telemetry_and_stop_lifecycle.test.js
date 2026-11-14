/**
 * tests/tier1_features/f34_token_telemetry_and_stop_lifecycle.test.js
 * Feature 34: Input/Output Token Telemetry (Admin View) & Irreversible Stop -> Archive / 90-Day Soft-Delete Lifecycle
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const API_DIR = path.join(PROJECT_ROOT, 'api');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForServer(port, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/__health`);
      if (res.ok) return;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error(`PHP test server on port ${port} did not start within ${timeoutMs}ms`);
}

async function createSqliteBackedPhpServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlytics-f34-'));
  const dbPath = path.join(tmpDir, 'test.sqlite').replace(/\\/g, '/');
  const routerPath = path.join(tmpDir, 'router.php');

  const initPhp = `<?php
$pdo = new PDO('sqlite:${dbPath}');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec("
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    company_name TEXT NULL,
    role TEXT DEFAULT 'user',
    tier TEXT DEFAULT 'growth',
    credits_remaining INTEGER DEFAULT 200,
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
    schedule_interval TEXT DEFAULT 'every_60m',
    datasets_per_day INTEGER DEFAULT 24,
    initial_test_used INTEGER DEFAULT 0,
    full_started_at DATETIME NULL,
    status TEXT DEFAULT 'active',
    stopped_at DATETIME NULL,
    archived_at DATETIME NULL,
    deleted_at DATETIME NULL,
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
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0,
    is_test_run INTEGER NOT NULL DEFAULT 0,
    prompt TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
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
  INSERT INTO users (id, email, password_hash, company_name, role, tier, credits_remaining, api_key, status) VALUES
    (1, 'admin@chatlytics.de', 'hash', 'Chatlytics HQ', 'admin', 'enterprise_managed', 9999, 'adm_token_f34', 'active'),
    (2, 'client@personio.de', 'hash', 'Personio SE', 'user', 'growth', 200, 'usr_token_f34', 'active');
");
`;
  const initScriptPath = path.join(tmpDir, 'init.php');
  fs.writeFileSync(initScriptPath, initPhp, 'utf8');
  await new Promise((resolve, reject) => {
    const p = spawn('php', ['-d', 'extension=pdo_sqlite', '-d', 'extension=sqlite3', initScriptPath], { cwd: PROJECT_ROOT });
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`init.php exited ${code}`))));
  });

  const routerCode = `<?php
require_once '${API_DIR.replace(/\\/g, '/')}/bootstrap.php';
require_once '${API_DIR.replace(/\\/g, '/')}/db.php';

$pdo = new PDO('sqlite:${dbPath}');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->sqliteCreateFunction('NOW', function() { return date('Y-m-d H:i:s'); });
Database::setConnection($pdo);

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($uri === '/__health') {
  header('Content-Type: application/json');
  echo json_encode(['ok' => true]);
  exit;
}
if ($uri === '/__age_deleted') {
  $cfgId = (int)($_GET['config_id'] ?? 0);
  $days = (int)($_GET['days'] ?? 91);
  $past = date('Y-m-d H:i:s', time() - ($days * 86400));
  $st = $pdo->prepare("UPDATE tracking_configs SET deleted_at = :past WHERE id = :id");
  $st->execute([':past' => $past, ':id' => $cfgId]);
  $purged = purgeExpiredDeletedConfigs($pdo);
  header('Content-Type: application/json');
  echo json_encode(['purged' => $purged]);
  exit;
}
$target = '${API_DIR.replace(/\\/g, '/')}/' . basename($uri);
if (is_file($target)) {
  require $target;
  exit;
}
http_response_code(404);
`;
  fs.writeFileSync(routerPath, routerCode, 'utf8');

  const port = await getFreePort();
  const proc = spawn('php', ['-d', 'extension=pdo_sqlite', '-d', 'extension=sqlite3', '-S', `127.0.0.1:${port}`, routerPath], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await waitForServer(port);

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise(resolve => {
        proc.once('close', () => resolve());
        proc.kill();
        setTimeout(resolve, 500);
      });
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      } catch (_) {}
    }
  };
}

describe('Feature 34: Token Telemetry & Irreversible Stop / Archive / 90-Day Soft-Delete Lifecycle', () => {
  it('1. Persists input_tokens, output_tokens, and cached_tokens in llm_runs & user_results_<user_id> and exposes them in Admin Inspector', async () => {
    const srv = await createSqliteBackedPhpServer();
    try {
      // Create a config as User #2
      const createRes = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer usr_token_f34'
        },
        body: JSON.stringify({
          name: 'Personio Token Test Config',
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          keywords_prompts: ['Beste HR Software Mittelstand'],
          competitors: [{ name: 'Workday', domain: 'workday.com' }],
          target_llms: ['openai/gpt-6-luna', 'gemini/models/gemini-3.5-flash'],
          schedule_interval: 'every_60m'
        })
      });
      const createJson = await createRes.json();
      assert.equal(createRes.status, 201);
      const configId = createJson.data.config.id;

      // Ingest Run 1 with explicit input_tokens / output_tokens
      const ing1 = await fetch(`${srv.baseUrl}/api/ingest.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Chatlytics-Ingest-Key': 'chatlytics_dev_secret_key_2026'
        },
        body: JSON.stringify({
          config_id: configId,
          user_id: 2,
          custom_id: 'cl_f34_tok_1',
          execution_strategy: 'prompt_caching',
          input_tokens: 1450,
          output_tokens: 320,
          cached_tokens: 1152,
          is_test_run: 1,
          prompt: 'Beste HR Software Mittelstand',
          provider: 'openai',
          model: 'gpt-6-luna',
          brand_name: 'Personio',
          status: 'completed',
          brand_mentioned: 1,
          mece_category: '1_DIRECT_WIN',
          geo_quadrant: 'NONE',
          raw_response_text: 'Personio ist führend für den Mittelstand.'
        })
      });
      const ing1Json = await ing1.json();
      assert.equal(ing1.status, 200);
      assert.equal(ing1Json.data.input_tokens, 1450);
      assert.equal(ing1Json.data.output_tokens, 320);
      assert.equal(ing1Json.data.cached_tokens, 1152);

      // Ingest Run 2 with Gemini usageMetadata
      const ing2 = await fetch(`${srv.baseUrl}/api/ingest.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Chatlytics-Ingest-Key': 'chatlytics_dev_secret_key_2026'
        },
        body: JSON.stringify({
          config_id: configId,
          user_id: 2,
          custom_id: 'cl_f34_tok_2',
          execution_strategy: 'prompt_caching',
          usageMetadata: {
            promptTokenCount: 2100,
            candidatesTokenCount: 410,
            cachedContentTokenCount: 1800
          },
          is_test_run: 1,
          prompt: 'Beste HR Software Mittelstand',
          provider: 'gemini',
          model: 'models/gemini-3.5-flash',
          brand_name: 'Personio',
          status: 'completed',
          brand_mentioned: 1,
          mece_category: '1_DIRECT_WIN',
          geo_quadrant: 'NONE',
          raw_response_text: 'Personio bietet exzellente KMU-Funktionen.'
        })
      });
      const ing2Json = await ing2.json();
      assert.equal(ing2.status, 200);
      assert.equal(ing2Json.data.input_tokens, 2100);
      assert.equal(ing2Json.data.output_tokens, 410);
      assert.equal(ing2Json.data.cached_tokens, 1800);

      // Admin queries user_results.php?user_id=2&include_deleted=1
      const admRes = await fetch(`${srv.baseUrl}/api/user_results.php?user_id=2&include_deleted=1`, {
        headers: { 'Authorization': 'Bearer adm_token_f34' }
      });
      const admJson = await admRes.json();
      assert.equal(admRes.status, 200);
      assert.equal(admJson.data.summary.total_runs, 2);
      assert.equal(admJson.data.summary.total_input_tokens, 3550);
      assert.equal(admJson.data.summary.total_output_tokens, 730);
      assert.equal(admJson.data.summary.total_cached_tokens, 2952);
      assert.equal(admJson.data.results.length, 2);
      assert.equal(admJson.data.results[0].config_name, 'Personio Token Test Config');
    } finally {
      await srv.close();
    }
  });

  it('2. Enforces Irreversible Stop -> Archive / Unarchive -> 90-Day Soft-Delete lifecycle and Draft direct-delete rule', async () => {
    const srv = await createSqliteBackedPhpServer();
    try {
      const userHeaders = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer usr_token_f34'
      };
      const adminHeaders = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer adm_token_f34'
      };

      // A. Create unstarted Draft Config #1 -> Can be deleted directly without stopping first
      const draftRes = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: userHeaders,
        body: JSON.stringify({
          name: 'Draft Config Direct Delete',
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          keywords_prompts: ['Draft Prompt'],
          competitors: ['Workday'],
          target_llms: ['openai/gpt-6-luna']
        })
      });
      const draftCfg = (await draftRes.json()).data.config;
      assert.equal(draftCfg.full_started_at, null);
      assert.equal(draftCfg.can_delete, true);
      assert.equal(draftCfg.can_stop, false);

      // Delete unstarted draft directly -> HTTP 200 (90-day soft-delete)
      const delDraftRes = await fetch(`${srv.baseUrl}/api/configs.php?id=${draftCfg.id}`, {
        method: 'DELETE',
        headers: userHeaders
      });
      const delDraftJson = await delDraftRes.json();
      assert.equal(delDraftRes.status, 200);
      assert.equal(delDraftJson.data.status, 'deleted');
      assert.equal(delDraftJson.data.retention_days, 90);

      // B. Create Config #2 and activate Full Start
      const fullRes = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: userHeaders,
        body: JSON.stringify({
          name: 'Full Started Config Lifecycle',
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          keywords_prompts: ['Active Prompt'],
          competitors: ['Workday'],
          target_llms: ['openai/gpt-6-luna'],
          full_start: true
        })
      });
      const fullCfg = (await fullRes.json()).data.config;
      assert.ok(fullCfg.full_started_at);
      assert.equal(fullCfg.status, 'active');
      assert.equal(fullCfg.can_stop, true);
      assert.equal(fullCfg.can_archive, false);
      assert.equal(fullCfg.can_delete, false);

      // Ingest a run on Config #2 so we can verify 90-day retention in user_results_2
      await fetch(`${srv.baseUrl}/api/ingest.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Chatlytics-Ingest-Key': 'chatlytics_dev_secret_key_2026'
        },
        body: JSON.stringify({
          config_id: fullCfg.id,
          user_id: 2,
          custom_id: 'cl_f34_lifecycle_run_1',
          input_tokens: 900,
          output_tokens: 210,
          cached_tokens: 768,
          is_test_run: 1,
          prompt: 'Active Prompt',
          provider: 'openai',
          model: 'gpt-6-luna',
          brand_name: 'Personio',
          status: 'completed',
          brand_mentioned: 1,
          mece_category: '1_DIRECT_WIN',
          geo_quadrant: 'NONE',
          raw_response_text: 'Personio ist top.'
        })
      });

      // Attempting to Archive or Delete a Full-Started Active config directly MUST fail with 409
      const prematureArch = await fetch(`${srv.baseUrl}/api/configs.php?id=${fullCfg.id}`, {
        method: 'PUT',
        headers: userHeaders,
        body: JSON.stringify({ action: 'archive' })
      });
      assert.equal(prematureArch.status, 409);

      const prematureDel = await fetch(`${srv.baseUrl}/api/configs.php?id=${fullCfg.id}`, {
        method: 'DELETE',
        headers: userHeaders
      });
      assert.equal(prematureDel.status, 409);

      // Stop Config #2 -> HTTP 200
      const stopRes = await fetch(`${srv.baseUrl}/api/configs.php?id=${fullCfg.id}`, {
        method: 'PUT',
        headers: userHeaders,
        body: JSON.stringify({ action: 'stop' })
      });
      const stopJson = await stopRes.json();
      assert.equal(stopRes.status, 200);
      assert.equal(stopJson.data.config.status, 'stopped');
      assert.ok(stopJson.data.config.stopped_at);
      assert.equal(stopJson.data.config.next_run_at, null);
      assert.equal(stopJson.data.config.can_archive, true);
      assert.equal(stopJson.data.config.can_delete, true);

      // Attempting to resume or modify a Stopped config MUST fail with 409
      const resumeAttempt = await fetch(`${srv.baseUrl}/api/configs.php?id=${fullCfg.id}`, {
        method: 'PUT',
        headers: userHeaders,
        body: JSON.stringify({ status: 'active' })
      });
      assert.equal(resumeAttempt.status, 409);

      // Archive Stopped Config #2 -> HTTP 200
      const archRes = await fetch(`${srv.baseUrl}/api/configs.php?id=${fullCfg.id}`, {
        method: 'PUT',
        headers: userHeaders,
        body: JSON.stringify({ action: 'archive' })
      });
      const archJson = await archRes.json();
      assert.equal(archRes.status, 200);
      assert.equal(archJson.data.config.status, 'archived');
      assert.ok(archJson.data.config.archived_at);

      // Unarchive Config #2 -> returns to 'stopped' (still non-resumable)
      const unarchRes = await fetch(`${srv.baseUrl}/api/configs.php?id=${fullCfg.id}`, {
        method: 'PUT',
        headers: userHeaders,
        body: JSON.stringify({ action: 'unarchive' })
      });
      const unarchJson = await unarchRes.json();
      assert.equal(unarchRes.status, 200);
      assert.equal(unarchJson.data.config.status, 'stopped');

      // Delete Stopped Config #2 -> 90-day soft-delete
      const delRes = await fetch(`${srv.baseUrl}/api/configs.php?id=${fullCfg.id}`, {
        method: 'DELETE',
        headers: userHeaders
      });
      assert.equal(delRes.status, 200);

      // User dashboard no longer sees Config #2 in GET /api/configs.php, reports.php, or user_results.php
      const listRes = await fetch(`${srv.baseUrl}/api/configs.php`, { headers: userHeaders });
      const listJson = await listRes.json();
      assert.equal(listJson.data.configs.length, 0);

      const usrResultsRes = await fetch(`${srv.baseUrl}/api/user_results.php`, { headers: userHeaders });
      const usrResultsJson = await usrResultsRes.json();
      assert.equal(usrResultsJson.data.results.length, 0);

      // Admin STILL sees the deleted config's runs during the 90-day retention window
      const admResultsRes = await fetch(`${srv.baseUrl}/api/user_results.php?user_id=2&include_deleted=1`, {
        headers: adminHeaders
      });
      const admResultsJson = await admResultsRes.json();
      assert.equal(admResultsJson.data.results.length, 1);
      assert.equal(admResultsJson.data.results[0].config_status, 'deleted');
      assert.equal(admResultsJson.data.results[0].input_tokens, 900);
      assert.equal(admResultsJson.data.results[0].output_tokens, 210);

      // Age Config #2 past 90 days (91 days) and trigger purge -> hard-deleted from DB
      const purgeRes = await fetch(`${srv.baseUrl}/__age_deleted?config_id=${fullCfg.id}&days=91`);
      const purgeJson = await purgeRes.json();
      assert.ok(purgeJson.purged >= 1);

      const admAfterPurge = await fetch(`${srv.baseUrl}/api/user_results.php?user_id=2&include_deleted=1`, {
        headers: adminHeaders
      });
      const admAfterPurgeJson = await admAfterPurge.json();
      assert.equal(admAfterPurgeJson.data.results.length, 0);
    } finally {
      await srv.close();
    }
  });

  it('3. Exposes Admin Run & Token Inspector modal in admin.html/admin.js and Stop/Archive/Delete controls in dashboard.html/dashboard.js', () => {
    const adminHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'admin.html'), 'utf8');
    assert.ok(adminHtml.includes('id="run-token-modal"'), 'admin.html must include #run-token-modal');
    assert.ok(adminHtml.includes('id="run-token-total-input"'), 'admin.html must include #run-token-total-input');
    assert.ok(adminHtml.includes('id="run-token-total-output"'), 'admin.html must include #run-token-total-output');

    const adminJs = require(path.join(PROJECT_ROOT, 'assets/js/admin.js'));
    assert.equal(typeof adminJs.openRunTokenModal, 'function');
    assert.equal(typeof adminJs.renderRunTokenInspector, 'function');

    const dashHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'dashboard.html'), 'utf8');
    assert.ok(dashHtml.includes('id="btn-stop-config"'), 'dashboard.html must include #btn-stop-config');
    assert.ok(dashHtml.includes('id="btn-archive-config"'), 'dashboard.html must include #btn-archive-config');
    assert.ok(dashHtml.includes('id="btn-delete-config"'), 'dashboard.html must include #btn-delete-config');

    const workerRaw = fs.readFileSync(path.join(PROJECT_ROOT, 'n8n/chatlytics_universal_worker.json'), 'utf8');
    assert.ok(workerRaw.includes('extractInputTokens'), 'n8n worker must extract input_tokens');
    assert.ok(workerRaw.includes('extractOutputTokens'), 'n8n worker must extract output_tokens');
  });
});
