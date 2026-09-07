#!/usr/bin/env node
// Runs an example end to end, the way it would actually happen:
//
//   1. copy the example into a temp git repo and commit it (the clean state)
//   2. run preflight  -> nothing to do
//   3. overlay scenario/, which is a realistic bad change, and stage it
//   4. run preflight  -> the failures, with their reasons
//
// Usage: node examples/run-demo.js [name...]   (default: every example)

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXAMPLES_DIR = __dirname;
const CLI = path.join(__dirname, '..', 'bin', 'preflight.js');

function listExamples() {
  return fs
    .readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(EXAMPLES_DIR, entry.name, 'preflight.yaml')))
    .map((entry) => entry.name);
}

function requirementMet(dir) {
  const manifestPath = path.join(dir, 'requires.json');
  if (!fs.existsSync(manifestPath)) return { ok: true };
  const { command, args = ['--version'], reason } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const probe = spawnSync([command, ...args].join(' '), { stdio: 'ignore', shell: true });
  return probe.status === 0 ? { ok: true } : { ok: false, reason: reason || `${command} is not installed` };
}

function copyTree(from, to, { skip = [] } = {}) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target, { skip });
    else fs.copyFileSync(source, target);
  }
}

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function runPreflight(cwd, args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { output: `${result.stdout}${result.stderr}`.trimEnd(), code: result.status };
}

function runExample(name) {
  const source = path.join(EXAMPLES_DIR, name);
  const requirement = requirementMet(source);
  if (!requirement.ok) {
    console.log(`\n=== ${name} — skipped: ${requirement.reason} ===`);
    return { name, skipped: true };
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `preflight-demo-${name}-`));
  try {
    copyTree(source, temp, { skip: ['scenario', 'requires.json', 'README.md'] });
    git(['init', '-q'], temp);
    git(['config', 'user.email', 'demo@example.com'], temp);
    git(['config', 'user.name', 'preflight demo'], temp);
    git(['config', 'core.autocrlf', 'false'], temp);
    git(['add', '-A'], temp);
    git(['commit', '-qm', 'clean state'], temp);

    console.log(`\n=== ${name} ===`);
    console.log(`\n$ preflight            ${dim('# nothing changed yet')}`);
    const clean = runPreflight(temp, []);
    console.log(clean.output);

    const scenario = path.join(source, 'scenario');
    if (!fs.existsSync(scenario)) return { name, clean, dirty: null };
    copyTree(scenario, temp);
    git(['add', '-A'], temp);

    const changed = execFileSync('git', ['diff', '--name-only', '--cached', 'HEAD'], { cwd: temp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter(Boolean);
    console.log(`\n$ git add -A           ${dim(`# ${changed.length} files: ${changed.join(', ')}`)}`);
    console.log(`$ preflight`);
    const dirty = runPreflight(temp, []);
    console.log(dirty.output);
    console.log(dim(`\n(exit ${dirty.code})`));
    return { name, clean, dirty };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function dim(text) {
  const esc = String.fromCharCode(27);
  return process.stdout.isTTY ? esc + '[2m' + text + esc + '[0m' : text;
}

const requested = process.argv.slice(2);
const names = requested.length > 0 ? requested : listExamples();
const results = names.map(runExample);
const failedToFail = results.filter((r) => !r.skipped && r.dirty && r.dirty.code === 0);
if (failedToFail.length > 0) {
  console.error(`\nExpected these examples to fail on their scenario, but they passed: ${failedToFail.map((r) => r.name).join(', ')}`);
  process.exitCode = 1;
}
