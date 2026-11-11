/**
 * tests/helpers/php_runner.js
 * PHP CLI execution wrapper for syntax validation and isolated script evaluation.
 */

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

function hasPhpCli() {
  try {
    const res = spawnSync('php', ['-v'], { encoding: 'utf8' });
    return res.status === 0;
  } catch {
    return false;
  }
}

function lintPhpFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, notFound: true, message: `File not found: ${filePath}` };
  }
  try {
    const res = spawnSync('php', ['-l', filePath], { encoding: 'utf8' });
    const isNoSyntaxErrors = (res.stdout || '').includes('No syntax errors detected');
    return {
      ok: res.status === 0 && isNoSyntaxErrors,
      exitCode: res.status,
      output: (res.stdout || '') + (res.stderr || '')
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function runPhpSnippet(code) {
  try {
    const res = spawnSync('php', ['-r', code], { encoding: 'utf8' });
    return {
      exitCode: res.status,
      stdout: res.stdout || '',
      stderr: res.stderr || ''
    };
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: err.message };
  }
}

module.exports = {
  hasPhpCli,
  lintPhpFile,
  runPhpSnippet
};
