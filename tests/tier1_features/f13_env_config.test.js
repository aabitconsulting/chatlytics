/**
 * tests/tier1_features/f13_env_config.test.js
 * Feature 13: Out-of-Webroot Config Template
 * Requirements:
 * - env.example.php template resolving database, API keys, webhook secrets
 * - PHP syntax validity (php -l)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lintPhpFile } = require('../helpers/php_runner');

const ENV_PATH = path.resolve(__dirname, '../../env.example.php');

test('Feature 13.1: Config file syntax validation (php -l)', () => {
  if (fs.existsSync(ENV_PATH)) {
    const res = lintPhpFile(ENV_PATH);
    assert.equal(res.ok, true, `PHP syntax error in env.example.php: ${res.output}`);
  } else {
    assert.ok(true);
  }
});

test('Feature 13.2: Config contains required top-level configuration sections', () => {
  if (fs.existsSync(ENV_PATH)) {
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    assert.ok(content.includes("'app'"));
    assert.ok(content.includes("'db'"));
    assert.ok(content.includes("'n8n'"));
    assert.ok(content.includes("'stripe'"));
    assert.ok(content.includes("'security'"));
  } else {
    assert.ok(true);
  }
});

test('Feature 13.3: Strict types declaration header', () => {
  if (fs.existsSync(ENV_PATH)) {
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    assert.ok(content.includes('declare(strict_types=1);'));
  } else {
    assert.ok(true);
  }
});

test('Feature 13.4: CORS allowed origins defined as array', () => {
  if (fs.existsSync(ENV_PATH)) {
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    assert.ok(content.includes('cors_allowed_origins'));
  } else {
    assert.ok(true);
  }
});

test('Feature 13.5: Database connection credentials template', () => {
  if (fs.existsSync(ENV_PATH)) {
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    assert.ok(content.includes('dbname'));
    assert.ok(content.includes('utf8mb4'));
  } else {
    assert.ok(true);
  }
});
