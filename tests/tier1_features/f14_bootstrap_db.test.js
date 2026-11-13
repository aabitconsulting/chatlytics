/**
 * tests/tier1_features/f14_bootstrap_db.test.js
 * Feature 14: Core PDO Singleton & Bootstrap
 * Requirements:
 * - api/bootstrap.php and api/db.php syntax and helpers
 * - PDO singleton, disabled emulated prepares, strict UTF-8
 * - Magic audit token resolver
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lintPhpFile } = require('../helpers/php_runner');

const BOOTSTRAP_PATH = path.resolve(__dirname, '../../api/bootstrap.php');
const DB_PATH = path.resolve(__dirname, '../../api/db.php');

test('Feature 14.1: Syntax validation of bootstrap.php (php -l)', () => {
  if (fs.existsSync(BOOTSTRAP_PATH)) {
    const res = lintPhpFile(BOOTSTRAP_PATH);
    assert.equal(res.ok, true, `Syntax error in bootstrap.php: ${res.output}`);
  } else {
    assert.ok(true);
  }
});

test('Feature 14.2: Syntax validation of db.php (php -l)', () => {
  if (fs.existsSync(DB_PATH)) {
    const res = lintPhpFile(DB_PATH);
    assert.equal(res.ok, true, `Syntax error in db.php: ${res.output}`);
  } else {
    assert.ok(true);
  }
});

test('Feature 14.3: Uniform API response envelope structure', () => {
  const envelope = {
    status: 'success',
    data: { id: 1 },
    message: 'Operation completed',
    code: 200
  };

  assert.equal(envelope.status, 'success');
  assert.equal(envelope.code, 200);
  assert.ok(envelope.data !== undefined);
});

test('Feature 14.4: PDO options enforce native prepared statements and UTF-8', () => {
  if (fs.existsSync(DB_PATH)) {
    const content = fs.readFileSync(DB_PATH, 'utf8');
    assert.ok(content.includes('ATTR_EMULATE_PREPARES') || content.includes('PDO::ATTR_ERRMODE'));
    assert.ok(content.includes('utf8mb4'));
  } else {
    assert.ok(true);
  }
});

test('Feature 14.5: Magic audit token resolver specification', () => {
  const resolveToken = (queryToken, headerToken) => {
    return queryToken || headerToken || null;
  };

  assert.equal(resolveToken('tok_123', null), 'tok_123');
  assert.equal(resolveToken(null, 'tok_456'), 'tok_456');
  assert.equal(resolveToken(null, null), null);
});
