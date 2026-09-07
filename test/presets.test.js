const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load, ManifestError, PRESETS_DIR } = require('../src/manifest');

function withManifest(files, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-preset-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('every shipped preset loads', () => {
  const presets = fs.readdirSync(PRESETS_DIR).filter((entry) => entry.endsWith('.yaml'));
  assert.ok(presets.length > 0, 'there should be presets to load');
  for (const preset of presets) {
    const manifest = load(path.join(PRESETS_DIR, preset));
    assert.ok(manifest.checks.length > 0, `${preset} has no checks`);
    for (const check of manifest.checks) {
      assert.ok(check.why, `${preset}: ${check.name} has no why`);
    }
  }
});

test('a preset script referenced by {here} actually exists', () => {
  for (const preset of fs.readdirSync(PRESETS_DIR).filter((e) => e.endsWith('.yaml'))) {
    for (const check of load(path.join(PRESETS_DIR, preset)).checks) {
      const match = check.run.match(/\{here\}\/(\S+)/);
      if (!match) continue;
      assert.ok(fs.existsSync(path.join(PRESETS_DIR, match[1])), `${preset}: ${check.name} points at a missing ${match[1]}`);
    }
  }
});

test('extends pulls in preset checks and keeps local ones', () => {
  withManifest(
    {
      'preflight.yaml': 'extends: preflight:hygiene\nchecks:\n  - name: mine\n    when: ["**"]\n    run: "true"\n',
    },
    (dir) => {
      const names = load(path.join(dir, 'preflight.yaml')).checks.map((c) => c.name);
      assert.ok(names.includes('no-focused-tests'));
      assert.ok(names.includes('mine'));
    },
  );
});

test('a local check with the same name overrides the inherited one, in place', () => {
  withManifest(
    {
      'preflight.yaml':
        'extends: preflight:hygiene\nchecks:\n  - name: no-focused-tests\n    when: ["src/**"]\n    run: "echo mine"\n',
    },
    (dir) => {
      const checks = load(path.join(dir, 'preflight.yaml')).checks;
      const overridden = checks.filter((c) => c.name === 'no-focused-tests');
      assert.equal(overridden.length, 1, 'the override must replace, not duplicate');
      assert.equal(overridden[0].run, 'echo mine');
      assert.equal(checks.indexOf(overridden[0]), 0, 'it keeps the inherited position');
    },
  );
});

test('disable removes an inherited check', () => {
  withManifest(
    {
      'preflight.yaml': 'extends: preflight:hygiene\ndisable: [no-large-files]\nchecks: []\n',
    },
    (dir) => {
      const names = load(path.join(dir, 'preflight.yaml')).checks.map((c) => c.name);
      assert.ok(!names.includes('no-large-files'));
      assert.ok(names.includes('no-merge-markers'));
    },
  );
});

test('disabling a check that does not exist is an error, not a silent no-op', () => {
  withManifest({ 'preflight.yaml': 'disable: [ghost]\nchecks: []\n' }, (dir) => {
    assert.throws(() => load(path.join(dir, 'preflight.yaml')), ManifestError);
  });
});

test('extends can point at a local file, and cycles are refused', () => {
  withManifest(
    {
      'preflight.yaml': 'extends: ./shared/team.yaml\nchecks: []\n',
      'shared/team.yaml': 'checks:\n  - name: team-rule\n    when: ["**"]\n    run: "true"\n',
    },
    (dir) => {
      assert.deepEqual(load(path.join(dir, 'preflight.yaml')).checks.map((c) => c.name), ['team-rule']);
    },
  );

  withManifest(
    {
      'preflight.yaml': 'extends: ./b.yaml\nchecks: []\n',
      'b.yaml': 'extends: ./preflight.yaml\nchecks: []\n',
    },
    (dir) => {
      assert.throws(() => load(path.join(dir, 'preflight.yaml')), /circular/);
    },
  );
});

test('an unknown preset names the ones that exist', () => {
  withManifest({ 'preflight.yaml': 'extends: preflight:nope\nchecks: []\n' }, (dir) => {
    assert.throws(() => load(path.join(dir, 'preflight.yaml')), /available: /);
  });
});

test('a preset check remembers its own directory for {here}', () => {
  withManifest({ 'preflight.yaml': 'extends: preflight:secrets\nchecks: []\n' }, (dir) => {
    const check = load(path.join(dir, 'preflight.yaml')).checks[0];
    assert.equal(check.baseDir, PRESETS_DIR);
  });
});
