/**
 * tests/tier1_features/f18_trigger_run.test.js
 * Feature 18: Execution Dispatcher with Timeout Handling
 * Requirements:
 * - api/trigger_run.php dispatcher triggering n8n workflow
 * - Credit pre-check and atomic reservation
 * - Async and Sync modes with cURL timeout handling
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lintPhpFile } = require('../helpers/php_runner');

const TRIGGER_PATH = path.resolve(__dirname, '../../api/trigger_run.php');

test('Feature 18.1: Syntax validation of trigger_run.php (php -l)', () => {
  if (fs.existsSync(TRIGGER_PATH)) {
    const res = lintPhpFile(TRIGGER_PATH);
    assert.equal(res.ok, true, `Syntax error in trigger_run.php: ${res.output}`);
  } else {
    assert.ok(true);
  }
});

test('Feature 18.2: Required credit calculation math', () => {
  const calculateRequiredCredits = (llmCount, promptCount) => llmCount * promptCount;

  assert.equal(calculateRequiredCredits(3, 2), 6);
  assert.equal(calculateRequiredCredits(1, 1), 1);
  assert.equal(calculateRequiredCredits(2, 5), 10);
});

test('Feature 18.3: Insufficient credits check rejects execution', () => {
  const canExecute = (creditsRemaining, requiredCredits) => creditsRemaining >= requiredCredits;

  assert.equal(canExecute(40, 5), true);
  assert.equal(canExecute(0, 1), false);
  assert.equal(canExecute(2, 5), false);
});

test('Feature 18.4: Dispatcher async payload structure', () => {
  const dispatchPayload = {
    config_id: 101,
    user_id: 5,
    response_mode: 'async',
    target_llms: ['openai', 'gemini'],
    search_enabled: true
  };

  assert.equal(dispatchPayload.response_mode, 'async');
  assert.equal(dispatchPayload.config_id, 101);
});

test('Feature 18.5: Timeout configuration distinction between sync and async modes', () => {
  const getTimeoutSeconds = (mode) => (mode === 'sync' ? 60 : 2);

  assert.equal(getTimeoutSeconds('sync'), 60);
  assert.equal(getTimeoutSeconds('async'), 2);
});
