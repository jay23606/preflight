#!/usr/bin/env node
// Every NNN-name.up.sql must have a sibling NNN-name.down.sql.
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.PREFLIGHT_ROOT || process.cwd();
const missing = [];

for (const file of process.argv.slice(2)) {
  if (!file.endsWith('.up.sql')) continue;
  const down = file.replace(/\.up\.sql$/, '.down.sql');
  if (!fs.existsSync(path.join(root, down))) missing.push({ file, down });
}

if (missing.length > 0) {
  for (const { file, down } of missing) console.error(`${file}  has no rollback; expected ${down}`);
  process.exit(1);
}
