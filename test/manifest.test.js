const test = require('node:test');
const assert = require('node:assert');
const { normalize, ManifestError, DEFAULT_BUDGET_MS } = require('../src/manifest');

const check = (extra) => ({ checks: [{ name: 'c', when: ['**'], run: 'true', ...extra }] });

test('normalizes a minimal check', () => {
  const manifest = normalize(check());
  assert.equal(manifest.checks[0].budgetMs, DEFAULT_BUDGET_MS);
  assert.equal(manifest.checks[0].severity, 'error');
  assert.equal(manifest.checks[0].each, false);
});

test('parses budget units', () => {
  assert.equal(normalize(check({ budget: '500ms' })).checks[0].budgetMs, 500);
  assert.equal(normalize(check({ budget: '20s' })).checks[0].budgetMs, 20_000);
  assert.equal(normalize(check({ budget: '2m' })).checks[0].budgetMs, 120_000);
  assert.equal(normalize(check({ budget: 30 })).checks[0].budgetMs, 30_000);
});

test('a string "when" is lifted to a list', () => {
  assert.deepEqual(normalize(check({ when: 'src/**' })).checks[0].when, ['src/**']);
});

test('rejects the mistakes people actually make', () => {
  assert.throws(() => normalize({}), ManifestError);
  assert.throws(() => normalize({ checks: [{ when: ['**'], run: 'true' }] }), ManifestError, 'missing name');
  assert.throws(() => normalize({ checks: [{ name: 'c', when: ['**'] }] }), ManifestError, 'missing run');
  assert.throws(() => normalize({ checks: [{ name: 'c', run: 'true' }] }), ManifestError, 'missing when');
  assert.throws(() => normalize(check({ budget: 'soon' })), ManifestError);
  assert.throws(() => normalize(check({ severity: 'loud' })), ManifestError);
  assert.throws(() => normalize(check({ wen: ['**'] })), ManifestError, 'typo in field name');
  assert.throws(
    () => normalize({ checks: [{ name: 'c', when: ['**'], run: 'true' }, { name: 'c', when: ['**'], run: 'true' }] }),
    ManifestError,
    'duplicate name',
  );
});

test('always:true removes the need for when', () => {
  const manifest = normalize({ checks: [{ name: 'c', always: true, run: 'true' }] });
  assert.equal(manifest.checks[0].always, true);
});
