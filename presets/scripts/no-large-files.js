#!/usr/bin/env node
// Warn before a large file becomes permanent history.
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.PREFLIGHT_ROOT || process.cwd();
const LIMIT = Number(process.env.PREFLIGHT_MAX_FILE_BYTES || 1024 * 1024);
const big = [];

for (const relative of process.argv.slice(2)) {
  try {
    const stat = fs.statSync(path.join(root, relative));
    if (stat.isFile() && stat.size > LIMIT) big.push({ relative, size: stat.size });
  } catch {
    /* deleted in this diff */
  }
}

if (big.length > 0) {
  for (const { relative, size } of big) {
    console.error(`${relative}  ${(size / 1024 / 1024).toFixed(1)} MB`);
  }
  console.error(`\nOver the ${(LIMIT / 1024 / 1024).toFixed(1)} MB limit. Consider Git LFS, or an artifact store.`);
  console.error('Set PREFLIGHT_MAX_FILE_BYTES to change the threshold.');
  process.exit(1);
}
