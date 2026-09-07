# preflight, for coding agents

This file is written for an AI agent working in a repository that has (or should have) a `preflight.yaml`. It is deliberately short and operational.

## What this tool is for

You write code you cannot fully verify. Type checkers catch shape errors, tests catch behavior they were written to catch, and neither catches the class of mistake that is about *the relationship between files* — a migration without a rollback, a config read that was never documented, a route that no longer matches its spec, generated code that drifted from its source. Those mistakes look fine in the diff and surface at deploy time.

`preflight` is the repo's answer to "which cheap checks does this specific diff implicate." Run it before you say you are done.

## Using it

```bash
npx github:jay23606/preflight              # staged files, else the working tree
npx github:jay23606/preflight --json       # same, machine-readable
npx github:jay23606/preflight --since origin/main
npx github:jay23606/preflight --list       # what checks exist and why
```

Exit codes: `0` clean, `1` a check failed, `2` bad usage or bad manifest. Warnings never fail the run.

**Use `--json` when you are going to act on the result.** It gives you one object per check with `status`, `why`, `command`, `files`, and `output` — no ANSI, no parsing of pretty output.

## The loop you should run

1. Make your change.
2. Run `preflight`. It costs a few hundred milliseconds for a typical diff.
3. If a check fails, read its `why`. The `why` states the failure mode; the output states the instance. Fix the cause, not the symptom — do not delete the check, loosen its glob, or add a suppression comment to make it pass.
4. Re-run. Report the result honestly, including any check you could not satisfy.

If a check fails and you genuinely believe the check is wrong, say so explicitly in your summary to the user and leave it failing. Silently disabling a guardrail is worse than the original defect, because it removes the signal for everyone afterward.

## Writing a new check

Adding a check is usually the right response to "we just got bitten by X again." A good check is:

- **Cheap.** Under a second where possible; give it a `budget` you would be happy to pay on every commit.
- **Scoped.** `when:` should name the files that can actually cause the failure. A check that runs on every commit had better be nearly free.
- **Specific.** It fails on the real defect and not on ten adjacent innocent things. A check that cries wolf gets deleted within a week, and takes the good checks with it.
- **Explained.** The `why` is the whole point. Write what breaks and where it surfaces, not what the check does.

Minimal manifest:

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
```

### Presets

A manifest can inherit checks instead of writing them:

```yaml
extends:
  - preflight:hygiene     # focused tests, conflict markers, oversized files
  - preflight:secrets     # provider-issued credential shapes
  - preflight:agent       # elided code, unimplemented stubs
  - ./shared/team.yaml    # a path, resolved relative to this file

disable: [no-large-files] # drop one inherited check

checks:
  - name: no-focused-tests   # same name as an inherited check: replaces it
    when: ["src/**"]
    run: ...
```

A local check with the same name as an inherited one **replaces** it in place, which is how you keep a preset and retune one of its checks. `disable` drops one entirely, and naming a check that does not exist is an error rather than a silent no-op.

Inside a preset, `{here}` expands to the directory of the file that declared the check, so a preset can call its own scripts from inside a repository that has never heard of them.

Presets are a starting point, not the goal. The check that earns its keep is the one describing *this* repository's trap.

### Fields

| field | meaning |
|---|---|
| `name` | unique; used by `--only` and shown in output |
| `when` | globs; the check runs when the diff touches a match. `*`, `**`, `?`, `{a,b}`, `[abc]`, leading `!` to negate |
| `not` | globs subtracted from the matches |
| `always: true` | run on every invocation regardless of the diff (use sparingly) |
| `run` | shell command. `{files}` expands to the matched paths, shell-quoted; `{here}` to the declaring file's directory |
| `fix` | optional repair command. With `--fix`, a failing check runs this and is then re-checked |
| `why` | why this matters, in prose. Printed on failure |
| `budget` | `500ms`, `20s`, `2m`. The whole process tree is killed at the limit |
| `severity` | `error` (default, fails the run) or `warn` (reports only) |
| `each: true` | run the command once per matched file instead of once for all |
| `cwd` | run relative to this subdirectory |

### Fixes

If a check can repair its own failure deterministically — regenerate a client, format a file, add the missing pin — give it a `fix`:

```yaml
  - name: generated-in-sync
    when: ["schema/**"]
    run: make generate && git diff --exit-code
    fix: make generate
    why: The generated client no longer matches the schema it came from.
```

`preflight --fix` runs the fix and then **re-runs the check**, which is what decides pass or fail. A fix that exits 0 without actually fixing anything still leaves the run red — a repair command cannot launder a failure into a pass.

Only write a `fix` when the repair is mechanical and has one correct answer. "Add the variable to `.env.example`" is mechanical. "Write the missing rollback migration" is not: that needs judgment, and a fix that guesses at it produces a plausible-looking wrong migration, which is worse than the original failure.

### Environment available to a check

| variable | contents |
|---|---|
| `PREFLIGHT_FILES` | newline-separated matched files |
| `PREFLIGHT_FILES_FILE` | path to a file containing that list (use this when the list may be long) |
| `PREFLIGHT_CHANGED_FILES` | **every** changed file, not just this check's matches |
| `PREFLIGHT_ROOT` | repo root, so a check can resolve paths |
| `PREFLIGHT_CHECK` | this check's name |

`PREFLIGHT_CHANGED_FILES` is the one that makes cross-file checks possible: "these route files changed and the spec did not" is a statement about a file that is *absent* from the diff, which `{files}` alone can never tell you.

### Shapes worth stealing

- **Paired files.** A changed X requires a corresponding Y (migration/rollback, schema/generated client, component/story).
- **Documentation drift.** A new `process.env` read, feature flag, or CLI option that appears nowhere in the documented list.
- **Generated code.** Re-run the generator and `git diff --exit-code`.
- **House rules a linter has no opinion about.** No `panic()` in handlers, no direct DB access from controllers, no `.only` in a committed test.
- **The trap that only exists here.** The thing you would explain to a new hire in their first week. This is the highest-value check in most repos and the one no off-the-shelf tool will ever ship.

### Anti-patterns

- Restating a rule your linter already enforces. Run the linter.
- A check whose `run` is the entire test suite with no `when` scoping.
- A `why` that paraphrases the command (`"checks that migrations have rollbacks"`). Say what breaks.
- Vague globs (`when: ["**"]`) on an expensive command.

## Hooking it up

Pre-commit:

```bash
echo 'npx github:jay23606/preflight --staged' >> .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```

CI, checking the whole branch:

```yaml
- run: npx github:jay23606/preflight --since origin/${{ github.base_ref }}
```

Claude Code, after every edit — in `.claude/settings.json`:

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
