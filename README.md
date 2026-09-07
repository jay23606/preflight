# preflight

**Run only the checks a diff actually implicates.**

Zero dependencies. One `preflight.yaml`. Works in any language, because it shells out.

```bash
npx github:jay23606/preflight
```

```
preflight · 3 files (staged) · 4/4 checks

  x migration-has-rollback   101ms 1 file
  ! routes-match-spec         95ms 1 file
  x no-hardcoded-secrets     120ms 2 files
  x env-documented           149ms 2 files

env-documented failed
  why  Every process.env read must appear in .env.example. A new variable that
       nobody documented deploys fine in CI and then comes up undefined in
       production, usually as a confusing downstream error rather than a startup
       failure.
  run  node tools/check-env.js src/config.ts src/routes/refunds.ts
  ---
  src/routes/refunds.ts:4  reads STRIPE_SECRET_KEY, which is not in .env.example
  src/routes/refunds.ts:7  reads REFUNDS_ENABLED, which is not in .env.example

3 checks failed, 1 warned, 0 passed  (153ms)
```

## The gap this fills

Your linter reads one file. Your type checker reads the type graph. Your test suite is too slow to run on every edit and only catches what someone wrote a test for.

None of them catch the mistakes that live *between* files:

- a migration shipped without a rollback
- a new `process.env` read that nobody added to `.env.example`
- a route handler changed while the OpenAPI spec stayed put
- generated code that drifted from the schema it was generated from
- a live API key pasted into a config file "temporarily"

Every one of those passes `tsc`, `go vet`, `eslint`, and the test suite. Every one is about ten lines of script to detect. Almost nobody writes those ten lines, because there is nowhere obvious to put them and no cheap moment to run them.

`preflight` is that place and that moment.

## Measured, not asserted

`node bench/run.js` seeds each example repo with realistic defects and runs both the repo's own toolchain and preflight against them:

| # | defect | surfaces as | baseline | preflight |
|---|--------|-------------|----------|-----------|
| 1 | New `STRIPE_SECRET_KEY` / `REFUNDS_ENABLED` reads, undocumented | undefined config in production | **escapes** | **caught** |
| 2 | Migration 002 shipped with no rollback | unrecoverable during an incident | **escapes** | **caught** |
| 3 | Database password hardcoded in a connection string | credential leak, rotation required | **escapes** | **caught** |
| 4 | New route added, `openapi.yaml` untouched | published contract drifts | **escapes** | **caught** |

**4/4 caught by preflight. 0/4 caught by the baseline**, which exits 0 on every one of them. Median cost: **~250 ms**.

The benchmark deliberately reports what it does *not* measure: whether a reviewer would have caught the same defect by reading the diff, false-positive rates on real repositories, and anything about how often these defects actually occur. Run it yourself — the numbers regenerate.

## Why this matters more with AI in the loop

An agent writes more code per hour than you can carefully read, and it is systematically weakest exactly where these defects live: it sees the file it is editing, not the invariant three directories away. It cannot know that this repo pairs migrations with rollbacks, or that inline templates here compile at request time rather than build time — unless something tells it, every time, mechanically.

A `preflight.yaml` is that mechanism. It converts your repo's hard-won institutional knowledge — the things you explain to every new hire and re-explain in every code review — into a two-second command with an exit code.

Point your agent at [`AGENTS.md`](AGENTS.md) and it knows how to run the checks, how to read a failure, and how to write new ones.

## Install

```bash
npx github:jay23606/preflight init      # writes a starter preflight.yaml
npx github:jay23606/preflight           # run it
```

Or add it as a dev dependency: `npm i -D github:jay23606/preflight`. Node 18+, no dependencies of its own — so `npx` is a fast, auditable path into any repo, including ones that are not JavaScript at all.

## The manifest

```yaml
version: 1

checks:
  - name: migration-has-rollback
    when: ["db/migrations/**/*.up.sql"]
    run: node tools/check-migrations.js {files}
    budget: 5s
    why: >
      Every up migration needs a matching down. A migration without a
      rollback is discovered during the incident, not before it.

  - name: routes-match-spec
    severity: warn
    when: ["src/routes/**/*.ts"]
    run: node tools/check-spec.js
    why: >
      A route changed without openapi.yaml, so the published contract lies.
```

A check may also declare a `fix:` command; `preflight --fix` runs it and then re-runs the check, so a repair that does not actually repair anything still fails.

### Presets

`preflight init` starts you with three inherited check sets, so the tool is useful before you have written anything:

```yaml
extends:
  - preflight:hygiene     # focused tests, conflict markers, oversized files
  - preflight:secrets     # provider-issued credential shapes, low false-positive
  - preflight:agent       # elided code ("... rest unchanged"), unimplemented stubs

disable: [no-large-files] # drop one you do not want
```

A local check with the same `name` as an inherited one replaces it in place — keep the preset, retune the check. `extends` also takes a path, so a team can share one file across repositories.

`preflight:agent` is worth calling out: it catches the failure modes specific to machine-written code. A model that writes `// ... rest of the implementation unchanged` into a real source file has deleted everything that comment claims to stand for, and nothing else in your toolchain will tell you.

`when` globs decide whether a check runs at all. `{files}` expands to the matched paths. `budget` kills the whole process tree at the limit, so one hung check cannot hang your commit. `why` is printed on failure — it is the part that teaches, and the reason a failure is actionable by someone who did not write the check.

Full field reference and the environment variables a check receives: [`AGENTS.md`](AGENTS.md).

## Scope selection

```bash
preflight                          # staged files, else the working tree
preflight --staged                 # what a commit would contain
preflight --since origin/main      # everything this branch changed
preflight --all                    # every tracked file
preflight src/api                  # explicit paths
preflight --only no-secrets        # one check
preflight --json                   # machine-readable
preflight --fix                    # let checks that can repair themselves do it
```

## Examples

Three worked examples, each with a clean state and a realistic bad change:

```bash
node examples/run-demo.js                 # all of them
node examples/run-demo.js node-service    # one
```

- [`examples/node-service`](examples/node-service) — env drift, migration rollbacks, secret scanning, spec sync. Checks in JavaScript.
- [`examples/python-api`](examples/python-api) — model/migration divergence, unpinned requirements, notebook outputs containing customer data. Checks in Python.
- [`examples/go-cli`](examples/go-cli) — generated code drift, no-panic-in-handlers. Checks in Go.

The checks in each example are written in that example's own language, on purpose: preflight only shells out, so checks are written in whatever the repo already speaks by the people who already maintain it.

## Hooks

Pre-commit:

```bash
printf '#!/bin/sh\nnpx github:jay23606/preflight --staged\n' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

GitHub Actions:

```yaml
- run: npx github:jay23606/preflight --since origin/${{ github.base_ref }}
```

Claude Code, after every edit — `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "npx github:jay23606/preflight --working --quiet" }]
      }
    ]
  }
}
```

## Design notes

**Zero dependencies.** This runs in a pre-commit hook and on every agent edit. A dependency tree is startup latency, supply-chain surface, and an install step, and this tool is not complicated enough to need one. That includes the YAML parser: [`src/yaml.js`](src/yaml.js) implements the subset the manifest needs and raises a parse error on anything else, rather than silently misreading it.

**Budgets kill the process tree, not the shell.** Checks run through a shell, so the spawned process is the shell and the real work is its child. Killing only the shell leaves the command running past its budget — which would make budgets decorative. See [`src/runner.js`](src/runner.js).

**Warnings do not fail.** A check you are not yet willing to block on is still worth surfacing, and `severity: warn` is how a check earns trust before it earns teeth.

**`why` is a required-in-spirit field.** A guardrail whose rationale is lost gets removed the first time it is inconvenient. Writing down what breaks is what makes a check survive contact with a deadline.

## Contributing

Issues and PRs welcome, particularly new example repos in languages not covered yet, and check *shapes* that generalize across repositories.

```bash
npm test                 # unit + CLI end-to-end
node examples/run-demo.js
node bench/run.js
```

## License

MIT
