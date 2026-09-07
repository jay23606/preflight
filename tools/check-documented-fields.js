#!/usr/bin/env node
// Every manifest field the parser accepts must appear in AGENTS.md, which is
// the schema reference agents actually read.
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.PREFLIGHT_ROOT || process.cwd();
const source = fs.readFileSync(path.join(root, 'src', 'manifest.js'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

const match = source.match(/const known = new Set\(\[([^\]]*)\]\)/);
if (!match) {
  console.error('could not find the known-fields set in src/manifest.js; update this check');
  process.exit(1);
}

const fields = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
const undocumented = fields.filter((field) => !new RegExp(`\`${field}[:\` ]`).test(docs));

if (undocumented.length > 0) {
  console.error(`manifest fields missing from AGENTS.md: ${undocumented.join(', ')}`);
  process.exit(1);
}
