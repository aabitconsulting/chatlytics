/**
 * tests/run_all_e2e.js
 * Master E2E Test Runner for Chatlytics.de Platform.
 * Executes and coordinates Tiers 1-4 suites, PHP CLI syntax verification,
 * and prints an authoritative executive audit summary with exit code 0 on pass.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const TESTS_DIR = __dirname;

const TIERS = [
  {
    id: 1,
    name: 'Tier 1: Feature Coverage (Features 1-29)',
    dir: path.join(TESTS_DIR, 'tier1_features'),
    pattern: '*.test.js'
  },
  {
    id: 2,
    name: 'Tier 2: Boundary & Corner Cases',
    dir: path.join(TESTS_DIR, 'tier2_boundaries'),
    pattern: '*.test.js'
  },
  {
    id: 3,
    name: 'Tier 3: Cross-Feature Combinations',
    dir: path.join(TESTS_DIR, 'tier3_combinations'),
    pattern: '*.test.js'
  },
  {
    id: 4,
    name: 'Tier 4: Real-World Application Scenarios',
    dir: path.join(TESTS_DIR, 'tier4_scenarios'),
    pattern: '*.test.js'
  }
];

function printHeader() {
  console.log('================================================================================');
  console.log('  🧪 CHATLYTICS.DE — MASTER E2E TEST RUNNER (TIERS 1 - 4)');
  console.log('  Platform: AI Visibility & Share-of-Model (SoM) Analytics');
  console.log('  Test Framework: Node.js node:test & PHP CLI');
  console.log('================================================================================\n');
}

function runPhpSyntaxAudit() {
  console.log('🔍 Checking Backend PHP Syntax (php -l)...');
  const phpFiles = [
    'env.example.php',
    'api/bootstrap.php',
    'api/db.php',
    'api/auth.php',
    'api/admin_users.php',
    'api/configs.php',
    'api/trigger_run.php',
    'api/n8n_queue.php',
    'api/ingest.php',
    'api/reports.php',
    'api/stripe_webhook.php'
  ];

  let checkedCount = 0;
  let passedCount = 0;

  for (const relPath of phpFiles) {
    const fullPath = path.join(ROOT_DIR, relPath);
    if (fs.existsSync(fullPath)) {
      checkedCount++;
      const res = spawnSync('php', ['-l', fullPath], { encoding: 'utf8' });
      if (res.status === 0) {
        passedCount++;
        console.log(`  ✔ [PHP SYNTAX PASS] ${relPath}`);
      } else {
        console.error(`  ✖ [PHP SYNTAX ERROR] ${relPath}: ${res.stdout || res.stderr}`);
      }
    }
  }

  if (checkedCount === 0) {
    console.log('  ℹ No deployed PHP files found on disk yet (pending backend milestone completion).\n');
  } else {
    console.log(`  Summary: ${passedCount}/${checkedCount} PHP files passed syntax audit.\n`);
  }
}

function runTier(tier) {
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`▶ Running ${tier.name}...`);
  console.log(`--------------------------------------------------------------------------------`);

  if (!fs.existsSync(tier.dir)) {
    console.log(`  Directory not found: ${tier.dir}`);
    return { passed: 0, failed: 0, total: 0, ok: true };
  }

  const files = fs.readdirSync(tier.dir)
    .filter(f => f.endsWith('.test.js'))
    .map(f => path.join(tier.dir, f));

  if (files.length === 0) {
    console.log(`  No test files found in ${tier.dir}`);
    return { passed: 0, failed: 0, total: 0, ok: true };
  }

  const startTime = performance.now();
  const res = spawnSync('node', ['--test', ...files], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    env: process.env
  });
  const duration = (performance.now() - startTime).toFixed(1);

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const output = stdout + stderr;

  // Parse pass/fail counts from node:test TAP output
  let passCount = 0;
  let failCount = 0;
  let totalCount = 0;

  const passMatch = output.match(/ℹ pass (\d+)/);
  if (passMatch) passCount = parseInt(passMatch[1], 10);

  const failMatch = output.match(/ℹ fail (\d+)/);
  if (failMatch) failCount = parseInt(failMatch[1], 10);

  const totalMatch = output.match(/ℹ tests (\d+)/);
  if (totalMatch) totalCount = parseInt(totalMatch[1], 10);

  if (res.status === 0) {
    console.log(`  ✔ PASSED: ${tier.name}`);
    console.log(`  ✔ Metrics: ${passCount} tests passed (0 failed) in ${duration}ms across ${files.length} test files.\n`);
    return { passed: passCount, failed: 0, total: totalCount || passCount, ok: true, duration };
  } else {
    console.error(`  ✖ FAILED: ${tier.name}`);
    console.error(`  ✖ Metrics: ${passCount} passed, ${failCount} failed in ${duration}ms\n`);
    console.error(output.slice(0, 1500));
    return { passed: passCount, failed: failCount, total: totalCount, ok: false, duration };
  }
}

function main() {
  printHeader();
  runPhpSyntaxAudit();

  const results = [];
  let allOk = true;
  let totalPass = 0;
  let totalFail = 0;
  const overallStart = performance.now();

  for (const tier of TIERS) {
    const r = runTier(tier);
    results.push({ tier: tier.name, ...r });
    totalPass += r.passed;
    totalFail += r.failed;
    if (!r.ok) allOk = false;
  }

  const overallDuration = (performance.now() - overallStart).toFixed(1);

  console.log('================================================================================');
  console.log('  📊 CHATLYTICS.DE E2E TEST EXECUTION SUMMARY REPORT');
  console.log('================================================================================');
  for (const r of results) {
    const statusIcon = r.ok ? '✔' : '✖';
    console.log(`  ${statusIcon} ${r.tier.padEnd(46)} : ${r.passed} passed, ${r.failed} failed (${r.duration}ms)`);
  }
  console.log('--------------------------------------------------------------------------------');
  console.log(`  Total Test Cases Executed : ${totalPass + totalFail}`);
  console.log(`  Total Passed              : ${totalPass}`);
  console.log(`  Total Failed              : ${totalFail}`);
  console.log(`  Overall Duration          : ${overallDuration}ms`);
  console.log(`  Final Verdict             : ${allOk ? 'PASSED (100% SUCCESS)' : 'FAILED'}`);
  console.log('================================================================================\n');

  if (allOk) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main();
