#!/usr/bin/env node
// A stub that throws compiles and ships. Surface it while it is still cheap.
const fs = require('node:fs');
const path = require('node:path');

const PATTERNS = [
  { lang: 'js/ts', regex: /throw new Error\(\s*['"`](not implemented|unimplemented|todo)/i },
  { lang: 'python', regex: /^\s*raise NotImplementedError\b/ },
  { lang: 'go', regex: /panic\(\s*"(not implemented|unimplemented|TODO)/i },
  { lang: 'rust', regex: /^\s*(todo!|unimplemented!)\s*\(/ },
  { lang: 'c#/java', regex: /throw new (NotImplementedException|UnsupportedOperationException)\b/ },
  { lang: 'any', regex: /\bTODO:\s*implement\b/i },
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
    for (const { lang, regex } of PATTERNS) {
      if (regex.test(line)) {
        hits.push(`${relative}:${index + 1}  [${lang}] ${line.trim().slice(0, 80)}`);
        return;
      }
    }
  });
}

if (hits.length > 0) {
  console.error('unimplemented stubs:');
  console.error(hits.join('\n'));
  console.error('\nIf one of these is a deliberate abstract member, add a `preflight-ignore` comment.');
  process.exit(1);
}
