const fs = require('node:fs');
const path = require('node:path');

// `preflight init` writes a starter manifest. It deliberately writes checks
// that are commented out rather than guessing: a manifest full of checks that
// fail on day one gets deleted, and a manifest full of checks that pass
// vacuously teaches the wrong lesson. The generated file is a prompt.

function detect(root) {
  const has = (relative) => fs.existsSync(path.join(root, relative));
  const stacks = [];
  if (has('package.json')) stacks.push('node');
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) stacks.push('python');
  if (has('go.mod')) stacks.push('go');
  if (has('Cargo.toml')) stacks.push('rust');
  if (fs.readdirSync(root).some((entry) => entry.endsWith('.sln') || entry.endsWith('.csproj'))) stacks.push('dotnet');
  return stacks;
}

const SOURCE_GLOBS = {
  node: '"src/**/*.{ts,tsx,js,jsx}"',
  python: '"**/*.py"',
  go: '"**/*.go"',
  rust: '"src/**/*.rs"',
  dotnet: '"**/*.cs"',
};

const TEST_COMMANDS = {
  node: 'npm test',
  python: 'python -m pytest -q',
  go: 'go test ./...',
  rust: 'cargo test',
  dotnet: 'dotnet test',
};

function template(stacks) {
  const primary = stacks[0] || 'node';
  const sourceGlob = SOURCE_GLOBS[primary] || '"src/**/*"';
  const testCommand = TEST_COMMANDS[primary] || 'make test';

  return `# preflight — the checks a diff actually implicates.
#
# The presets below work on day one. The checks worth having are the ones
# below THEM: a manifest of plausible-sounding generic rules gets deleted,
# and a manifest with one check that has already saved someone gets extended.
#
# Detected stack: ${stacks.length ? stacks.join(', ') : 'none — edit the globs below'}
version: 1

extends:
  - preflight:hygiene   # focused tests, conflict markers, oversized files
  - preflight:secrets   # provider-issued credential shapes
  - preflight:agent     # elided code and unimplemented stubs

checks:
  # --- Uncomment and adapt. Each of these is a shape, not a rule. ---

  # Cross-file invariant: two files that must move together.
  # - name: routes-match-spec
  #   when: ["src/routes/**"]
  #   run: node tools/check-spec.js
  #   why: A route changed without the API spec, so the published contract now lies.

  # Environment drift: config read but never documented.
  # - name: env-documented
  #   when: [${sourceGlob}]
  #   run: node tools/check-env.js {files}
  #   why: An undocumented variable deploys fine and comes up undefined in production.

  # Generated code that has drifted from its source.
  # - name: generated-in-sync
  #   when: ["schema/**"]
  #   run: make generate && git diff --exit-code
  #   why: The generated client no longer matches the schema it came from.

  # The narrow slice of the suite this diff can break.
  # - name: affected-tests
  #   when: [${sourceGlob}]
  #   run: ${testCommand}
  #   budget: 2m

  # A trap specific to THIS repo. This is the valuable one — the thing you
  # explain to every new hire, and to every AI agent, over and over.
  # - name: <the-thing-that-keeps-biting-us>
  #   when: ["..."]
  #   run: "..."
  #   why: <what breaks, and where it surfaces>
`;
}

function init(root, { force = false } = {}) {
  const target = path.join(root, 'preflight.yaml');
  if (fs.existsSync(target) && !force) {
    return { created: false, path: target, reason: 'preflight.yaml already exists (use --force to overwrite)' };
  }
  const stacks = detect(root);
  fs.writeFileSync(target, template(stacks), 'utf8');
  return { created: true, path: target, stacks };
}

module.exports = { init, detect, template };
