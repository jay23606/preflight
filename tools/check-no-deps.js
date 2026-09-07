#!/usr/bin/env node
// preflight promises zero runtime dependencies. Enforce it rather than
// trusting everyone to remember.
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.PREFLIGHT_ROOT || process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const runtime = Object.keys(pkg.dependencies || {});
const optional = Object.keys(pkg.optionalDependencies || {});
const peer = Object.keys(pkg.peerDependencies || {});
const offenders = [...runtime, ...optional, ...peer];

if (offenders.length > 0) {
  console.error(`package.json declares runtime dependencies: ${offenders.join(', ')}`);
  console.error('preflight installs into other people’s pre-commit hooks. Keep it dependency-free,');
  console.error('or change the promise in README.md deliberately.');
  process.exit(1);
}
