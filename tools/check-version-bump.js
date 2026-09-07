#!/usr/bin/env node
// Behavior changed; did the published version move with it?
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.PREFLIGHT_ROOT || process.cwd();
const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

let committed;
try {
  const shown = execFileSync('git', ['show', 'HEAD:package.json'], { cwd: root, encoding: 'utf8' });
  committed = JSON.parse(shown).version;
} catch {
  process.exit(0); // no HEAD yet, or no package.json there: nothing to compare
}

if (current === committed) {
  console.error(`src/ or bin/ changed but package.json is still ${current}.`);
  console.error('Bump it, or accept that npx users get different behavior under the same version.');
  process.exit(1);
}
