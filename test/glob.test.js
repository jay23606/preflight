const test = require('node:test');
const assert = require('node:assert');
const { matches, selectFiles } = require('../src/glob');

test('single star does not cross directories', () => {
  assert.ok(matches(['src/*.js'], 'src/index.js'));
  assert.ok(!matches(['src/*.js'], 'src/deep/index.js'));
});

test('double star crosses directories and matches zero of them', () => {
  assert.ok(matches(['src/**/*.js'], 'src/index.js'));
  assert.ok(matches(['src/**/*.js'], 'src/a/b/index.js'));
  assert.ok(matches(['**'], 'anything/at/all.txt'));
});

test('brace expansion', () => {
  assert.ok(matches(['**/*.{ts,tsx}'], 'app/page.tsx'));
  assert.ok(matches(['**/*.{ts,tsx}'], 'app/page.ts'));
  assert.ok(!matches(['**/*.{ts,tsx}'], 'app/page.js'));
});

test('negation removes matches', () => {
  const patterns = ['src/**/*.ts', '!src/**/*.d.ts'];
  assert.ok(matches(patterns, 'src/a.ts'));
  assert.ok(!matches(patterns, 'src/a.d.ts'));
});

test('a pattern list of only negations means everything else', () => {
  assert.ok(matches(['!**/*.md'], 'src/a.ts'));
  assert.ok(!matches(['!**/*.md'], 'README.md'));
});

test('selectFiles filters a list', () => {
  const files = ['web/a.aspx', 'web/a.aspx.cs', 'docs/b.md'];
  assert.deepEqual(selectFiles(['web/**/*.aspx'], files), ['web/a.aspx']);
});
