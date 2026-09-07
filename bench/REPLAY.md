# History replay: what the shipped presets would actually have caught

`bench/replay.js` walks a repository's real history. For each commit it checks
out that commit, takes the files the commit changed, and runs only the checks
those files implicate — exactly what preflight would have done had it been
installed at the time.

The seeded-defect benchmark answers "does a check catch the thing it is aimed
at." This answers the question that actually decides whether the tool is worth
installing: **how often would it have fired on real work.**

```bash
node bench/replay.js --repo https://github.com/owner/name --limit 100
```

## Result

Run against seven repositories with the shipped presets only
(`preflight:hygiene`, `preflight:secrets`, `preflight:agent`) — nothing tuned
to any repository:

| repository | commits | flagged | what fired |
|---|---|---|---|
| mayfly | 100 | 0 | — |
| worktrade | 100 | 0 | — |
| BotGarden | 87 | 0 | — |
| foyer | 21 | 0 | — |
| chute | 1 | 0 | — |
| peek | 1 | 0 | — |
| openstart | 100 | 1 | `no-large-files` (a 2.2 MB PNG) |
| appmegle | 58 | 1 | `no-large-files` |
| **total** | **468** | **2 (0.4%)** | |

Median cost: **~290 ms per commit**, including the checkout.

## What this says

**The generic presets are close to worthless on their own.** Two hits in 468
commits, both "you committed a big image", neither of which would have caused
an incident. If the pitch for this tool were "install the presets and it will
catch things", this table refutes it.

That is the honest headline, and it is the opposite of what the presets
section of the README implied before this was measured.

**The presets are still worth shipping** for two narrower reasons: they make
the tool do something on day one so the manifest is not an empty file staring
at you, and `preflight:agent` targets a failure mode that barely existed in
these repositories' histories — most of these commits predate heavy agent use.
That check is aimed at a future that this backward-looking measurement cannot
see, which is a real limitation of the method, not evidence in its favour.

**The value is in the repo-specific checks.** Every genuinely expensive defect
in the seeded benchmark — the migration with no rollback, the route that
drifted from its spec, the inline `.aspx` that compiles at request time — is a
rule somebody had to know about that codebase. No preset will ever ship those.
The tool is a place to put them; it does not supply them.

So the sequence that makes sense is: install it, ignore the presets, and add
one check the next time something breaks in a way a script could have caught.
Run the replay against your own history to see whether that check would have
fired before, and how often.

## The replay found a bug in our own preset

The first run flagged two openstart commits for `no-committed-secrets`. The
line was:

```sh
DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
```

A shell default pointing at localhost with a stock password — not a leaked
credential. A false positive, in the check most likely to be trusted blindly.

`secret-scan.js` now ignores connection strings that target a local host, use
a stock password, or appear inside a shell/template default, and the case is
pinned by a test. A second run of the same 100 commits produced no secret
findings.

This is the argument for running the replay before trusting any check: a
synthetic benchmark only ever shows you the defects you thought to seed.

## What this does not measure

- **Whether an unflagged commit was actually fine.** Absence of a finding is
  absence of a *rule*, not evidence of correctness.
- **True positive rate for `preflight:agent`.** These histories are mostly
  human-written; the checks aimed at generated code had little to find.
- **Anything about a large multi-author codebase.** Every repository here is
  small and single-author, which is exactly where informal knowledge works
  fine and a tool like this has least to offer.
