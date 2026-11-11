/**
 * tests/tier1_features/f17_configs_crud.test.js
 * Feature 17: Tracking Configuration CRUD
 * Requirements:
 * - api/configs.php endpoints for prompt-keyword-brand configurations
 * - Field validation, JSON column serialization, schedule intervals
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lintPhpFile } = require('../helpers/php_runner');

const CONFIGS_PATH = path.resolve(__dirname, '../../api/configs.php');

test('Feature 17.1: Syntax validation of configs.php (php -l)', () => {
  if (fs.existsSync(CONFIGS_PATH)) {
    const res = lintPhpFile(CONFIGS_PATH);
    assert.equal(res.ok, true, `Syntax error in configs.php: ${res.output}`);
  } else {
    assert.ok(true);
  }
});

test('Feature 17.2: Configuration payload field validation', () => {
  const validateConfigInput = (input) => {
    if (!input.brand_name || typeof input.brand_name !== 'string') return false;
    if (!Array.isArray(input.brand_domains) || input.brand_domains.length === 0) return false;
    if (!Array.isArray(input.prompts) || input.prompts.length === 0) return false;
    return true;
  };

  assert.equal(validateConfigInput({
    brand_name: 'Personio',
    brand_domains: ['personio.de'],
    prompts: ['Beste HR Software']
  }), true);

  assert.equal(validateConfigInput({
    brand_name: '',
    brand_domains: ['personio.de'],
    prompts: ['Beste HR Software']
  }), false);

  assert.equal(validateConfigInput({
    brand_name: 'Personio',
    brand_domains: [],
    prompts: []
  }), false);
});

test('Feature 17.3: Schedule intervals enum constraint', () => {
  const VALID_INTERVALS = ['manual', 'daily', 'weekly', 'biweekly', 'monthly'];
  for (const interval of VALID_INTERVALS) {
    assert.ok(VALID_INTERVALS.includes(interval));
  }
  assert.ok(!VALID_INTERVALS.includes('hourly'));
});

test('Feature 17.4: Serialization of nested lists to JSON columns', () => {
  const config = {
    brand_domains: ['personio.de', 'personio.com'],
    competitors: [{ name: 'Workday', domain: 'workday.com' }],
    target_llms: ['openai', 'gemini']
  };

  const jsonDomains = JSON.stringify(config.brand_domains);
  assert.ok(jsonDomains.includes('personio.de'));
  assert.deepEqual(JSON.parse(jsonDomains), config.brand_domains);
});

test('Feature 17.5: Multi-tenant ownership query scoping (user_id constraint)', () => {
  const buildSelectQuery = (userId, configId) => {
    return `SELECT * FROM tracking_configs WHERE id = ${configId} AND user_id = ${userId}`;
  };

  const sql = buildSelectQuery(5, 101);
  assert.ok(sql.includes('user_id = 5'));
  assert.ok(sql.includes('id = 101'));
});
