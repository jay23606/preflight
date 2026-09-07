#!/usr/bin/env node
// Replay a repository's history against a manifest.
//
// For each commit: check out that commit, take the files it changed, and run
// only the checks those files implicate — exactly what preflight would have
// done had it been installed at the time. The output is a frequency, which is
// the half of "is this worth it" that a synthetic benchmark cannot supply.
//
// Usage:
//   node bench/replay.js --repo <url|path> [--limit 100] [--manifest <path>]
//                        [--out report.md] [--samples 3]
//
// What it measures: how often each check would have fired, on real commits.
// What it does NOT measure: whether each firing is a true positive. That needs
// a human to read them, which is why sample hits are printed verbatim.

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'preflight.js');
const DEFAULT_MANIFEST = path.join(__dirname, 'replay-manifest.yaml');

function parseArgs(argv) {
  const options = { repo: null, limit: 100, manifest: DEFAULT_MANIFEST, out: null, samples: 3, maxFiles: 300 };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case '--repo': options.repo = next(); break;
      case '--limit': options.limit = Number(next()); break;
      case '--manifest': options.manifest = path.resolve(next()); break;
      case '--out': options.out = path.resolve(next()); break;
      case '--samples': options.samples = Number(next()); break;
      case '--max-files': options.maxFiles = Number(next()); break;
      default: throw new Error(`unknown option ${argv[i]}`);
    }
  }
  if (!options.repo) throw new Error('--repo is required');
  return options;
}

function git(args, cwd, { allowFail = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`git ${args.slice(0, 3).join(' ')} failed: ${(result.stderr || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

function prepareRepo(source) {
  if (fs.existsSync(source) && fs.existsSync(path.join(source, '.git'))) {
    // Never touch the user's checkout: clone it into a temp directory.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-replay-'));
    execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', '--quiet', '--no-hardlinks', source, dir], { stdio: 'ignore' });
    return { dir, cleanup: true };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-replay-'));
  execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', '--quiet', source, dir], { stdio: 'inherit' });
  return { dir, cleanup: true };
}

function run(options) {
  const { dir, cleanup } = prepareRepo(options.repo);
  const started = Date.now();
  try {
    git(['config', 'core.autocrlf', 'false'], dir);
    git(['config', 'advice.detachedHead', 'false'], dir);

    // The manifest rides along as an untracked file, so it survives every
    // checkout and preflight resolves paths against the repository root.
    const manifestTarget = path.join(dir, 'preflight.yaml');
    if (fs.existsSync(manifestTarget)) throw new Error('this repository already has a preflight.yaml; pass --manifest to override deliberately');
    fs.copyFileSync(options.manifest, manifestTarget);

    // First-parent only: a merge commit's "changes" are the whole branch, and
    // counting them would inflate every number here.
    const commits = git(['rev-list', '--first-parent', '--no-merges', `-n${options.limit}`, 'HEAD'], dir)
      .split('\n')
      .filter(Boolean);

    const perCheck = new Map();
    let commitsWithFindings = 0;
    let commitsReplayed = 0;
    let filesConsidered = 0;
    let totalRunMs = 0;

    for (const sha of commits) {
      const parent = git(['rev-parse', '--verify', `${sha}^`], dir, { allowFail: true });
      if (!parent) continue; // root commit: nothing to diff against

      const changed = git(['diff', '--name-only', '--diff-filter=ACMR', '-M', parent, sha], dir)
        .split('\n')
        .map((line) => (line.includes('\t') ? line.slice(line.lastIndexOf('\t') + 1) : line))
        .filter(Boolean);
      if (changed.length === 0 || changed.length > options.maxFiles) continue;

      // --force: the replay owns this throwaway clone, and a line-ending or
      // mode difference must never stop the walk.
      git(['checkout', '--quiet', '--force', '--detach', sha], dir);
      // The manifest is untracked, but a checkout of a commit that predates a
      // file can leave stale files behind; clean everything except it.
      git(['clean', '-qfd', '-e', 'preflight.yaml'], dir, { allowFail: true });

      const existing = changed.filter((file) => fs.existsSync(path.join(dir, file)));
      if (existing.length === 0) continue;

      const runStarted = Date.now();
      const result = spawnSync(process.execPath, [CLI, '--json', ...existing], {
        cwd: dir,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: '1' },
      });
      totalRunMs += Date.now() - runStarted;
      commitsReplayed++;
      filesConsidered += existing.length;

      let parsed;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        continue; // a manifest or runtime error on this commit; do not count it
      }

      let hitThisCommit = false;
      for (const check of parsed.checks) {
        if (check.status === 'pass') continue;
        hitThisCommit = true;
        if (!perCheck.has(check.name)) perCheck.set(check.name, { count: 0, commits: [], samples: [] });
        const entry = perCheck.get(check.name);
        entry.count++;
        entry.commits.push(sha.slice(0, 7));
        if (entry.samples.length < options.samples) {
          const firstLines = (check.output || '')
            .split('\n')
            .filter((line) => line.trim() && !/^(Move it|Write the real|Remove the|Add |Run |If |For |Use |Set )/.test(line))
            .slice(0, 2);
          entry.samples.push({ sha: sha.slice(0, 7), lines: firstLines });
        }
      }
      if (hitThisCommit) commitsWithFindings++;
    }

    return {
      repo: options.repo,
      commitsReplayed,
      commitsWithFindings,
      filesConsidered,
      medianRunMs: commitsReplayed ? Math.round(totalRunMs / commitsReplayed) : 0,
      perCheck,
      wallMs: Date.now() - started,
    };
  } finally {
    if (cleanup) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function report(result) {
  const lines = [];
  lines.push(`## ${result.repo}`);
  lines.push('');
  if (result.commitsReplayed === 0) {
    lines.push('_No replayable commits._');
    lines.push('');
    return lines.join('\n');
  }
  const rate = ((result.commitsWithFindings / result.commitsReplayed) * 100).toFixed(0);
  lines.push(
    `${result.commitsReplayed} commits replayed, ${result.filesConsidered} files, ${result.medianRunMs} ms average per commit.`,
  );
  lines.push('');
  lines.push(`**${result.commitsWithFindings} of ${result.commitsReplayed} commits (${rate}%) would have been flagged.**`);
  lines.push('');
  if (result.perCheck.size === 0) {
    lines.push('No check fired. Either the repository is clean on these dimensions, or the checks are not the right ones for it.');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('| check | commits flagged | example commits |');
  lines.push('|---|---|---|');
  for (const [name, entry] of [...result.perCheck].sort((a, b) => b[1].count - a[1].count)) {
    lines.push(`| ${name} | ${entry.count} | ${entry.commits.slice(0, 5).join(', ')} |`);
  }
  lines.push('');
  lines.push('### Sample findings, verbatim — judge these yourself');
  lines.push('');
  for (const [name, entry] of result.perCheck) {
    lines.push(`**${name}**`);
    lines.push('');
    lines.push('```');
    for (const sample of entry.samples) {
      for (const line of sample.lines) lines.push(`${sample.sha}  ${line.trim()}`);
    }
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n');
}

if (require.main === module) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`replay: ${error.message}`);
    process.exit(2);
  }
  const result = run(options);
  const text = `# preflight history replay\n\nManifest: \`${path.basename(options.manifest)}\`\n\n${report(result)}`;
  console.log(text);
  if (options.out) fs.writeFileSync(options.out, text + '\n', 'utf8');
}

module.exports = { run, report };
