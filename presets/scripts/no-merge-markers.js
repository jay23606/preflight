#!/usr/bin/env node
// Conflict markers in a file nothing compiles are invisible until runtime.
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.PREFLIGHT_ROOT || process.cwd();
const MARKER = /^(<{7}|={7}|>{7})(\s|$)/;
const hits = [];

for (const relative of process.argv.slice(2)) {
  const full = path.join(root, relative);
  let content;
  try {
    if (!fs.statSync(full).isFile()) continue;
    content = fs.readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  if (content.indexOf(String.fromCharCode(0)) !== -1) continue;

  content.split(/\r?\n/).forEach((line, index) => {
    if (MARKER.test(line)) hits.push(`${relative}:${index + 1}  ${line.trim().slice(0, 40)}`);
  });
}

if (hits.length > 0) {
  console.error('unresolved conflict markers:');
  console.error(hits.join('\n'));
  process.exit(1);
}
