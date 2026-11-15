/**
 * tests/tier1_features/f35_admin_cockpit_v2.test.js
 * Feature 35: Admin Cockpit v2 — User Telemetry, Quick Actions, Live n8n Model Management,
 * Analyse-Sets (Model Presets), Subscription Plan Quotas & Dynamic Stripe Mapping.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
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
      if (res.ok) { const j = await res.json().catch(() => null); if (j && j.ok === true) return; }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error(`PHP test server on port ${port} did not start within ${timeoutMs}ms`);
}

function signStripePayload(payloadJson, secret = 'whsec_test_secret_12345') {
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${payloadJson}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

async function createSqliteBackedPhpServer(extraEnv = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlytics-f35-'));
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
    tier TEXT DEFAULT 'free',
    credits_remaining INTEGER DEFAULT 200,
    api_key TEXT NULL,
    magic_audit_token TEXT NULL,
    stripe_customer_id TEXT NULL,
    stripe_subscription_id TEXT NULL,
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
    preset_id TEXT NULL,
    target_llms TEXT NOT NULL,
    search_enabled INTEGER DEFAULT 1,
    schedule_interval TEXT DEFAULT 'every_120m',
    datasets_per_day INTEGER DEFAULT 12,
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE batch_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    custom_id TEXT UNIQUE NOT NULL,
    prompt_cache_key TEXT NULL,
    execution_strategy TEXT NOT NULL DEFAULT 'prompt_caching',
    provider_batch_id TEXT NULL,
    run_id INTEGER NULL,
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
    submitted_at DATETIME NULL,
    completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO users (id, email, password_hash, company_name, role, tier, credits_remaining, api_key, status) VALUES
    (1, 'admin@chatlytics.de', 'hash', 'Chatlytics HQ', 'admin', 'enterprise_managed', 9999, 'adm_token_f35', 'active'),
    (2, 'free@kunde.de', 'hash', 'Free GmbH', 'user', 'free', 40, 'free_token_f35', 'active'),
    (3, 'starter@personio.de', 'hash', 'Personio SE', 'user', 'starter', 500, 'starter_token_f35', 'active'),
    (4, 'growth@celonis.de', 'hash', 'Celonis SE', 'user', 'growth', 2000, 'growth_token_f35', 'active');
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
if ($uri === '/__seed_telemetry') {
  $sql = <<<'SQL'
    INSERT INTO tracking_configs (id, user_id, name, brand_name, brand_domains, keywords_prompts, competitors, target_llms, status, next_run_at) VALUES
      (101, 3, 'Cfg A', 'Personio', '["personio.de"]', '["P1"]', '["Workday"]', '["openai/gpt-6-luna"]', 'active', '2026-12-01 00:00:00'),
      (102, 3, 'Cfg B', 'Personio', '["personio.de"]', '["P2"]', '["Workday"]', '["openai/gpt-6-luna"]', 'paused', NULL),
      (103, 3, 'Cfg Deleted', 'Personio', '["personio.de"]', '["P3"]', '["Workday"]', '["openai/gpt-6-luna"]', 'deleted', NULL);
    INSERT INTO batch_requests (custom_id, user_id, config_id, prompt, provider, model, brand_name, brand_domains, competitors, status) VALUES
      ('q_35_1', 3, 101, 'P1', 'openai', 'gpt-6-luna', 'Personio', '["personio.de"]', '[]', 'queued');
    INSERT INTO llm_runs (config_id, user_id, prompt, provider, model, input_tokens, output_tokens, cached_tokens) VALUES
      (101, 3, 'P1', 'openai', 'gpt-6-luna', 1000, 200, 500),
      (101, 3, 'P1', 'gemini', 'models/gemini-3.5-flash', 800, 200, 0),
      (102, 3, 'P2', 'openai', 'gpt-6-luna', 1200, 600, 300);
SQL;
  $pdo->exec($sql);
  header('Content-Type: application/json');
  echo json_encode(['seeded' => true]);
  exit;
}

$target = '${API_DIR.replace(/\\/g, '/')}/' . basename($uri);
if (is_file($target)) {
  require $target;
  exit;
}
http_response_code(404);
echo json_encode(['error' => 'Not Found']);
`;
  fs.writeFileSync(routerPath, routerCode, 'utf8');

  const port = await getFreePort();
  const proc = spawn(
    'php',
    ['-d', 'extension=pdo_sqlite', '-d', 'extension=sqlite3', '-S', `127.0.0.1:${port}`, routerPath],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: 'ignore'
    }
  );
  await waitForServer(port);

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => {
      try { proc.kill(); } catch (_) {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  };
}

describe('Feature 35: Admin Cockpit v2 & Model Presets', () => {
  it('35.1 User Overview Table returns accurate configs, tokens, avg tokens/run and avg tokens/config without JOIN multiplication', async () => {
    const srv = await createSqliteBackedPhpServer();
    try {
      await fetch(`${srv.baseUrl}/__seed_telemetry`);

      const unauthRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=list`, {
        headers: { 'Authorization': 'Bearer starter_token_f35' }
      });
      assert.equal(unauthRes.status, 403);

      const res = await fetch(`${srv.baseUrl}/api/admin_users.php?action=list`, {
        headers: { 'Authorization': 'Bearer adm_token_f35' }
      });
      const json = await res.json();
      assert.equal(res.status, 200);
      const starter = json.data.users.find(u => u.email === 'starter@personio.de');
      assert.ok(starter);
      assert.equal(starter.config_count, 2); // Cfg A + Cfg B (excludes soft-deleted Cfg Deleted)
      assert.equal(starter.active_config_count, 1);
      assert.equal(starter.paused_config_count, 1);
      assert.equal(starter.run_count, 3);
      assert.equal(starter.total_input_tokens, 3000);
      assert.equal(starter.total_output_tokens, 1000);
      assert.equal(starter.total_tokens, 4000);
      assert.equal(starter.avg_tokens_per_run, 1333); // round(4000/3)
      assert.equal(starter.avg_tokens_per_config, 2000); // 4000/2
      assert.equal(json.data.platform_kpis.total_configs, 2);
      assert.equal(json.data.platform_kpis.total_tokens, 4000);
    } finally {
      srv.close();
    }
  });

  it('35.2 Quick Actions: pause_all_configs, set_user_status (with auto-pause & 401 enforcement), and update_user_tier', async () => {
    const srv = await createSqliteBackedPhpServer();
    try {
      await fetch(`${srv.baseUrl}/__seed_telemetry`);
      const admHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer adm_token_f35' };

      // 1. Pause all active configs for starter user (id=3)
      const pauseRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=pause_all_configs`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ user_id: 3 })
      });
      const pauseJson = await pauseRes.json();
      assert.equal(pauseRes.status, 200);
      assert.equal(pauseJson.data.paused_count, 1);

      // Re-reactivate config 101 to verify suspension also auto-pauses
      await fetch(`${srv.baseUrl}/api/configs.php?id=101`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer starter_token_f35' },
        body: JSON.stringify({ status: 'active' })
      });

      // 2. Self-suspension guard
      const selfSuspendRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=set_user_status`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ user_id: 1, status: 'suspended' })
      });
      assert.equal(selfSuspendRes.status, 422);

      // 3. Suspend client user (id=3)
      const suspRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=set_user_status`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ user_id: 3, status: 'suspended' })
      });
      const suspJson = await suspRes.json();
      assert.equal(suspRes.status, 200);
      assert.equal(suspJson.data.status, 'suspended');
      assert.equal(suspJson.data.paused_configs_count, 1);

      // Suspended user is immediately blocked with 401 on client endpoints
      const blockedCfgRes = await fetch(`${srv.baseUrl}/api/configs.php`, {
        headers: { 'Authorization': 'Bearer starter_token_f35' }
      });
      assert.equal(blockedCfgRes.status, 401);

      // Reactivate restores access
      const reactRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=set_user_status`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ user_id: 3, status: 'active' })
      });
      assert.equal(reactRes.status, 200);
      const restoredCfgRes = await fetch(`${srv.baseUrl}/api/configs.php`, {
        headers: { 'Authorization': 'Bearer starter_token_f35' }
      });
      assert.equal(restoredCfgRes.status, 200);

      // 4. Change tier + apply plan credits
      const tierRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=update_user_tier`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ user_id: 2, tier: 'growth', apply_plan_credits: true })
      });
      const tierJson = await tierRes.json();
      assert.equal(tierRes.status, 200);
      assert.equal(tierJson.data.tier, 'growth');
      assert.equal(tierJson.data.credits_remaining, 2000);
    } finally {
      srv.close();
    }
  });

  it('35.3 Live n8n Model Sync (online mock + offline fallback), save_model & toggle_model', async () => {
    let mockReceivedAction = null;
    const mockN8nServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { mockReceivedAction = JSON.parse(body).action; } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          provider_credentials: [
            { provider: 'openai', credential_name: 'OpenAI Live Cred', status: 'connected' },
            { provider: 'anthropic', credential_name: 'Anthropic Live Cred', status: 'connected' }
          ],
          models: [
            {
              id: 'openai/gpt-6-luna',
              provider: 'openai',
              model_name: 'gpt-6-luna',
              display_name: 'OpenAI · GPT-6 Luna',
              eu_hosted: false,
              supports_web_search: true,
              supports_batch_api: true,
              supports_tools: true,
              execution_strategy: 'batch_api',
              n8n_credential_name: 'OpenRouter - Chatlytics - Chatlytics-dev-1',
              sort_order: 10
            },
            {
              id: 'anthropic/claude-4-sonnet',
              provider: 'anthropic',
              model_name: 'claude-4-sonnet',
              display_name: 'Anthropic · Claude 4 Sonnet',
              eu_hosted: false,
              supports_web_search: true,
              supports_batch_api: true,
              supports_tools: true,
              execution_strategy: 'batch_api',
              n8n_credential_name: 'OpenRouter - Chatlytics - Chatlytics-dev-1',
              sort_order: 70
            },
            {
              id: 'anthropic/claude-4-sonnet:batch',
              provider: 'anthropic',
              model_name: 'claude-4-sonnet:batch',
              display_name: 'Anthropic · Claude 4 Sonnet (Batch)',
              eu_hosted: false,
              supports_batch_api: true
            },
            {
              id: 'openai/dall-e-3',
              provider: 'openai',
              model_name: 'dall-e-3',
              display_name: 'DALL-E 3 (Blocked image)',
              architecture: { input_modalities: ['text'], output_modalities: ['image'] }
            },
            {
              id: 'cohere/command-r-plus',
              provider: 'cohere',
              model_name: 'command-r-plus',
              display_name: 'Unlisted Provider Model'
            }
          ]
        }));
      });
    });

    const n8nPort = await getFreePort();
    await new Promise(resolve => mockN8nServer.listen(n8nPort, '127.0.0.1', resolve));

    const srv = await createSqliteBackedPhpServer({ N8N_WEBHOOK_URL: `http://127.0.0.1:${n8nPort}/webhook/chatlytics-run` });
    try {
      const admHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer adm_token_f35' };

      // Live sync against mock n8n
      const syncRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=sync_n8n_models`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({})
      });
      const syncJson = await syncRes.json();
      assert.equal(syncRes.status, 200);
      assert.equal(mockReceivedAction, 'discover_models');
      assert.equal(syncJson.data.synced, true);
      assert.equal(syncJson.data.fallback, false);
      const claude = syncJson.data.models.find(m => m.id === 'anthropic/claude-4-sonnet');
      assert.ok(claude);
      assert.equal(claude.n8n_sync_status, 'connected');
      assert.equal(claude.is_allowed, false, 'Newly discovered OpenRouter models must default to is_allowed = false');
      assert.equal(claude.supports_batch_api, true);
      // Verify :batch suffix was collapsed and non-whitelisted / non-text models excluded
      assert.equal(syncJson.data.models.some(m => m.id.endsWith(':batch')), false);
      assert.equal(syncJson.data.models.some(m => m.id === 'openai/dall-e-3'), false);
      assert.equal(syncJson.data.models.some(m => m.id === 'cohere/command-r-plus'), false);

      // Blocked before admin enables newly discovered model
      const blockedBeforeEnable = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer growth_token_f35' },
        body: JSON.stringify({
          name: 'Blocked Before Enable',
          brand_name: 'Celonis',
          brand_domains: ['celonis.com'],
          keywords_prompts: ['Process Mining'],
          target_llms: ['anthropic/claude-4-sonnet']
        })
      });
      assert.equal(blockedBeforeEnable.status, 403);

      // Admin enables model -> Growth can select it, then disable -> Growth gets 403
      const enableRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=toggle_model`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ id: 'anthropic/claude-4-sonnet', is_allowed: true })
      });
      assert.equal(enableRes.status, 200);

      const allowedCfg = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer growth_token_f35' },
        body: JSON.stringify({
          name: 'Allowed After Enable',
          brand_name: 'Celonis',
          brand_domains: ['celonis.com'],
          keywords_prompts: ['Process Mining'],
          target_llms: ['anthropic/claude-4-sonnet']
        })
      });
      assert.equal(allowedCfg.status, 201);

      const toggleRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=toggle_model`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ id: 'anthropic/claude-4-sonnet', is_allowed: false })
      });
      assert.equal(toggleRes.status, 200);

      const blockedModelCfg = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer growth_token_f35' },
        body: JSON.stringify({
          name: 'Blocked Model Check',
          brand_name: 'Celonis',
          brand_domains: ['celonis.com'],
          keywords_prompts: ['Process Mining'],
          target_llms: ['anthropic/claude-4-sonnet']
        })
      });
      assert.equal(blockedModelCfg.status, 403);

      // Offline fallback test: close mock server and re-sync
      await new Promise(resolve => mockN8nServer.close(resolve));
      const fallbackRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=sync_n8n_models`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({})
      });
      const fallbackJson = await fallbackRes.json();
      assert.equal(fallbackRes.status, 200);
      assert.equal(fallbackJson.data.synced, false);
      assert.equal(fallbackJson.data.fallback, true);
      assert.ok(fallbackJson.data.models.length >= 6);
    } finally {
      try { mockN8nServer.close(); } catch (_) {}
      srv.close();
    }
  });

  it('35.4 Analyse-Sets (Model Presets) CRUD and strict plan enforcement in configs.php', async () => {
    const srv = await createSqliteBackedPhpServer();
    try {
      const admHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer adm_token_f35' };
      const freeHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer free_token_f35' };
      const starterHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer starter_token_f35' };
      const growthHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer growth_token_f35' };

      // 1. Free user rejected on custom models (403)
      const freeCustom = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: freeHeaders,
        body: JSON.stringify({
          brand_name: 'FreeTest',
          brand_domains: ['freetest.de'],
          keywords_prompts: ['Test Prompt'],
          target_llms: ['openai/gpt-6-luna'],
          search_enabled: false
        })
      });
      assert.equal(freeCustom.status, 403);

      // 2. Free user rejected on Starter-only preset (eu_sovereign_dsgvo -> 403)
      const freeStarterPreset = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: freeHeaders,
        body: JSON.stringify({
          brand_name: 'FreeTest',
          brand_domains: ['freetest.de'],
          keywords_prompts: ['Test Prompt'],
          preset_id: 'eu_sovereign_dsgvo'
        })
      });
      assert.equal(freeStarterPreset.status, 403);

      // 3. Free user succeeds with dach_core_baseline preset
      const freeValid = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: freeHeaders,
        body: JSON.stringify({
          brand_name: 'FreeTest',
          brand_domains: ['freetest.de'],
          keywords_prompts: ['Test Prompt'],
          preset_id: 'dach_core_baseline'
        })
      });
      const freeJson = await freeValid.json();
      assert.equal(freeValid.status, 201);
      assert.equal(freeJson.data.config.preset_id, 'dach_core_baseline');
      assert.equal(freeJson.data.config.search_enabled, true);

      // 4. Starter user succeeds with eu_sovereign_dsgvo and overrides search_enabled -> false
      const starterValid = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: starterHeaders,
        body: JSON.stringify({
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          keywords_prompts: ['HR Tool'],
          preset_id: 'eu_sovereign_dsgvo',
          search_enabled: true // Server overrides from preset spec
        })
      });
      const starterJson = await starterValid.json();
      assert.equal(starterValid.status, 201);
      assert.equal(starterJson.data.config.preset_id, 'eu_sovereign_dsgvo');
      assert.equal(starterJson.data.config.search_enabled, false);
      assert.deepEqual(starterJson.data.config.target_llms, [
        'mistralai/mistral-medium-3-5',
        'mistralai/mistral-large-4-0',
        'z-ai/glm-5.3'
      ]);

      // 5. Growth user freely configures custom single model + search_enabled=false
      const growthCustom = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: growthHeaders,
        body: JSON.stringify({
          brand_name: 'Celonis',
          brand_domains: ['celonis.com'],
          keywords_prompts: ['Process Mining'],
          target_llms: ['openai/gpt-6-luna'],
          search_enabled: false
        })
      });
      assert.equal(growthCustom.status, 201);

      // 6. Preset CRUD: create custom preset, block deleting default preset, delete custom preset
      const savePresetRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=save_preset`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({
          id: 'dach_custom_test',
          name_de: 'DACH Custom Test',
          name_en: 'DACH Custom Test',
          target_llms: ['openai/gpt-6-luna', 'z-ai/glm-5.3'],
          search_enabled: true,
          allowed_tiers: ['growth', 'enterprise_managed']
        })
      });
      assert.equal(savePresetRes.status, 200);

      const delDefaultRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=delete_preset`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ id: 'dach_core_baseline' })
      });
      assert.equal(delDefaultRes.status, 422);

      const delCustomRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=delete_preset`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ id: 'dach_custom_test' })
      });
      assert.equal(delCustomRes.status, 200);
    } finally {
      srv.close();
    }
  });

  it('35.5 Plan Configuration (quotas + Stripe Product/Price mapping), public_catalog & stripe_webhook.php resolution', async () => {
    const srv = await createSqliteBackedPhpServer();
    try {
      const admHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer adm_token_f35' };
      const starterHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer starter_token_f35' };

      // 1. Public catalog works unauthenticated
      const pubRes = await fetch(`${srv.baseUrl}/api/configs.php?action=public_catalog`);
      const pubJson = await pubRes.json();
      assert.equal(pubRes.status, 200);
      assert.ok(Array.isArray(pubJson.data.plans));
      assert.equal(pubJson.data.plans.length, 4);

      // 2. Admin saves updated Starter plan quotas & custom Stripe price mapping
      const savePlanRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=save_plan`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({
          tier: 'starter',
          stripe_product_id: 'prod_custom_starter_99',
          stripe_price_id: 'price_custom_starter_99',
          included_credits: 777,
          max_configs: 1,
          max_competitors_per_config: 2
        })
      });
      assert.equal(savePlanRes.status, 200);

      // Starter exceeding max_competitors_per_config=2 -> 403
      const compErrRes = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: starterHeaders,
        body: JSON.stringify({
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          keywords_prompts: ['HR Software'],
          competitors: ['Comp1', 'Comp2', 'Comp3'],
          preset_id: 'dach_core_baseline'
        })
      });
      assert.equal(compErrRes.status, 403);

      // Starter creates 1 allowed config, then 2nd is blocked by max_configs=1
      const okCfgRes = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: starterHeaders,
        body: JSON.stringify({
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          keywords_prompts: ['HR Software'],
          competitors: ['Comp1'],
          preset_id: 'dach_core_baseline'
        })
      });
      assert.equal(okCfgRes.status, 201);

      const maxCfgErrRes = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: starterHeaders,
        body: JSON.stringify({
          brand_name: 'Personio 2',
          brand_domains: ['personio.de'],
          keywords_prompts: ['HR Software 2'],
          competitors: ['Comp1'],
          preset_id: 'dach_core_baseline'
        })
      });
      assert.equal(maxCfgErrRes.status, 403);

      // 3. Stripe webhook resolves custom price_id -> starter & included_credits = 777
      const webhookPayload = JSON.stringify({
        id: 'evt_f35_custom_price',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_f35_custom',
            client_reference_id: '2',
            customer: 'cus_f35_new',
            subscription: 'sub_f35_new',
            line_items: {
              data: [{ price: { id: 'price_custom_starter_99', product: 'prod_custom_starter_99' } }]
            }
          }
        }
      });
      const whRes = await fetch(`${srv.baseUrl}/api/stripe_webhook.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': signStripePayload(webhookPayload)
        },
        body: webhookPayload
      });
      const whJson = await whRes.json();
      assert.equal(whRes.status, 200);
      assert.equal(whJson.data.tier_assigned, 'starter');
      assert.equal(whJson.data.credits_added, 777);
    } finally {
      srv.close();
    }
  });

  it('35.6 UI DOM, Static Security Guards & Exports integrity across admin, dashboard, and landing page', () => {
    const adminHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'admin.html'), 'utf8');
    const dashHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'dashboard.html'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
    const adminJs = fs.readFileSync(path.join(PROJECT_ROOT, 'assets/js/admin.js'), 'utf8');
    const configsJs = fs.readFileSync(path.join(PROJECT_ROOT, 'assets/js/configs.js'), 'utf8');

    assert.ok(adminHtml.includes('id="admin-tab-users"'));
    assert.ok(adminHtml.includes('id="admin-tab-models"'));
    assert.ok(adminHtml.includes('id="admin-tab-presets"'));
    assert.ok(adminHtml.includes('id="admin-tab-plans"'));
    assert.ok(adminHtml.includes('id="tier-modal"'));
    assert.ok(adminHtml.includes('id="model-modal"'));
    assert.ok(adminHtml.includes('id="preset-modal"'));

    assert.ok(dashHtml.includes('id="cfg-presets-grid"'));
    assert.ok(dashHtml.includes('id="cfg-preset-id"'));
    assert.ok(dashHtml.includes('id="cfg-custom-models-section"'));
    assert.ok(dashHtml.includes('id="cfg-custom-locked-banner"'));

    assert.ok(indexHtml.includes('data-plan-card="free"'));
    assert.ok(indexHtml.includes('data-plan-card="starter"'));
    assert.ok(indexHtml.includes('data-plan-card="growth"'));
    assert.ok(indexHtml.includes('data-plan-card="enterprise_managed"'));
    assert.ok(indexHtml.includes('api/configs.php?action=public_catalog'));

    // Zero unsafe .innerHTML interpolation in updated JS controllers
    for (const [name, src] of [['admin.js', adminJs], ['configs.js', configsJs]]) {
      const unsafeLines = src.split('\n').filter(line => /\.innerHTML\s*=/.test(line) && /\$\{/.test(line) && !line.includes('escapeHtml('));
      assert.equal(unsafeLines.length, 0, `Unsafe innerHTML found in ${name}`);
    }

    const adminMod = require(path.join(PROJECT_ROOT, 'assets/js/admin.js'));
    assert.equal(typeof adminMod.switchAdminTab, 'function');
    assert.equal(typeof adminMod.triggerN8nModelSync, 'function');
    assert.equal(typeof adminMod.handleSavePlan, 'function');

    const { canUserCustomizeModels, DEFAULT_PRESETS } = require(path.join(PROJECT_ROOT, 'assets/js/configs.js'));
    assert.equal(typeof canUserCustomizeModels, 'function');
    assert.equal(canUserCustomizeModels({ role: 'user', tier: 'free' }), false);
    assert.equal(canUserCustomizeModels({ role: 'user', tier: 'starter' }), false);
    assert.equal(canUserCustomizeModels({ role: 'user', tier: 'growth' }), true);
    assert.equal(canUserCustomizeModels({ role: 'admin', tier: 'free' }), true);
    assert.ok(Array.isArray(DEFAULT_PRESETS) && DEFAULT_PRESETS.length >= 4);
  });
});
