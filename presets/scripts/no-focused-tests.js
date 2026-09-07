#!/usr/bin/env node
// A focused test committed by accident makes the suite pass vacuously.
// Patterns cover the common runners across ecosystems.
const fs = require('node:fs');
const path = require('node:path');

const PATTERNS = [
  { lang: 'jest/mocha/vitest', regex: /\b(describe|it|test|context|suite)\.only\s*\(/ },
  { lang: 'jasmine/jest', regex: /\bf(describe|it)\s*\(/ },
  { lang: 'jest/mocha', regex: /\b(describe|it|test)\.skip\s*\(/, severity: 'skip' },
  { lang: 'pytest', regex: /^\s*@pytest\.mark\.only\b/ },
  { lang: 'rspec', regex: /\b(it|describe|context)\b.*\bfocus:\s*true/ },
  { lang: 'go', regex: /^\s*t\.Skip\(\)\s*$/ },
  { lang: 'rust', regex: /^\s*#\[ignore\]\s*$/ },
  { lang: 'xunit/nunit', regex: /\[(Ignore|Explicit)(\(|\])/ },
];

const root = process.env.PREFLIGHT_ROOT || process.cwd();
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
    if (/preflight[- ]?ignore/i.test(line)) return;
    for (const { lang, regex, severity } of PATTERNS) {
      if (severity === 'skip') continue; // skipped tests are a choice; focused ones are an accident
      if (regex.test(line)) {
        hits.push(`${relative}:${index + 1}  focused ${lang} test: ${line.trim().slice(0, 80)}`);
        return;
      }
    }
  });
}

if (hits.length > 0) {
  console.error(hits.join('\n'));
  console.error('\nRemove the focus before committing — the rest of the suite is not running.');
  process.exit(1);
}
