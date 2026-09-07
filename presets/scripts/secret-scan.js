#!/usr/bin/env node
// Provider-issued credential shapes only. Every pattern here is one that a
// human would recognise as "that is definitely a key", because a scanner that
// flags high-entropy strings flags hashes, UUIDs, and base64 test fixtures,
// and then gets turned off.
const fs = require('node:fs');
const path = require('node:path');

const PATTERNS = [
  { name: 'AWS access key id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'AWS secret access key', regex: /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}\b/i },
  { name: 'GitHub token', regex: /\bgh[pousr]_[0-9A-Za-z]{20,}\b/ },
  { name: 'GitHub fine-grained token', regex: /\bgithub_pat_[0-9A-Za-z_]{40,}\b/ },
  { name: 'Stripe secret key', regex: /\bsk_(live|test)_[0-9a-zA-Z]{16,}\b/ },
  { name: 'Slack token', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'OpenAI key', regex: /\bsk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}\b/ },
  { name: 'Anthropic key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'private key block', regex: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'JSON web key with a private exponent', regex: /"d"\s*:\s*"[A-Za-z0-9_-]{40,}"/ },
  { name: 'connection string with an inline password', regex: /(postgres|mysql|mongodb(\+srv)?|redis):\/\/[^:\s'"]+:[^@\s'"]{6,}@/i },
  { name: 'assigned password literal', regex: /\b(password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*['"][^'"\s]{8,}['"]/i },
];

// Placeholders people legitimately commit.
const INNOCENT = /\b(example|placeholder|changeme|change_me|your[_-]?\w*|xxx+|<[^>]+>|\$\{[^}]+\}|%[A-Z_]+%|\*{4,}|redacted|dummy|fake|sample|test[_-]?key)\b/i;

const root = process.env.PREFLIGHT_ROOT || process.cwd();
const MAX_BYTES = 2 * 1024 * 1024;
const hits = [];

for (const relative of process.argv.slice(2)) {
  const full = path.join(root, relative);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    continue; // deleted in this diff
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) continue;

  let content;
  try {
    content = fs.readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  if (content.indexOf(String.fromCharCode(0)) !== -1) continue; // binary

  content.split(/\r?\n/).forEach((line, index) => {
    if (/preflight[- ]?ignore/i.test(line)) return;
    for (const { name, regex } of PATTERNS) {
      if (!regex.test(line)) continue;
      if (INNOCENT.test(line)) continue;
      hits.push(`${relative}:${index + 1}  looks like a ${name}`);
      return;
    }
  });
}

if (hits.length > 0) {
  console.error(hits.join('\n'));
  console.error('');
  console.error('Move it to an environment variable or a secret store. If it is already');
  console.error('committed upstream, rotate it — removing the line does not un-leak it.');
  console.error('For a genuine false positive, add a `preflight-ignore` comment on the line.');
  process.exit(1);
}
