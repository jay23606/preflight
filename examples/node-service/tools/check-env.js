#!/usr/bin/env node
// Fails when a changed source file reads an environment variable that is not
// documented in .env.example.
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.PREFLIGHT_ROOT || process.cwd();
const files = process.argv.slice(2);

const examplePath = path.join(root, '.env.example');
const documented = new Set(
  fs.existsSync(examplePath)
    ? fs
        .readFileSync(examplePath, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => line.split('=')[0].trim())
    : [],
);

const problems = [];
for (const file of files) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const pattern = /process\.env\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const name = match[1] || match[2];
      if (!documented.has(name)) {
        problems.push(`${file}:${index + 1}  reads ${name}, which is not in .env.example`);
      }
    }
  });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\nAdd ${problems.length === 1 ? 'it' : 'them'} to .env.example with a safe placeholder value.`);
  process.exit(1);
}
