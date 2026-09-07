#!/usr/bin/env node
// A page that inherits a configured logger and then declares its own gets a
// silently dead logger. Nothing warns; the calls simply go nowhere, so the
// page looks healthy in production at exactly the moment it is not.
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.PREFLIGHT_ROOT || process.cwd();

// Base classes that already expose a logger to their subclasses.
const BASES = ['CheckoutBasePage', 'AdminBasePage', 'UsBasePage'];
const INHERITS = new RegExp(String.raw`class\s+\w+\s*:\s*(${BASES.join('|')})\b`);
const DECLARES_LOGGER = /\b(private|protected|public|internal|static|readonly)\b[^;]*\bILogger\s*<[^>]*>\s+\w+\s*[;=]/;

const problems = [];

for (const relative of process.argv.slice(2)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) continue;
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);

  if (!lines.some((line) => INHERITS.test(line))) continue;

  lines.forEach((line, index) => {
    if (/preflight[- ]?ignore/i.test(line)) return;
    if (DECLARES_LOGGER.test(line)) {
      problems.push(`${relative}:${index + 1}  redeclares ILogger, shadowing the one from the base page`);
    }
  });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error('');
  console.error('Use the inherited logger. A shadowed one compiles, runs, and logs nothing.');
  process.exit(1);
}
