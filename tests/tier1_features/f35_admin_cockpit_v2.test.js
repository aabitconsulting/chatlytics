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
$cfg = Config::get();
$cfg['n8n']['shared_secret'] = getenv('N8N_SHARED_SECRET') ?: 'f35_watcher_secret';
if (getenv('N8N_MODEL_WATCHER_WEBHOOK_URL')) {
  $cfg['n8n']['model_watcher_webhook_url'] = getenv('N8N_MODEL_WATCHER_WEBHOOK_URL');
}
Config::set($cfg);

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
if ($uri === '/__seed_legacy_presets') {
  $legacySql = <<<'SQL'
    CREATE TABLE IF NOT EXISTS model_presets (
      id TEXT PRIMARY KEY, name_de TEXT NOT NULL, name_en TEXT NOT NULL,
      description_de TEXT NOT NULL, description_en TEXT NOT NULL,
      badge_de TEXT NULL, badge_en TEXT NULL, target_llms TEXT NOT NULL,
      search_enabled INTEGER NOT NULL DEFAULT 1, allowed_tiers TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE IF NOT EXISTS subscription_plans (
      tier TEXT PRIMARY KEY, name_de TEXT NOT NULL, name_en TEXT NOT NULL,
      subtitle_de TEXT NOT NULL, subtitle_en TEXT NOT NULL,
      price_eur INTEGER NOT NULL DEFAULT 0, price_label_de TEXT NOT NULL DEFAULT '0 €',
      price_label_en TEXT NOT NULL DEFAULT '€0', billing_period_de TEXT NOT NULL DEFAULT '/ Monat',
      billing_period_en TEXT NOT NULL DEFAULT '/ month', stripe_product_id TEXT NULL,
      stripe_price_id TEXT NULL, stripe_checkout_url TEXT NULL,
      included_credits INTEGER NOT NULL DEFAULT 40, max_configs INTEGER NOT NULL DEFAULT 1,
      max_competitors_per_config INTEGER NOT NULL DEFAULT 2, max_prompts_per_config INTEGER NOT NULL DEFAULT 5,
      allowed_intervals TEXT NOT NULL, allow_custom_models INTEGER NOT NULL DEFAULT 0,
      allowed_preset_ids TEXT NOT NULL, features_de TEXT NOT NULL, features_en TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 10
    );
    DELETE FROM model_presets;
    DELETE FROM subscription_plans;
    INSERT INTO model_presets (id, name_de, name_en, description_de, description_en, target_llms, search_enabled, allowed_tiers, is_default, is_active, sort_order) VALUES
      ('dach_core_baseline', 'Old Core', 'Old Core', 'desc', 'desc', '["openai/gpt-6-luna"]', 1, '["free"]', 1, 1, 10),
      ('parametric_brand_memory', 'Old Param', 'Old Param', 'desc', 'desc', '["openai/gpt-6-luna"]', 0, '["starter"]', 0, 1, 20),
      ('eu_sovereign_dsgvo', 'Old EU', 'Old EU', 'desc', 'desc', '["mistralai/mistral-medium-3-5"]', 0, '["starter"]', 0, 1, 30),
      ('executive_full_spectrum', 'Old Exec', 'Old Exec', 'desc', 'desc', '["openai/gpt-6-luna"]', 1, '["growth"]', 0, 1, 40),
      ('custom_enterprise_panel', 'Custom Panel', 'Custom Panel', 'Custom', 'Custom', '["openai/gpt-6-luna"]', 1, '["enterprise_managed"]', 0, 1, 90);
    INSERT INTO subscription_plans (tier, name_de, name_en, subtitle_de, subtitle_en, allowed_intervals, allow_custom_models, allowed_preset_ids, features_de, features_en) VALUES
      ('free', 'Free', 'Free', 's', 's', '["every_120m"]', 0, '["dach_core_baseline"]', '[]', '[]'),
      ('starter', 'Starter', 'Starter', 's', 's', '["every_120m"]', 0, '["dach_core_baseline","eu_sovereign_dsgvo"]', '[]', '[]'),
      ('enterprise_managed', 'Enterprise', 'Enterprise', 's', 's', '["every_120m"]', 1, '["dach_core_baseline","custom_enterprise_panel"]', '[]', '[]');
    INSERT INTO tracking_configs (id, user_id, name, brand_name, brand_domains, keywords_prompts, competitors, preset_id, target_llms, status) VALUES
      (201, 3, 'Legacy Existing Config', 'LegacyBrand', '["legacy.de"]', '["P1"]', '[]', 'dach_core_baseline', '["openai/gpt-6-luna","google/gemini-3.5-flash"]', 'active');
SQL;
  try { $pdo->exec($legacySql); } catch (\Throwable $e) { http_response_code(500); echo json_encode(['err' => $e->getMessage()]); exit; }
  header('Content-Type: application/json');
  echo json_encode(['legacy_seeded' => true]);
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

      // 1b. Verify exact 4 Visibility Tracking presets seeded with 2, 4, 12, 16 models & search_enabled=true
      const presetsListRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=list_presets`, { headers: admHeaders });
      const presetsListJson = await presetsListRes.json();
      assert.equal(presetsListRes.status, 200);
      assert.deepEqual(
        presetsListJson.data.presets.map(p => [p.id, p.target_llms.length, p.search_enabled]),
        [
          ['default_visibility_tracking', 2, true],
          ['advanced_visibility_tracking', 4, true],
          ['360_visibility_tracking', 12, true],
          ['global_visibility_tracking', 16, true]
        ]
      );

      // 2. Free user rejected on Starter+ preset (advanced_visibility_tracking -> 403)
      const freeStarterPreset = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: freeHeaders,
        body: JSON.stringify({
          brand_name: 'FreeTest',
          brand_domains: ['freetest.de'],
          keywords_prompts: ['Test Prompt'],
          preset_id: 'advanced_visibility_tracking'
        })
      });
      assert.equal(freeStarterPreset.status, 403);

      // 3. Free user succeeds with default_visibility_tracking preset (2 models + live web search)
      const freeValid = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: freeHeaders,
        body: JSON.stringify({
          brand_name: 'FreeTest',
          brand_domains: ['freetest.de'],
          keywords_prompts: ['Test Prompt'],
          preset_id: 'default_visibility_tracking'
        })
      });
      const freeJson = await freeValid.json();
      assert.equal(freeValid.status, 201);
      assert.equal(freeJson.data.config.preset_id, 'default_visibility_tracking');
      assert.equal(freeJson.data.config.search_enabled, true);
      assert.deepEqual(freeJson.data.config.target_llms, ['google/gemini-4-hydrogen', 'openai/gpt-6-luna']);

      // 4. Starter user succeeds with advanced_visibility_tracking (4 models, server enforces search_enabled=true) and is rejected on 360 (403)
      const starterBlocked360 = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: starterHeaders,
        body: JSON.stringify({
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          keywords_prompts: ['HR Tool'],
          preset_id: '360_visibility_tracking'
        })
      });
      assert.equal(starterBlocked360.status, 403);

      const starterValid = await fetch(`${srv.baseUrl}/api/configs.php`, {
        method: 'POST',
        headers: starterHeaders,
        body: JSON.stringify({
          brand_name: 'Personio',
          brand_domains: ['personio.de'],
          keywords_prompts: ['HR Tool'],
          preset_id: 'advanced_visibility_tracking',
          search_enabled: false // Server enforces preset search_enabled=true
        })
      });
      const starterJson = await starterValid.json();
      assert.equal(starterValid.status, 201);
      assert.equal(starterJson.data.config.preset_id, 'advanced_visibility_tracking');
      assert.equal(starterJson.data.config.search_enabled, true);
      assert.deepEqual(starterJson.data.config.target_llms, [
        'google/gemini-4-hydrogen',
        'openai/gpt-6-luna',
        'openai/gpt-6.1-terra',
        'anthropic/claude-sonnet-5.5'
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
        body: JSON.stringify({ id: 'default_visibility_tracking' })
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
          preset_id: 'default_visibility_tracking'
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
          preset_id: 'default_visibility_tracking'
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
          preset_id: 'default_visibility_tracking'
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
    assert.ok(adminHtml.includes('id="admin-tab-providers"'));
    assert.ok(adminHtml.includes('id="admin-panel-providers"'));
    assert.ok(adminHtml.includes('id="provider-impact-modal"'));
    assert.ok(adminHtml.includes('<option value="meta">meta</option>'));
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
    assert.equal(typeof adminMod.loadOpenRouterProviders, 'function');
    assert.equal(typeof adminMod.syncOpenRouterProviders, 'function');
    assert.equal(typeof adminMod.handleSaveOpenRouterProviders, 'function');
    assert.equal(typeof adminMod.handleResetOpenRouterProviders, 'function');
    assert.equal(typeof adminMod.computeDeselectedProviderImpact, 'function');

    const { canUserCustomizeModels, DEFAULT_PRESETS } = require(path.join(PROJECT_ROOT, 'assets/js/configs.js'));
    assert.equal(typeof canUserCustomizeModels, 'function');
    assert.equal(canUserCustomizeModels({ role: 'user', tier: 'free' }), false);
    assert.equal(canUserCustomizeModels({ role: 'user', tier: 'starter' }), false);
    assert.equal(canUserCustomizeModels({ role: 'user', tier: 'growth' }), true);
    assert.equal(canUserCustomizeModels({ role: 'admin', tier: 'free' }), true);
    assert.ok(Array.isArray(DEFAULT_PRESETS) && DEFAULT_PRESETS.length >= 4);
  });

  it('35.7 OpenRouter Provider Registry, meta default, active configuration usage stats & safe pruning', async () => {
    let lastN8nPayload = null;
    const mockOpenRouterServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna' },
          { id: 'meta/muse-spark', name: 'Meta Muse Spark' },
          { id: 'meta/muse-wonder', name: 'Meta Muse Wonder' },
          { id: 'cohere/command-a', name: 'Cohere Command A' },
          { id: 'allenai/olmo-2', name: 'AllenAI OLMo 2' }
        ]
      }));
    });
    const mockN8nServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try { lastN8nPayload = JSON.parse(body); } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          models: [
            {
              id: 'openai/gpt-6-luna',
              provider: 'openai',
              model_name: 'gpt-6-luna',
              display_name: 'OpenAI · GPT-6 Luna',
              supports_web_search: true,
              supports_batch_api: true
            },
            {
              id: 'meta/muse-spark',
              provider: 'meta',
              model_name: 'muse-spark',
              display_name: 'Meta · Muse Spark',
              supports_web_search: true,
              supports_batch_api: false
            },
            {
              id: 'cohere/command-a',
              provider: 'cohere',
              model_name: 'command-a',
              display_name: 'Cohere · Command A',
              supports_web_search: true,
              supports_batch_api: false
            }
          ]
        }));
      });
    });

    const orPort = await getFreePort();
    const n8nPort = await getFreePort();
    await new Promise(resolve => mockOpenRouterServer.listen(orPort, '127.0.0.1', resolve));
    await new Promise(resolve => mockN8nServer.listen(n8nPort, '127.0.0.1', resolve));

    const srv = await createSqliteBackedPhpServer({
      OPENROUTER_MODELS_URL: `http://127.0.0.1:${orPort}/api/v1/models`,
      N8N_WEBHOOK_URL: `http://127.0.0.1:${n8nPort}/webhook/chatlytics-run`
    });
    try {
      await fetch(`${srv.baseUrl}/__seed_telemetry`);
      const admHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer adm_token_f35' };

      // 0. Non-admin access rejected with 403
      const nonAdmRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=list_openrouter_providers`, {
        headers: { 'Authorization': 'Bearer starter_token_f35' }
      });
      assert.equal(nonAdmRes.status, 403);

      // 1. Default provider registry includes all 16 legacy defaults + meta, plus active config counts (ignoring deleted Cfg Deleted)
      const listRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=list_openrouter_providers`, {
        headers: { 'Authorization': 'Bearer adm_token_f35' }
      });
      const listJson = await listRes.json();
      assert.equal(listRes.status, 200);
      const defaults = listJson.data.default_providers;
      assert.equal(defaults.length, 17);
      assert.ok(defaults.includes('meta'), 'Default providers must include meta alongside meta-llama');
      assert.ok(defaults.includes('meta-llama'));
      const openaiProv = listJson.data.providers.find(p => p.provider_key === 'openai');
      assert.ok(openaiProv);
      assert.equal(openaiProv.is_relevant, true);
      assert.equal(openaiProv.active_config_count, 1, 'Cfg A active counted, Cfg Deleted ignored');
      assert.equal(openaiProv.paused_config_count, 1, 'Cfg B paused counted');
      assert.ok(openaiProv.used_models.some(m => m.model_id === 'openai/gpt-6-luna' && m.config_samples.some(c => c.name === 'Cfg A')));

      // 2. list_models also attaches active configuration usage stats
      const modelsListRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=list_models`, {
        headers: { 'Authorization': 'Bearer adm_token_f35' }
      });
      const modelsListJson = await modelsListRes.json();
      const gpt6 = modelsListJson.data.models.find(m => m.id === 'openai/gpt-6-luna');
      assert.ok(gpt6);
      assert.equal(gpt6.active_config_count, 1);
      assert.equal(gpt6.paused_config_count, 1);

      // 3. sync_openrouter_providers discovers providers via n8n and direct OpenRouter fallback
      const syncProvRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=sync_openrouter_providers`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({})
      });
      assert.equal(syncProvRes.status, 200);
      assert.equal(lastN8nPayload?.include_all_providers, true);

      const directSrv = await createSqliteBackedPhpServer({
        OPENROUTER_MODELS_URL: `http://127.0.0.1:${orPort}/api/v1/models`,
        N8N_WEBHOOK_URL: 'http://127.0.0.1:9/unreachable'
      });
      try {
        const directRes = await fetch(`${directSrv.baseUrl}/api/admin_users.php?action=sync_openrouter_providers`, {
          method: 'POST',
          headers: admHeaders,
          body: JSON.stringify({})
        });
        const directJson = await directRes.json();
        assert.equal(directRes.status, 200);
        assert.equal(directJson.data.synced, true);
        assert.equal(directJson.data.source, 'openrouter_direct');
        const allenai = directJson.data.providers.find(p => p.provider_key === 'allenai');
        const metaProv = directJson.data.providers.find(p => p.provider_key === 'meta');
        assert.ok(allenai);
        assert.equal(allenai.is_relevant, false);
        assert.equal(allenai.discovered_model_count, 1);
        assert.ok(metaProv && metaProv.is_relevant === true);
        assert.equal(metaProv.discovered_model_count, 2);
        assert.ok(metaProv.sample_models.includes('meta/muse-spark'));
        assert.ok(metaProv.sample_models.includes('meta/muse-wonder'));
      } finally {
        directSrv.close();
      }

      // 4. Live n8n sync with default set includes meta/muse-spark and excludes cohere/command-a
      const syncModels1 = await fetch(`${srv.baseUrl}/api/admin_users.php?action=sync_n8n_models`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({})
      });
      const syncModels1Json = await syncModels1.json();
      assert.equal(syncModels1.status, 200);
      assert.ok(Array.isArray(lastN8nPayload?.allowed_providers) && lastN8nPayload.allowed_providers.includes('meta'));
      assert.equal(syncModels1Json.data.models.some(m => m.id === 'meta/muse-spark'), true);
      assert.equal(syncModels1Json.data.models.some(m => m.id === 'cohere/command-a'), false);

      // 5. Enable cohere -> re-sync includes cohere/command-a (is_allowed=false initially)
      const addCohereRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=save_openrouter_providers`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ providers: [...defaults, 'cohere'] })
      });
      const addCohereJson = await addCohereRes.json();
      assert.equal(addCohereRes.status, 200);
      assert.ok(addCohereJson.data.relevant_providers.includes('cohere'));

      const syncModels2 = await fetch(`${srv.baseUrl}/api/admin_users.php?action=sync_n8n_models`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({})
      });
      const syncModels2Json = await syncModels2.json();
      assert.ok(lastN8nPayload?.allowed_providers?.includes('cohere'));
      const cohereModel = syncModels2Json.data.models.find(m => m.id === 'cohere/command-a');
      assert.ok(cohereModel && cohereModel.is_allowed === false);

      // 6. Remove cohere AND openai: unused cohere/command-a is pruned, active openai/gpt-6-luna stays preserved in DB!
      const withoutCohereOpenai = defaults.filter(p => p !== 'openai');
      const pruneRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=save_openrouter_providers`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ providers: withoutCohereOpenai })
      });
      const pruneJson = await pruneRes.json();
      assert.equal(pruneRes.status, 200);
      assert.ok(pruneJson.data.pruned_model_ids.includes('cohere/command-a'));
      assert.ok(pruneJson.data.preserved_active_models.some(m => m.model_id === 'openai/gpt-6-luna' && m.active_config_count === 1));
      assert.equal(pruneJson.data.models.some(m => m.id === 'openai/gpt-6-luna'), false, 'Default list_models hides deselected providers');

      const inclExcludedRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=list_models&include_excluded=1`, {
        headers: { 'Authorization': 'Bearer adm_token_f35' }
      });
      const inclExcludedJson = await inclExcludedRes.json();
      assert.equal(inclExcludedJson.data.models.some(m => m.id === 'openai/gpt-6-luna'), true, 'Active model still preserved in llm_models');
      assert.equal(inclExcludedJson.data.models.some(m => m.id === 'cohere/command-a'), false, 'Unused deselected model was pruned');

      // 7. Reset back to defaults restores all 17 providers (including openai & meta)
      const resetRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=reset_openrouter_providers`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({})
      });
      const resetJson = await resetRes.json();
      assert.equal(resetRes.status, 200);
      assert.ok(resetJson.data.relevant_providers.includes('openai'));
      assert.ok(resetJson.data.relevant_providers.includes('meta'));
      assert.equal(resetJson.data.models.some(m => m.id === 'openai/gpt-6-luna'), true);
    } finally {
      try { mockOpenRouterServer.close(); } catch (_) {}
      try { mockN8nServer.close(); } catch (_) {}
      srv.close();
    }
  });

  it('35.8 Idempotent legacy preset migration removes 4 retired presets while preserving custom presets & tracking_configs', async () => {
    const srv = await createSqliteBackedPhpServer();
    try {
      const admHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer adm_token_f35' };
      const starterHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer starter_token_f35' };

      const seedLegacyRes = await fetch(`${srv.baseUrl}/__seed_legacy_presets`);
      assert.equal(seedLegacyRes.status, 200, await seedLegacyRes.text());

      const presetsRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=list_presets`, { headers: admHeaders });
      const presetsJson = await presetsRes.json();
      assert.equal(presetsRes.status, 200);
      const ids = presetsJson.data.presets.map(p => p.id);

      // Retired legacy presets are gone
      assert.equal(ids.includes('dach_core_baseline'), false);
      assert.equal(ids.includes('parametric_brand_memory'), false);
      assert.equal(ids.includes('eu_sovereign_dsgvo'), false);
      assert.equal(ids.includes('executive_full_spectrum'), false);

      // All 4 new Visibility Tracking presets + existing custom preset exist
      assert.ok(ids.includes('default_visibility_tracking'));
      assert.ok(ids.includes('advanced_visibility_tracking'));
      assert.ok(ids.includes('360_visibility_tracking'));
      assert.ok(ids.includes('global_visibility_tracking'));
      assert.ok(ids.includes('custom_enterprise_panel'), 'Custom admin preset must be preserved');

      // Plans migrated cleanly without losing custom preset reference
      const plansRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=list_plans`, { headers: admHeaders });
      const plansJson = await plansRes.json();
      const freePlan = plansJson.data.plans.find(p => p.tier === 'free');
      const starterPlan = plansJson.data.plans.find(p => p.tier === 'starter');
      const entPlan = plansJson.data.plans.find(p => p.tier === 'enterprise_managed');
      assert.deepEqual(freePlan.allowed_preset_ids, ['default_visibility_tracking']);
      assert.deepEqual(starterPlan.allowed_preset_ids, ['default_visibility_tracking', 'advanced_visibility_tracking']);
      assert.ok(entPlan.allowed_preset_ids.includes('global_visibility_tracking'));
      assert.ok(entPlan.allowed_preset_ids.includes('custom_enterprise_panel'), 'Actual entPlan: ' + JSON.stringify(entPlan));

      // Existing tracking_configs row stays completely untouched
      const cfgsRes = await fetch(`${srv.baseUrl}/api/configs.php`, { headers: starterHeaders });
      const cfgsJson = await cfgsRes.json();
      const legacyCfg = cfgsJson.data.configs.find(c => Number(c.id) === 201);
      assert.ok(legacyCfg);
      assert.deepEqual(legacyCfg.target_llms, ['openai/gpt-6-luna', 'google/gemini-3.5-flash']);
    } finally {
      srv.close();
    }
  });

  it('35.9 Model Lifecycle Alerts API (secret auth, dedup ingest, replace_in_presets, dismiss) & n8n watcher workflow integrity', async () => {
    const srv = await createSqliteBackedPhpServer({ N8N_SHARED_SECRET: 'f35_watcher_secret' });
    try {
      await fetch(`${srv.baseUrl}/__seed_telemetry`);
      const admHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer adm_token_f35' };
      const n8nHeaders = { 'Content-Type': 'application/json', 'X-N8N-Secret': 'f35_watcher_secret' };

      // 1. Unauthenticated & wrong secret requests strictly rejected (401)
      const unauthCat = await fetch(`${srv.baseUrl}/api/admin_users.php?action=watcher_catalog`);
      assert.equal(unauthCat.status, 401);
      const wrongSec = await fetch(`${srv.baseUrl}/api/admin_users.php?action=ingest_model_alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-N8N-Secret': 'wrong_secret' },
        body: JSON.stringify({ alerts: [] })
      });
      assert.equal(wrongSec.status, 401);

      // 2. watcher_catalog returns all 16 canonical models with preset references
      const catRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=watcher_catalog`, { headers: n8nHeaders });
      const catJson = await catRes.json();
      assert.equal(catRes.status, 200);
      assert.ok(catJson.data.tracked_count >= 16);
      const luna = catJson.data.tracked_models.find(m => m.id === 'openai/gpt-6-luna');
      assert.ok(luna && luna.preset_ids.includes('default_visibility_tracking'));
      assert.equal(luna.active_config_count, 1);

      // 3. ingest_model_alerts stores 2 new alerts and sets should_notify_email=true
      const alertsPayload = {
        alerts: [
          {
            alert_type: 'successor_available',
            severity: 'info',
            current_model_id: 'openai/gpt-6-luna',
            suggested_model_id: 'openai/gpt-6.5-luna',
            suggested_display_name: 'OpenAI · GPT-6.5 Luna',
            confidence_score: 92,
            reason_de: 'Direkter Nachfolger der Luna-Familie auf OpenRouter veröffentlicht.',
            reason_en: 'Direct successor in the Luna family released on OpenRouter.',
            source_url: 'https://openrouter.ai/openai/gpt-6.5-luna'
          },
          {
            alert_type: 'model_missing_openrouter',
            severity: 'critical',
            current_model_id: 'x-ai/grok-4.7',
            confidence_score: 100,
            reason_de: 'Modell-Slug nicht mehr auf OpenRouter gelistet.',
            reason_en: 'Model slug missing from OpenRouter.'
          }
        ]
      };
      const ing1Res = await fetch(`${srv.baseUrl}/api/admin_users.php?action=ingest_model_alerts`, {
        method: 'POST',
        headers: n8nHeaders,
        body: JSON.stringify(alertsPayload)
      });
      const ing1Json = await ing1Res.json();
      assert.equal(ing1Res.status, 200);
      assert.equal(ing1Json.data.new_count, 2);
      assert.equal(ing1Json.data.should_notify_email, true);
      assert.ok(ing1Json.data.admin_emails.includes('admin@chatlytics.de'));
      const lunaAlert = ing1Json.data.new_alerts.find(a => a.current_model_id === 'openai/gpt-6-luna');
      const grokAlert = ing1Json.data.new_alerts.find(a => a.current_model_id === 'x-ai/grok-4.7');
      assert.ok(lunaAlert && lunaAlert.affected_presets.includes('Default Visibility Tracking'));
      assert.equal(lunaAlert.affected_configs_count, 2); // Cfg A active + Cfg B paused

      // 4. Duplicate ingest is deduplicated -> new_count=0, should_notify_email=false
      const ing2Res = await fetch(`${srv.baseUrl}/api/admin_users.php?action=ingest_model_alerts`, {
        method: 'POST',
        headers: n8nHeaders,
        body: JSON.stringify(alertsPayload)
      });
      const ing2Json = await ing2Res.json();
      assert.equal(ing2Res.status, 200);
      assert.equal(ing2Json.data.new_count, 0);
      assert.equal(ing2Json.data.should_notify_email, false);

      // 5. Admin resolves successor with replace_in_presets: enables new model & swaps in all 4 presets without modifying tracking_configs
      const resolveRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=resolve_model_alert`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ id: lunaAlert.id, resolution: 'replace_in_presets' })
      });
      const resolveJson = await resolveRes.json();
      assert.equal(resolveRes.status, 200);
      assert.equal(resolveJson.data.alert.status, 'applied');
      assert.equal(resolveJson.data.enabled_model.id, 'openai/gpt-6.5-luna');
      assert.equal(resolveJson.data.enabled_model.is_allowed, true);
      assert.equal(resolveJson.data.updated_presets.length, 4);
      const updatedDefault = resolveJson.data.presets.find(p => p.id === 'default_visibility_tracking');
      assert.ok(updatedDefault.target_llms.includes('openai/gpt-6.5-luna'));
      assert.equal(updatedDefault.target_llms.includes('openai/gpt-6-luna'), false);

      // Existing tracking_config Cfg A was NOT silently modified
      const starterCfgs = await (await fetch(`${srv.baseUrl}/api/configs.php`, {
        headers: { 'Authorization': 'Bearer starter_token_f35' }
      })).json();
      const cfgA = starterCfgs.data.configs.find(c => Number(c.id) === 101);
      assert.deepEqual(cfgA.target_llms, ['openai/gpt-6-luna']);

      // 6. Admin dismisses Grok EOL alert -> re-ingest does NOT reopen or re-email
      const dismissRes = await fetch(`${srv.baseUrl}/api/admin_users.php?action=resolve_model_alert`, {
        method: 'POST',
        headers: admHeaders,
        body: JSON.stringify({ id: grokAlert.id, resolution: 'dismiss' })
      });
      assert.equal(dismissRes.status, 200);
      assert.equal((await dismissRes.json()).data.open_count, 0);

      const ing3Json = await (await fetch(`${srv.baseUrl}/api/admin_users.php?action=ingest_model_alerts`, {
        method: 'POST',
        headers: n8nHeaders,
        body: JSON.stringify(alertsPayload)
      })).json();
      assert.equal(ing3Json.data.new_count, 0);
      assert.equal(ing3Json.data.should_notify_email, false);
      assert.equal(ing3Json.data.open_alerts_count, 0);

      // 7. Validate n8n/chatlytics_model_watcher.json structure
      const watcherJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'n8n/chatlytics_model_watcher.json'), 'utf8'));
      assert.ok(Array.isArray(watcherJson.nodes) && watcherJson.nodes.length >= 12);
      const nodeTypes = watcherJson.nodes.map(n => n.type);
      assert.ok(nodeTypes.includes('n8n-nodes-base.scheduleTrigger'));
      assert.ok(nodeTypes.includes('n8n-nodes-base.webhook'));
      assert.ok(nodeTypes.includes('n8n-nodes-base.emailSend'));
      const serialized = JSON.stringify(watcherJson);
      assert.ok(serialized.includes('action=watcher_catalog'));
      assert.ok(serialized.includes('action=ingest_model_alerts'));
      assert.ok(serialized.includes('https://openrouter.ai/api/v1/models'));
      assert.ok(serialized.includes('tjmYBMIQa9Fo3kYL'));
    } finally {
      srv.close();
    }
  });
});
