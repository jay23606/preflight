#!/usr/bin/env node
// A deliberately small credential scan: high-signal shapes only, because a
// check that cries wolf gets disabled within a week.
const fs = require('node:fs');
const path = require('node:path');

const PATTERNS = [
  { name: 'AWS access key id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Stripe secret key', regex: /\bsk_(live|test)_[0-9a-zA-Z]{16,}\b/ },
  { name: 'GitHub token', regex: /\bgh[pousr]_[0-9A-Za-z]{20,}\b/ },
  { name: 'private key block', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'connection string with an inline password', regex: /(postgres|mysql|mongodb(\+srv)?|redis):\/\/[^:\s'"]+:[^@\s'"]{6,}@/i },
  { name: 'assigned password literal', regex: /(password|passwd|secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/i },
];

const root = process.env.PREFLIGHT_ROOT || process.cwd();
const hits = [];

for (const file of process.argv.slice(2)) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/preflight[- ]?ignore/i.test(line)) return;
    for (const { name, regex } of PATTERNS) {
      if (regex.test(line)) hits.push(`${file}:${index + 1}  looks like a ${name}`);
    }
  });
}

if (hits.length > 0) {
  console.error(hits.join('\n'));
  console.error('\nMove it to an environment variable. If this is a false positive, add a `preflight-ignore` comment on the line.');
  process.exit(1);
}
