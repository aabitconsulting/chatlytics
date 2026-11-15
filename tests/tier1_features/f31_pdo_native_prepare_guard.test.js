/**
 * tests/tier1_features/f31_pdo_native_prepare_guard.test.js
 * Feature 31: Native MySQL Prepared Statement Guard (SQLSTATE[HY093] Prevention)
 *
 * Verifies that with PDO::ATTR_EMULATE_PREPARES => false (MySQL native prepares),
 * no backend endpoint reuses named placeholders within a single prepared SQL query
 * or mismatches bound keys in execute().
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runPhpSnippet } = require('../helpers/php_runner');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const API_DIR = path.join(PROJECT_ROOT, 'api');

function extractNamedPlaceholders(sqlText) {
  // Remove single-quoted SQL string literals (so '%H:00:00' or 'active' don't trigger colons)
  // and PHP comments before scanning for :named placeholders.
  const withoutComments = sqlText
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\r\n]*/g, ' ');
  const withoutSqlStrings = withoutComments.replace(/'(?:\\.|[^'])*'/g, "''");
  return [...withoutSqlStrings.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => m[1]);
}

async function startTempPhpServer(routerPhpPath) {
  return await new Promise((resolve, reject) => {
    const port = 35000 + Math.floor(Math.random() * 10000);
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
      for (let i = 0; i < 35; i++) {
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
  let shouldFail = false;
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { received.push(JSON.parse(body)); } catch { received.push(body); }
      if (shouldFail) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Simulated n8n failure' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'queued' }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}/webhook/chatlytics-run`,
    received,
    setFail(v) { shouldFail = Boolean(v); },
    close() {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      return new Promise(resolve => server.close(resolve));
    }
  };
}

test('Feature 31.1: Static SQL audit confirms zero duplicate named PDO placeholders across all api/*.php files', () => {
  const apiFiles = fs.readdirSync(API_DIR).filter(f => f.endsWith('.php'));
  assert.ok(apiFiles.length >= 10, 'Expected all backend PHP files in api/');

  for (const file of apiFiles) {
    const src = fs.readFileSync(path.join(API_DIR, file), 'utf8');

    // Check every double-quoted SQL statement literal in PHP
    for (const m of src.matchAll(/"((?:\\.|[^"\\])*)"/g)) {
      const lit = m[1];
      if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(lit) && !/\bLIKE\b/i.test(lit)) continue;
      // Ignore {$var} interpolations (variables are audited on their own declaration literals)
      const cleaned = lit.replace(/\{\$[a-zA-Z0-9_]+\}/g, '');
      const names = extractNamedPlaceholders(cleaned);
      const counts = {};
      for (const n of names) counts[n] = (counts[n] || 0) + 1;
      const dupes = Object.entries(counts).filter(([, c]) => c > 1);
      assert.deepEqual(
        dupes,
        [],
        `Duplicate named PDO placeholder in ${file}: ${JSON.stringify(dupes)} inside SQL: ${lit.replace(/\s+/g, ' ').slice(0, 160)}`
      );
    }
  }

  // Explicit verification of the three remediated queries
  const triggerSrc = fs.readFileSync(path.join(API_DIR, 'trigger_run.php'), 'utf8');
  assert.ok(triggerSrc.includes(':cost_min'), 'trigger_run.php must bind distinct :cost and :cost_min');

  const queueSrc = fs.readFileSync(path.join(API_DIR, 'n8n_queue.php'), 'utf8');
  assert.ok(queueSrc.includes(':cost_min'), 'n8n_queue.php must bind distinct :cost and :cost_min');

  const adminSrc = fs.readFileSync(path.join(API_DIR, 'admin_users.php'), 'utf8');
  assert.ok(adminSrc.includes(':search_email') && adminSrc.includes(':search_company'), 'admin_users.php must bind distinct :search_email and :search_company');
});

test('Feature 31.2: trigger_run.php, n8n_queue.php, and admin_users.php execute cleanly under strict NativeMySqlGuardPdo (HY093 enforcement)', async () => {
  // Verify PHP SQLite extensions exist first
  const probe = runPhpSnippet('echo extension_loaded("pdo_sqlite") ? "OK" : "MISSING";');
  if (!probe.stdout.includes('OK')) {
    // Pass explicitly if php -d isn't checked by php_runner helper
  }

  const webhook = await startMockWebhookServer();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatlytics-f31-'));
  let server = null;
  try {
  const dbPath = path.join(tmpDir, 'native_guard.sqlite').replace(/\\/g, '/');
  const routerPath = path.join(tmpDir, 'router.php');

  const guardClassPhp = String.raw`
    class NativeMySqlGuardStatement extends PDOStatement {
      public static ?WeakMap $expectedKeysMap = null;

      protected function __construct() {}

      public static function registerExpected(PDOStatement $stmt, array $keys): void {
        if (self::$expectedKeysMap === null) {
          self::$expectedKeysMap = new WeakMap();
        }
        self::$expectedKeysMap[$stmt] = $keys;
      }

      public function execute(?array $params = null): bool {
        if ($params !== null && self::$expectedKeysMap !== null && isset(self::$expectedKeysMap[$this])) {
          $expected = self::$expectedKeysMap[$this];
          $bound = [];
          foreach (array_keys($params) as $k) {
            $kStr = (string)$k;
            $bound[] = str_starts_with($kStr, ':') ? $kStr : ':' . $kStr;
          }
          sort($bound);
          $expSorted = $expected;
          sort($expSorted);
          if ($bound !== $expSorted) {
            throw new PDOException(
              'SQLSTATE[HY093]: Invalid parameter number: bound=[' . implode(',', $bound) . '] expected=[' . implode(',', $expSorted) . ']',
              0
            );
          }
        }
        return parent::execute($params);
      }
    }

    class NativeMySqlGuardPdo extends PDO {
      public function __construct(string $dsn) {
        parent::__construct($dsn);
        $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
        $this->setAttribute(PDO::ATTR_STATEMENT_CLASS, [NativeMySqlGuardStatement::class, []]);
      }

      public function prepare(string $query, array $options = []): PDOStatement|false {
        // Strip single-quoted SQL literals before counting named placeholders
        $stripped = preg_replace("/'(?:\\.|[^'])*'/", "''", $query);
        preg_match_all('/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/', $stripped, $matches);
        $names = $matches[1] ?? [];
        $counts = array_count_values($names);
        foreach ($counts as $name => $count) {
          if ($count > 1) {
            throw new PDOException("SQLSTATE[HY093]: Invalid parameter number: duplicate named placeholder :{$name}", 0);
          }
        }
        $stmt = parent::prepare($query, $options);
        if ($stmt instanceof PDOStatement) {
          $expectedKeys = array_map(fn($n) => ':' . $n, array_values(array_unique($names)));
          NativeMySqlGuardStatement::registerExpected($stmt, $expectedKeys);
        }
        return $stmt;
      }
    }
  `;

  fs.writeFileSync(routerPath, `<?php
if ($_SERVER['REQUEST_URI'] === '/__ping') {
  header('Content-Type: text/plain');
  echo 'ok';
  exit;
}
${guardClassPhp}

require_once '${API_DIR.replace(/\\/g, '/')}/bootstrap.php';
require_once '${API_DIR.replace(/\\/g, '/')}/db.php';

$cfg = Config::get();
$cfg['n8n']['webhook_url'] = '${webhook.url}';
$cfg['n8n']['shared_secret'] = 'test_f31_secret';
Config::set($cfg);

$pdo = new NativeMySqlGuardPdo('sqlite:${dbPath}');
$pdo->sqliteCreateFunction('NOW', function() { return date('Y-m-d H:i:s'); });
Database::setConnection($pdo);

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/__self_test_hy093') {
  header('Content-Type: application/json');
  $caughtDup = false;
  $caughtMismatch = false;
  try {
    $pdo->prepare("UPDATE users SET credits_remaining = credits_remaining - :cost WHERE id = :user_id AND credits_remaining >= :cost");
  } catch (PDOException $e) {
    $caughtDup = str_contains($e->getMessage(), 'HY093');
  }
  try {
    $st = $pdo->prepare("SELECT id FROM users WHERE id = :id");
    $st->execute([':id' => 1, ':extra' => 2]);
  } catch (PDOException $e) {
    $caughtMismatch = str_contains($e->getMessage(), 'HY093');
  }
  echo json_encode(['caughtDup' => $caughtDup, 'caughtMismatch' => $caughtMismatch]);
  exit;
}
if (strpos($path, '/api/trigger_run.php') !== false) {
  require '${API_DIR.replace(/\\/g, '/')}/trigger_run.php';
  exit;
}
if (strpos($path, '/api/n8n_queue.php') !== false) {
  require '${API_DIR.replace(/\\/g, '/')}/n8n_queue.php';
  exit;
}
if (strpos($path, '/api/admin_users.php') !== false) {
  require '${API_DIR.replace(/\\/g, '/')}/admin_users.php';
  exit;
}
if (strpos($path, '/api/user_results.php') !== false) {
  require '${API_DIR.replace(/\\/g, '/')}/user_results.php';
  exit;
}
http_response_code(404);
`, 'utf8');

  const initScript = `
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
        mece_category TEXT DEFAULT '4_GENERIC',
        geo_quadrant TEXT DEFAULT 'NONE',
        brand_cited INTEGER DEFAULT 0,
        competitor_cited INTEGER DEFAULT 0,
        raw_response_text TEXT NULL,
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
      INSERT INTO users (id, email, password_hash, company_name, role, tier, credits_remaining, status, api_key) VALUES
        (1, 'buyer@acme-tech.de', 'hash', 'Acme GmbH', 'user', 'starter', 10, 'active', 'starter_tok_123456'),
        (2, 'low@lowbalance.de', 'hash', 'Low Co', 'user', 'starter', 1, 'active', 'low_tok_123456'),
        (3, 'boss@chatlytics.de', 'hash', 'Chatlytics HQ', 'admin', 'enterprise_managed', 500, 'active', 'admin_tok_123456');
    ");
    $insCfg = $pdo->prepare("INSERT INTO tracking_configs (id, user_id, name, brand_name, brand_domains, keywords_prompts, competitors, target_llms, search_enabled, schedule_interval, datasets_per_day, status, initial_test_used, full_started_at, next_run_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 12, 'active', ?, ?, ?)");
    $insCfg->execute([10, 1, 'Acme Profile', 'Acme', json_encode(['acme.de']), json_encode(['B2B Empfehlung?']), json_encode(['Rival']), json_encode(['openai', 'gemini']), 'every_120m', 0, null, null]);
    $insCfg->execute([12, 1, 'Acme Rollback Profile', 'Acme', json_encode(['acme.de']), json_encode(['B2B Rollback?']), json_encode(['Rival']), json_encode(['openai', 'gemini']), 'every_120m', 0, null, null]);
    $insCfg->execute([11, 2, 'Low Profile', 'LowCo', json_encode(['low.de']), json_encode(['B2B Check?']), json_encode(['Rival']), json_encode(['openai', 'gemini']), 'every_120m', 0, null, null]);
    $insCfg->execute([13, 1, 'Acme Scheduled', 'Acme', json_encode(['acme.de']), json_encode(['B2B Scheduled?']), json_encode(['Rival']), json_encode(['openai', 'gemini']), 'every_120m', 1, '2020-01-01 00:00:00', '2020-01-01 00:00:00']);
  `;

  const { spawnSync } = require('node:child_process');
  const initRes = spawnSync('php', ['-d', 'extension=pdo_sqlite', '-d', 'extension=sqlite3', '-r', initScript], { encoding: 'utf8' });
  assert.equal(initRes.status, 0, initRes.stderr || initRes.stdout);

  server = await startTempPhpServer(routerPath);
    // 0. Guard self-test confirms NativeMySqlGuardPdo throws SQLSTATE[HY093] on duplicate placeholders & extra keys
    const guardRes = await fetch(`${server.baseUrl}/__self_test_hy093`);
    assert.equal(guardRes.status, 200);
    const guardJson = await guardRes.json();
    assert.equal(guardJson.caughtDup, true, 'Guard must reject duplicate named placeholders with HY093');
    assert.equal(guardJson.caughtMismatch, true, 'Guard must reject mismatched execute keys with HY093');

    // 1. trigger_run.php succeeds with HTTP 200 & atomic 2-credit deduction (2 LLMs x 1 prompt)
    const okRes = await fetch(`${server.baseUrl}/api/trigger_run.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer starter_tok_123456'
      },
      body: JSON.stringify({ config_id: 10, response_mode: 'async' })
    });
    const okBody = await okRes.json();
    assert.equal(okRes.status, 200, `Expected 200 from trigger_run.php, got ${okRes.status}: ${JSON.stringify(okBody)}`);
    assert.equal(okBody.status, 'success');
    assert.equal(okBody.data.status, 'queued');
    assert.equal(okBody.credits_deducted, 2);
    assert.equal(okBody.credits_remaining, 8);
    assert.equal(webhook.received.length, 1);

    // 2. trigger_run.php refunds atomically on downstream webhook failure (502, credits stay at 8)
    webhook.setFail(true);
    const failRes = await fetch(`${server.baseUrl}/api/trigger_run.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer starter_tok_123456'
      },
      body: JSON.stringify({ config_id: 12, response_mode: 'async' })
    });
    const failBody = await failRes.json();
    assert.equal(failRes.status, 502);
    assert.equal(failBody.errors.refunded_credits, 2);
    webhook.setFail(false);

    // 3. trigger_run.php rejects insufficient credits cleanly with HTTP 402 (1 < 2 required)
    const lowRes = await fetch(`${server.baseUrl}/api/trigger_run.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer low_tok_123456'
      },
      body: JSON.stringify({ config_id: 11, response_mode: 'async' })
    });
    const lowBody = await lowRes.json();
    assert.equal(lowRes.status, 402);
    assert.equal(lowBody.errors.required_credits, 2);
    assert.equal(lowBody.errors.credits_remaining, 1);

    // 4. n8n_queue.php polls Full-Started due config 13 cleanly and deducts 2 more credits (8 -> 6)
    const queueRes = await fetch(`${server.baseUrl}/api/n8n_queue.php?action=poll&limit=5`, {
      headers: { 'X-N8N-Secret': 'test_f31_secret' }
    });
    const queueBody = await queueRes.json();
    assert.equal(queueRes.status, 200, `n8n_queue failed: ${JSON.stringify(queueBody)}`);
    assert.equal(queueBody.jobs_count, 1);
    assert.equal(queueBody.jobs[0].config_id, 13);

    // 5. admin_users.php search filters across email & company name without HY093
    const searchRes = await fetch(`${server.baseUrl}/api/admin_users.php?action=list&search=acme`, {
      headers: { 'Authorization': 'Bearer admin_tok_123456' }
    });
    const searchBody = await searchRes.json();
    assert.equal(searchRes.status, 200, `admin_users search failed: ${JSON.stringify(searchBody)}`);
    assert.equal(searchBody.users.length, 1);
    assert.equal(searchBody.users[0].email, 'buyer@acme-tech.de');
    assert.equal(searchBody.users[0].credits_remaining, 6, 'User 1 must have 10 - 2 (trigger) + 2 - 2 (refunded fail) - 2 (queue) = 6 credits');

    // 6. user_results.php executes cleanly under strict NativeMySqlGuardPdo without HY093
    const urRes = await fetch(`${server.baseUrl}/api/user_results.php?config_id=10`, {
      headers: { 'Authorization': 'Bearer starter_tok_123456' }
    });
    const urBody = await urRes.json();
    assert.equal(urRes.status, 200, `user_results failed: ${JSON.stringify(urBody)}`);
    assert.equal(urBody.status, 'success');
  } finally {
    if (server && server.proc) {
      server.proc.kill();
    }
    await webhook.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
