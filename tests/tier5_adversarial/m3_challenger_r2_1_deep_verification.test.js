/**
 * tests/tier5_adversarial/m3_challenger_r2_1_deep_verification.test.js
 * Empirical Adversarial Verification Test Suite for Milestone 3 Iteration 2
 * Executed by m3_challenger_r2_1
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function runPhp(phpCode, env = {}) {
  const fullScript = `<?php
error_reporting(E_ALL);
ini_set('display_errors', '1');
${phpCode}
`;
  const res = spawnSync('php', [], {
    cwd: PROJECT_ROOT,
    input: fullScript,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 10000
  });

  let parsed = null;
  const stdout = (res.stdout || '').trim();
  const stderr = (res.stderr || '').trim();

  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    const match = stdout.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch (inner) {}
    }
  }

  return {
    status: res.status,
    stdout,
    stderr,
    parsed
  };
}

const mockDbSetup = `
require_once 'api/bootstrap.php';
require_once 'api/db.php';

class MockStmt {
    private $query;
    private $params = [];
    public function __construct($q) { $this->query = $q; }
    public function execute($params = []) {
        $this->params = $params;
        return true;
    }
    public function fetch($mode = null) {
        // Return valid audit user when querying magic_audit_token
        if (strpos($this->query, 'magic_audit_token') !== false) {
            $token = $this->params[':token'] ?? '';
            if ($token === 'sec_9f83a2b1c0e9f8a7b6c5d4e3' || $token === 'sec_header_token_1234567890') {
                return [
                    'id' => 15,
                    'email' => 'audit_target@personio.de',
                    'role' => 'user',
                    'status' => 'active',
                    'magic_audit_token' => $token
                ];
            }
            return false;
        }

        // Return valid user when querying api_key
        if (strpos($this->query, 'api_key') !== false) {
            $key = $this->params[':api_key'] ?? '';
            if ($key === 'key_valid_bearer_token_123456789') {
                return [
                    'id' => 20,
                    'email' => 'bearer_user@personio.de',
                    'role' => 'user',
                    'status' => 'active',
                    'api_key' => $key
                ];
            }
            return false;
        }

        // Return config record for SELECT * FROM tracking_configs
        if (strpos($this->query, 'FROM tracking_configs') !== false) {
            return [
                'id' => 101,
                'user_id' => 20,
                'name' => 'Existing Config',
                'brand_name' => 'Personio',
                'brand_domains' => json_encode(['personio.de']),
                'keywords_prompts' => json_encode(['Beste HR Software']),
                'competitors' => json_encode(['Workday']),
                'target_llms' => json_encode(['openai']),
                'search_enabled' => 1,
                'schedule_interval' => 'every_120m',
                'datasets_per_day' => 12,
                'initial_test_used' => 0,
                'full_started_at' => null,
                'status' => 'active',
                'created_at' => '2026-11-01 10:00:00',
                'updated_at' => '2026-11-01 10:00:00',
                'last_run_at' => null,
                'next_run_at' => '2026-11-02 10:00:00'
            ];
        }

        return false;
    }
    public function fetchAll($mode = null) {
        return [[
            'id' => 101,
            'user_id' => 15,
            'name' => 'Existing Config',
            'brand_name' => 'Personio',
            'brand_domains' => json_encode(['personio.de']),
            'keywords_prompts' => json_encode(['Beste HR Software']),
            'competitors' => json_encode(['Workday']),
            'target_llms' => json_encode(['openai']),
            'search_enabled' => 1,
            'schedule_interval' => 'every_120m',
            'datasets_per_day' => 12,
            'initial_test_used' => 0,
            'full_started_at' => null,
            'status' => 'active',
            'created_at' => '2026-11-01 10:00:00',
            'updated_at' => '2026-11-01 10:00:00',
            'last_run_at' => null,
            'next_run_at' => '2026-11-02 10:00:00',
            'run_count' => 5
        ]];
    }
    public function fetchColumn($col = 0) {
        return 5;
    }
}

class MockDb extends PDO {
    public function __construct() {}
    public function prepare($q, $opt = []) { return new MockStmt($q); }
    public function lastInsertId($name = null) { return '102'; }
}

Database::setConnection(new MockDb());
`;

// -----------------------------------------------------------------------------
// Objective 1: Mutating requests with valid Magic Audit token strictly return HTTP 403
// -----------------------------------------------------------------------------
const mutatingVerbs = ['POST', 'PUT', 'DELETE'];

for (const verb of mutatingVerbs) {
  test(`CHALLENGE-R2-1.1: Valid audit token on ${verb} returns HTTP 403 with exact preview message`, () => {
    const code = `
      ${mockDbSetup}
      $_SERVER['REQUEST_METHOD'] = '${verb}';
      $_GET['audit_token'] = 'sec_9f83a2b1c0e9f8a7b6c5d4e3';
      $_GET['id'] = '101';
      require 'api/configs.php';
    `;
    const res = runPhp(code);
    assert.ok(res.parsed, `Expected JSON output for ${verb}, got: ${res.stdout}`);
    assert.equal(res.parsed.status, 'error');
    assert.equal(res.parsed.code, 403);
    assert.equal(res.parsed.message, 'Modifications not permitted in Magic Audit preview mode.');
  });
}

// Header-based audit token: X-Audit-Token
for (const verb of mutatingVerbs) {
  test(`CHALLENGE-R2-1.2: Valid audit token via X-Audit-Token header on ${verb} returns HTTP 403`, () => {
    const code = `
      ${mockDbSetup}
      $_SERVER['REQUEST_METHOD'] = '${verb}';
      $_SERVER['HTTP_X_AUDIT_TOKEN'] = 'sec_header_token_1234567890';
      $_GET['id'] = '101';
      require 'api/configs.php';
    `;
    const res = runPhp(code);
    assert.ok(res.parsed, `Expected JSON output for ${verb} via header, got: ${res.stdout}`);
    assert.equal(res.parsed.status, 'error');
    assert.equal(res.parsed.code, 403);
    assert.equal(res.parsed.message, 'Modifications not permitted in Magic Audit preview mode.');
  });
}

// Method override variations
const overrideVariations = [
  { header: 'HTTP_X_HTTP_METHOD_OVERRIDE', val: 'PUT', expectedVerb: 'PUT' },
  { header: 'HTTP_X_HTTP_METHOD_OVERRIDE', val: 'DELETE', expectedVerb: 'DELETE' },
  { get: '_method', val: 'PUT', expectedVerb: 'PUT' },
  { get: '_method', val: 'DELETE', expectedVerb: 'DELETE' },
  { get: 'action', val: 'UPDATE', expectedVerb: 'PUT' },
  { get: 'action', val: 'DESTROY', expectedVerb: 'DELETE' },
];

for (const variant of overrideVariations) {
  const desc = variant.header ? `Header ${variant.header}: ${variant.val}` : `Param ${variant.get}=${variant.val}`;
  test(`CHALLENGE-R2-1.3: Method override to ${variant.expectedVerb} via ${desc} with audit token returns HTTP 403`, () => {
    let setup = mockDbSetup + `\n$_SERVER['REQUEST_METHOD'] = 'POST';\n`;
    if (variant.header) {
      setup += `$_SERVER['${variant.header}'] = '${variant.val}';\n`;
    }
    if (variant.get) {
      setup += `$_GET['${variant.get}'] = '${variant.val}';\n`;
    }
    setup += `
      $_GET['audit_token'] = 'sec_9f83a2b1c0e9f8a7b6c5d4e3';
      $_GET['id'] = '101';
      require 'api/configs.php';
    `;
    const res = runPhp(setup);
    assert.ok(res.parsed, `Expected JSON output, got: ${res.stdout}`);
    assert.equal(res.parsed.status, 'error');
    assert.equal(res.parsed.code, 403);
    assert.equal(res.parsed.message, 'Modifications not permitted in Magic Audit preview mode.');
  });
}

// -----------------------------------------------------------------------------
// Objective 2: Mutating requests with NO credentials strictly return HTTP 401
// -----------------------------------------------------------------------------
for (const verb of mutatingVerbs) {
  test(`CHALLENGE-R2-2.1: No credentials on ${verb} returns HTTP 401 with exact message`, () => {
    const code = `
      ${mockDbSetup}
      $_SERVER['REQUEST_METHOD'] = '${verb}';
      unset($_SERVER['HTTP_AUTHORIZATION']);
      unset($_SERVER['HTTP_X_AUDIT_TOKEN']);
      unset($_GET['audit_token']);
      $_GET['id'] = '101';
      require 'api/configs.php';
    `;
    const res = runPhp(code);
    assert.ok(res.parsed, `Expected JSON output for unauthenticated ${verb}, got: ${res.stdout}`);
    assert.equal(res.parsed.status, 'error');
    assert.equal(res.parsed.code, 401);
    assert.equal(res.parsed.message, 'Unauthorized: Authentication required');
  });
}

// -----------------------------------------------------------------------------
// Objective 3: Malformed and invalid audit tokens strictly return HTTP 401
// -----------------------------------------------------------------------------
const malformedTokens = [
  { desc: 'empty string', token: '' },
  { desc: 'short (<16 chars): 15 chars', token: '123456789012345' },
  { desc: 'short (<16 chars): 4 chars', token: 'sec_' },
  { desc: 'long (>64 chars): 65 chars', token: 'a'.repeat(65) },
  { desc: 'long (>64 chars): 100 chars', token: 'sec_' + 'x'.repeat(96) },
  { desc: 'spaces and control chars', token: 'sec_9f83a2b1c0e9f8a7 whitespace' },
  { desc: 'invalid special chars: dollar & exclamation', token: 'sec_9f83a2b1c0e9f8a7$!*#' },
  { desc: 'path traversal string', token: '../../../../etc/passwd' },
  { desc: 'SQLi classic: single quote OR 1=1', token: "' OR 1=1 --" },
  { desc: 'SQLi stacked: semicolon drop table', token: "'; DROP TABLE users; --" },
  { desc: 'SQLi union select', token: "1' UNION SELECT 1,2,3,4,5 --" },
  { desc: 'SQLi valid length but payload', token: "sec_token_len16' OR 1=1 --" },
  { desc: 'non-existent token with valid format', token: 'sec_nonexistent_valid_format_token_1234' },
];

for (const { desc, token } of malformedTokens) {
  test(`CHALLENGE-R2-3.1: Malformed audit token (${desc}) on POST strictly returns HTTP 401`, () => {
    const escapedToken = token.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const code = `
      ${mockDbSetup}
      $_SERVER['REQUEST_METHOD'] = 'POST';
      $_GET['audit_token'] = '${escapedToken}';
      unset($_SERVER['HTTP_AUTHORIZATION']);
      require 'api/configs.php';
    `;
    const res = runPhp(code);
    assert.ok(res.parsed, `Expected JSON output for token "${desc}", got: ${res.stdout}`);
    assert.equal(res.parsed.status, 'error');
    assert.equal(res.parsed.code, 401);
    assert.equal(res.parsed.message, 'Unauthorized: Authentication required');
  });

  test(`CHALLENGE-R2-3.2: Malformed audit token (${desc}) on PUT strictly returns HTTP 401`, () => {
    const escapedToken = token.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const code = `
      ${mockDbSetup}
      $_SERVER['REQUEST_METHOD'] = 'PUT';
      $_GET['audit_token'] = '${escapedToken}';
      $_GET['id'] = '101';
      unset($_SERVER['HTTP_AUTHORIZATION']);
      require 'api/configs.php';
    `;
    const res = runPhp(code);
    assert.ok(res.parsed, `Expected JSON output for token "${desc}", got: ${res.stdout}`);
    assert.equal(res.parsed.status, 'error');
    assert.equal(res.parsed.code, 401);
    assert.equal(res.parsed.message, 'Unauthorized: Authentication required');
  });

  test(`CHALLENGE-R2-3.3: Malformed audit token (${desc}) on DELETE strictly returns HTTP 401`, () => {
    const escapedToken = token.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const code = `
      ${mockDbSetup}
      $_SERVER['REQUEST_METHOD'] = 'DELETE';
      $_GET['audit_token'] = '${escapedToken}';
      $_GET['id'] = '101';
      unset($_SERVER['HTTP_AUTHORIZATION']);
      require 'api/configs.php';
    `;
    const res = runPhp(code);
    assert.ok(res.parsed, `Expected JSON output for token "${desc}", got: ${res.stdout}`);
    assert.equal(res.parsed.status, 'error');
    assert.equal(res.parsed.code, 401);
    assert.equal(res.parsed.message, 'Unauthorized: Authentication required');
  });
}

// -----------------------------------------------------------------------------
// Objective 4: Mutating requests with valid Bearer tokens succeed
// -----------------------------------------------------------------------------
test('CHALLENGE-R2-4.1: POST /api/configs.php with valid Bearer token creates configuration (HTTP 201)', () => {
  const code = `
    ${mockDbSetup}
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer key_valid_bearer_token_123456789';
    
    $_POST = [
        'name' => 'New HR Config',
        'brand_name' => 'Personio',
        'brand_domains' => ['personio.de'],
        'keywords_prompts' => ['Beste HR Software im Mittelstand'],
        'competitors' => ['Workday', 'SAP'],
        'target_llms' => ['openai', 'gemini'],
        'search_enabled' => true,
        'schedule_interval' => 'every_120m'
    ];

    require 'api/configs.php';
  `;

  const res = runPhp(code);
  assert.ok(res.parsed, `Expected JSON output, got: ${res.stdout}`);
  assert.equal(res.parsed.status, 'success');
  assert.equal(res.parsed.code, 201);
  assert.ok(res.parsed.data && res.parsed.data.config);
  assert.equal(res.parsed.data.config.brand_name, 'Personio');
});

test('CHALLENGE-R2-4.2: PUT /api/configs.php with valid Bearer token updates configuration (HTTP 200)', () => {
  const code = `
    ${mockDbSetup}
    $_SERVER['REQUEST_METHOD'] = 'PUT';
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer key_valid_bearer_token_123456789';
    $_GET['id'] = '101';
    
    $_POST = [
        'name' => 'Updated HR Config',
        'brand_name' => 'Personio Updated',
        'schedule_interval' => 'every_120m'
    ];

    require 'api/configs.php';
  `;
  const res = runPhp(code);
  assert.ok(res.parsed, `Expected JSON output, got: ${res.stdout}`);
  assert.equal(res.parsed.status, 'success');
  assert.equal(res.parsed.code, 200);
  assert.ok(res.parsed.data && res.parsed.data.config);
  assert.equal(res.parsed.data.message, 'Configuration updated successfully.');
});

test('CHALLENGE-R2-4.3: DELETE /api/configs.php with valid Bearer token deletes configuration (HTTP 200)', () => {
  const code = `
    ${mockDbSetup}
    $_SERVER['REQUEST_METHOD'] = 'DELETE';
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer key_valid_bearer_token_123456789';
    $_GET['id'] = '101';

    require 'api/configs.php';
  `;
  const res = runPhp(code);
  assert.ok(res.parsed, `Expected JSON output, got: ${res.stdout}`);
  assert.equal(res.parsed.status, 'success');
  assert.equal(res.parsed.code, 200);
  assert.equal(res.parsed.data.id, 101);
  assert.equal(res.parsed.data.message, 'Configuration deleted successfully.');
});

test('CHALLENGE-R2-4.4: Bearer token takes precedence when BOTH Bearer and Magic Audit token are passed', () => {
  const code = `
    ${mockDbSetup}
    $_SERVER['REQUEST_METHOD'] = 'DELETE';
    $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer key_valid_bearer_token_123456789';
    $_GET['audit_token'] = 'sec_9f83a2b1c0e9f8a7b6c5d4e3';
    $_GET['id'] = '101';

    require 'api/configs.php';
  `;
  const res = runPhp(code);
  assert.ok(res.parsed, `Expected JSON output, got: ${res.stdout}`);
  assert.equal(res.parsed.status, 'success', 'Bearer precedence should permit deletion');
  assert.equal(res.parsed.code, 200);
});

// -----------------------------------------------------------------------------
// Objective 5: Read-only operations with Magic Audit token are permitted
// -----------------------------------------------------------------------------
test('CHALLENGE-R2-5.1: GET /api/configs.php with valid audit token successfully lists configs (HTTP 200)', () => {
  const code = `
    ${mockDbSetup}
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET['audit_token'] = 'sec_9f83a2b1c0e9f8a7b6c5d4e3';

    require 'api/configs.php';
  `;
  const res = runPhp(code);
  assert.ok(res.parsed, `Expected JSON output for GET, got: ${res.stdout}`);
  assert.equal(res.parsed.status, 'success');
  assert.equal(res.parsed.code, 200);
  assert.ok(Array.isArray(res.parsed.data.configs));
  assert.equal(res.parsed.data.count, 1);
});

test('CHALLENGE-R2-5.2: GET /api/configs.php with NO credentials strictly returns HTTP 401', () => {
  const code = `
    ${mockDbSetup}
    $_SERVER['REQUEST_METHOD'] = 'GET';
    unset($_SERVER['HTTP_AUTHORIZATION']);
    unset($_GET['audit_token']);

    require 'api/configs.php';
  `;
  const res = runPhp(code);
  assert.ok(res.parsed, `Expected JSON output for unauthenticated GET, got: ${res.stdout}`);
  assert.equal(res.parsed.status, 'error');
  assert.equal(res.parsed.code, 401);
  assert.equal(res.parsed.message, 'Unauthorized: Authentication required');
});
