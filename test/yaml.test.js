const test = require('node:test');
const assert = require('node:assert');
const { parse, YamlError } = require('../src/yaml');

test('parses the manifest shape', () => {
  const doc = parse(`
version: 1
checks:
  - name: no-secrets
    when: ["**"]
    run: node tools/secrets.js {files}
    why: Committed credentials are unrecoverable once pushed.
    budget: 5s
  - name: affected-tests
    when:
      - "src/**/*.ts"
      - "!src/**/*.d.ts"
    run: npm test
    each: false
`);
  assert.equal(doc.version, 1);
  assert.equal(doc.checks.length, 2);
  assert.deepEqual(doc.checks[0].when, ['**']);
  assert.equal(doc.checks[0].budget, '5s');
  assert.equal(doc.checks[0].why, 'Committed credentials are unrecoverable once pushed.');
  assert.deepEqual(doc.checks[1].when, ['src/**/*.ts', '!src/**/*.d.ts']);
  assert.equal(doc.checks[1].each, false);
});

test('handles quoted strings, comments and colons in values', () => {
  const doc = parse(`
checks:
  - name: urls          # trailing comment
    when: ["**"]
    run: "curl -s https://example.com/health"
    why: 'It'' s fine to quote'
`);
  assert.equal(doc.checks[0].run, 'curl -s https://example.com/health');
  assert.equal(doc.checks[0].why, "It' s fine to quote");
});

test('supports block scalars', () => {
  const doc = parse(`
checks:
  - name: multi
    when: ["*.js"]
    run: |
      echo one
      echo two
`);
  assert.equal(doc.checks[0].run, 'echo one\necho two\n');
});

test('rejects tabs and duplicate keys', () => {
  assert.throws(() => parse('checks:\n\t- name: x\n'), YamlError);
  assert.throws(() => parse('a: 1\na: 2\n'), YamlError);
});

test('empty document is an empty mapping', () => {
  assert.deepEqual(parse('\n# nothing here\n'), {});
});
