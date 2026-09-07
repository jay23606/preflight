const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'preflight.js');

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-cli-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  const git = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  git(['config', 'core.autocrlf', 'false']);
  git(['add', '-A']);
  git(['commit', '-qm', 'initial']);
  return dir;
}

function run(dir, args = []) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

const PASSING = `
checks:
  - name: always-fine
    when: ["**/*.txt"]
    run: node -e "process.exit(0)"
`;

const FAILING = `
checks:
  - name: rejects-todo
    when: ["**/*.txt"]
    run: node -e "process.exit(1)"
    why: TODO markers must not ship.
`;

test('exits 0 and says so when nothing changed', () => {
  const dir = makeRepo({ 'preflight.yaml': PASSING, 'a.txt': 'hello\n' });
  const result = run(dir);
  assert.equal(result.code, 0);
  assert.match(result.out, /no changed files/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runs implicated checks on the working tree and passes', () => {
  const dir = makeRepo({ 'preflight.yaml': PASSING, 'a.txt': 'hello\n' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  const result = run(dir);
  assert.equal(result.code, 0);
  assert.match(result.out, /always-fine/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('exits 1 and prints the reason when a check fails', () => {
  const dir = makeRepo({ 'preflight.yaml': FAILING, 'a.txt': 'hello\n' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  const result = run(dir);
  assert.equal(result.code, 1);
  assert.match(result.out, /rejects-todo failed/);
  assert.match(result.out, /TODO markers must not ship/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('skips checks the diff does not implicate', () => {
  const manifest = `
checks:
  - name: txt-only
    when: ["**/*.txt"]
    run: node -e "process.exit(1)"
`;
  const dir = makeRepo({ 'preflight.yaml': manifest, 'a.txt': 'a\n', 'b.md': 'b\n' });
  fs.writeFileSync(path.join(dir, 'b.md'), 'changed\n');
  const result = run(dir);
  assert.equal(result.code, 0, 'the failing check must not run for an unrelated file');
  assert.match(result.out, /no checks matched/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--json emits a machine-readable result', () => {
  const dir = makeRepo({ 'preflight.yaml': FAILING, 'a.txt': 'hello\n' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  const result = run(dir, ['--json']);
  const parsed = JSON.parse(result.out);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.checks[0].name, 'rejects-todo');
  assert.equal(parsed.checks[0].status, 'fail');
  assert.deepEqual(parsed.files, ['a.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a warn-severity failure reports but does not fail the run', () => {
  const manifest = `
checks:
  - name: soft
    severity: warn
    when: ["**/*.txt"]
    run: node -e "process.exit(1)"
`;
  const dir = makeRepo({ 'preflight.yaml': manifest, 'a.txt': 'a\n' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  const result = run(dir);
  assert.equal(result.code, 0);
  assert.match(result.out, /soft warned/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a bad manifest fails with a usable message, not a stack trace', () => {
  const dir = makeRepo({ 'preflight.yaml': 'checks:\n  - name: x\n', 'a.txt': 'a\n' });
  const result = run(dir);
  assert.equal(result.code, 2);
  assert.match(result.out, /missing a "run" command/);
  assert.doesNotMatch(result.out, /at Object|node:internal/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('init writes a manifest that parses and runs', () => {
  const dir = makeRepo({ 'package.json': '{"name":"x"}\n', 'a.txt': 'a\n' });
  const created = run(dir, ['init']);
  assert.equal(created.code, 0);
  assert.match(created.out, /Wrote/);
  assert.match(created.out, /detected node/);

  const listed = run(dir, ['--list']);
  assert.equal(listed.code, 0, listed.out);
  assert.match(listed.out, /no-focused-tests/);

  const again = run(dir, ['init']);
  assert.equal(again.code, 2);
  assert.match(again.out, /already exists/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--only rejects an unknown check name', () => {
  const dir = makeRepo({ 'preflight.yaml': PASSING, 'a.txt': 'a\n' });
  const result = run(dir, ['--only', 'nope']);
  assert.equal(result.code, 2);
  assert.match(result.out, /no such check: nope/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--fix runs the repair command and re-checks', () => {
  const manifest = `
checks:
  - name: needs-marker
    when: ["**/*.txt"]
    run: node -e "process.exit(require('fs').existsSync('marker') ? 0 : 1)"
    fix: node -e "require('fs').writeFileSync('marker','')"
    why: The marker file must exist.
`;
  const dir = makeRepo({ 'preflight.yaml': manifest, 'a.txt': 'a\n' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');

  const without = run(dir);
  assert.equal(without.code, 1, 'fails when the fix is not requested');

  const withFix = run(dir, ['--fix']);
  assert.equal(withFix.code, 0, withFix.out);
  assert.match(withFix.out, /fixed/);
  assert.ok(fs.existsSync(path.join(dir, 'marker')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a fix that does not actually fix still fails the run', () => {
  const manifest = `
checks:
  - name: unfixable
    when: ["**/*.txt"]
    run: node -e "process.exit(1)"
    fix: node -e "process.exit(0)"
`;
  const dir = makeRepo({ 'preflight.yaml': manifest, 'a.txt': 'a\n' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  const result = run(dir, ['--fix']);
  assert.equal(result.code, 1, 'a no-op fix must not turn the run green');
  fs.rmSync(dir, { recursive: true, force: true });
});
