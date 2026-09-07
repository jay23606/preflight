// The preset scripts are the part other repositories actually depend on, so
// they get direct tests — including the false positives they must NOT produce.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', 'presets', 'scripts');

function runScript(script, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-script-'));
  try {
    const names = [];
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      names.push(name);
    }
    const result = spawnSync(process.execPath, [path.join(SCRIPTS, script), ...names], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, PREFLIGHT_ROOT: dir },
    });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('secret-scan catches provider key shapes', () => {
  const result = runScript('secret-scan.js', {
    'a.js': 'const k = "AKIAIOSFODNN7SOMEKEY";\n',
    'b.js': 'const g = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n',
    'c.env': 'DATABASE_URL=postgres://app:hunter2hunter2@db.internal:5432/app\n',
  });
  assert.equal(result.code, 1);
  assert.match(result.out, /AWS access key id/);
  assert.match(result.out, /GitHub token/);
  assert.match(result.out, /connection string/);
});

test('secret-scan leaves placeholders and ignores alone', () => {
  const result = runScript('secret-scan.js', {
    'a.env': 'STRIPE_KEY=your_key_here\nPASSWORD=changeme\nTOKEN=xxxxxxxxxxxx\n',
    'b.js': 'const k = "AKIAIOSFODNN7SOMEKEY"; // preflight-ignore: fixture\n',
    'c.md': 'Set `password: <your-password>` in the config.\n',
  });
  assert.equal(result.code, 0, result.out);
});

test('no-elided-code catches a summary standing in for code', () => {
  const result = runScript('no-elided-code.js', {
    'a.js': 'function a() {\n  return 1;\n}\n// ... rest of the implementation unchanged\n',
    'b.py': 'def f():\n    pass\n# existing code here\n',
  });
  assert.equal(result.code, 1);
  assert.match(result.out, /a\.js:4/);
  assert.match(result.out, /b\.py:3/);
});

test('no-elided-code does not fire on ordinary comments', () => {
  const result = runScript('no-elided-code.js', {
    'a.js': '// This function unchanged the world forever\nconst msg = "rest of the code here";\n// TODO: handle the retry case\n',
    'b.ts': '// Existing customers keep their original pricing.\n',
  });
  assert.equal(result.code, 0, result.out);
});

test('no-unimplemented-stubs finds stubs across languages', () => {
  const result = runScript('no-unimplemented-stubs.js', {
    'a.py': 'def f():\n    raise NotImplementedError\n',
    'b.rs': 'fn f() {\n    todo!()\n}\n',
    'c.cs': 'public void F() { throw new NotImplementedException(); }\n',
  });
  assert.equal(result.code, 1);
  assert.match(result.out, /python/);
  assert.match(result.out, /rust/);
});

test('no-merge-markers finds conflict markers in any file type', () => {
  const result = runScript('no-merge-markers.js', {
    'a.yaml': 'key: value\n<<<<<<< HEAD\nother: 1\n=======\nother: 2\n>>>>>>> branch\n',
  });
  assert.equal(result.code, 1);
  assert.match(result.out, /a\.yaml:2/);
});

test('no-focused-tests finds a focused test but not a normal one', () => {
  const focused = runScript('no-focused-tests.js', { 'a.test.js': 'it.only("works", () => {});\n' });
  assert.equal(focused.code, 1);
  const normal = runScript('no-focused-tests.js', { 'b.test.js': 'it("works", () => {});\n' });
  assert.equal(normal.code, 0, normal.out);
});

test('no-large-files respects its threshold', () => {
  const big = 'x'.repeat(2048);
  const over = runScript('no-large-files.js', { 'big.bin': big });
  assert.equal(over.code, 0, 'default threshold is 1MB, so 2KB passes');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-big-'));
  fs.writeFileSync(path.join(dir, 'big.bin'), big);
  const result = spawnSync(process.execPath, [path.join(SCRIPTS, 'no-large-files.js'), 'big.bin'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PREFLIGHT_ROOT: dir, PREFLIGHT_MAX_FILE_BYTES: '1024' },
  });
  assert.equal(result.status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
