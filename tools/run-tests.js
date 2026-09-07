#!/usr/bin/env node
// `node --test test/*.test.js` depends on the shell expanding the glob, which
// PowerShell does not do, and on Node expanding it, which Node 18 and 20 do
// not do either. Enumerate the files here so `npm test` behaves the same on
// every shell and every supported Node.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testDir = path.join(__dirname, '..', 'test');
const files = fs
  .readdirSync(testDir)
  .filter((entry) => entry.endsWith('.test.js'))
  .sort()
  .map((entry) => path.join(testDir, entry));

if (files.length === 0) {
  console.error('no test files found in test/');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status == null ? 1 : result.status);
