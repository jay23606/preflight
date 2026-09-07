const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('../src/manifest');
const { planChecks, runAll, substitute } = require('../src/runner');

const isWindows = process.platform === 'win32';
const echo = (text) => (isWindows ? `node -e "console.log('${text}')"` : `echo ${text}`);
const fail = 'node -e "console.error(\'boom\'); process.exit(3)"';

function checks(list) {
  return normalize({ checks: list }).checks;
}

test('planning selects only implicated checks, with their files', () => {
  const plan = planChecks(
    checks([
      { name: 'ts', when: ['src/**/*.ts'], run: 'true' },
      { name: 'sql', when: ['db/**/*.sql'], run: 'true' },
      { name: 'every', always: true, run: 'true' },
    ]),
    ['src/a.ts', 'src/b.ts', 'README.md'],
  );
  assert.deepEqual(
    plan.map((entry) => [entry.check.name, entry.files]),
    [
      ['ts', ['src/a.ts', 'src/b.ts']],
      ['every', []],
    ],
  );
});

test('"not" narrows the matched files', () => {
  const plan = planChecks(checks([{ name: 'ts', when: ['src/**'], not: ['**/*.test.ts'], run: 'true' }]), [
    'src/a.ts',
    'src/a.test.ts',
  ]);
  assert.deepEqual(plan[0].files, ['src/a.ts']);
});

test('--only narrows the plan', () => {
  const plan = planChecks(
    checks([
      { name: 'a', when: ['**'], run: 'true' },
      { name: 'b', when: ['**'], run: 'true' },
    ]),
    ['x.txt'],
    { only: ['b'] },
  );
  assert.deepEqual(plan.map((e) => e.check.name), ['b']);
});

test('{files} expands to shell-quoted paths', () => {
  assert.equal(substitute('lint {files}', ['a.js', 'b c.js']), 'lint a.js "b c.js"');
});

test('runs a passing and a failing check and reports both', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-'));
  const plan = planChecks(
    checks([
      { name: 'ok', when: ['**'], run: echo('fine') },
      { name: 'bad', when: ['**'], run: fail, why: 'because' },
    ]),
    ['a.txt'],
  );
  const results = await runAll(plan, { root, concurrency: 2 });
  assert.equal(results[0].status, 'pass');
  assert.match(results[0].stdout, /fine/);
  assert.equal(results[1].status, 'fail');
  assert.equal(results[1].code, 3);
  assert.match(results[1].stderr, /boom/);
  assert.equal(results[1].why, 'because');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a check that blows its budget is killed and marked timeout', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-'));
  const plan = planChecks(
    checks([{ name: 'slow', when: ['**'], run: 'node -e "setTimeout(()=>{}, 10000)"', budget: '300ms' }]),
    ['a.txt'],
  );
  const [result] = await runAll(plan, { root });
  assert.equal(result.status, 'timeout');
  assert.ok(result.durationMs < 5000, 'should not have waited for the command');
  fs.rmSync(root, { recursive: true, force: true });
});

test('the file list reaches the command through the environment', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-'));
  const plan = planChecks(
    checks([{ name: 'env', when: ['**'], run: 'node -e "console.log(process.env.PREFLIGHT_FILES)"' }]),
    ['a.txt', 'b.txt'],
  );
  const [result] = await runAll(plan, { root });
  assert.equal(result.stdout.trim().split(/\r?\n/).join(','), 'a.txt,b.txt');
  fs.rmSync(root, { recursive: true, force: true });
});
