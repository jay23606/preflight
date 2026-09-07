const { execFileSync } = require('node:child_process');
const path = require('node:path');

class GitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitError';
  }
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const detail = (error.stderr || error.message || '').toString().trim();
    throw new GitError(`git ${args.join(' ')} failed: ${detail}`);
  }
}

function isRepo(cwd) {
  try {
    git(['rev-parse', '--git-dir'], cwd);
    return true;
  } catch {
    return false;
  }
}

function repoRoot(cwd) {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

function toLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

// Renames come back as `old\tnew` under --name-only with -M; take the new path.
function nameOnly(args, cwd) {
  return toLines(git(args, cwd)).map((line) => {
    const tab = line.lastIndexOf('\t');
    return tab === -1 ? line : line.slice(tab + 1);
  });
}

function hasCommits(cwd) {
  try {
    git(['rev-parse', '--verify', 'HEAD'], cwd);
    return true;
  } catch {
    return false;
  }
}

function stagedFiles(cwd) {
  const args = ['diff', '--name-only', '--diff-filter=ACMR', '-M', '--cached'];
  if (hasCommits(cwd)) args.push('HEAD');
  return nameOnly(args, cwd);
}

function unstagedFiles(cwd) {
  const tracked = nameOnly(['diff', '--name-only', '--diff-filter=ACMR', '-M'], cwd);
  const untracked = toLines(git(['ls-files', '--others', '--exclude-standard'], cwd));
  return [...tracked, ...untracked];
}

function sinceFiles(ref, cwd) {
  // Three-dot: what this branch changed, not what the base moved on to.
  const base = git(['merge-base', ref, 'HEAD'], cwd).trim();
  return nameOnly(['diff', '--name-only', '--diff-filter=ACMR', '-M', base, 'HEAD'], cwd);
}

function allFiles(cwd) {
  return toLines(git(['ls-files'], cwd));
}

function dedupe(files) {
  return [...new Set(files)].sort();
}

/**
 * Resolve the set of repo-relative POSIX paths a run should consider.
 * mode: 'auto' | 'staged' | 'working' | 'since' | 'all' | 'explicit'
 */
function changedFiles({ mode = 'auto', ref = null, paths = [], cwd = process.cwd(), root = null } = {}) {
  if (mode === 'explicit') {
    const base = root || cwd;
    return {
      mode,
      files: dedupe(paths.map((p) => path.relative(base, path.resolve(cwd, p)).split(path.sep).join('/'))),
    };
  }
  if (!isRepo(cwd)) {
    throw new GitError('not inside a git repository (use --all or pass explicit paths)');
  }
  if (mode === 'all') return { mode, files: dedupe(allFiles(cwd)) };
  if (mode === 'staged') return { mode, files: dedupe(stagedFiles(cwd)) };
  if (mode === 'working') return { mode, files: dedupe([...stagedFiles(cwd), ...unstagedFiles(cwd)]) };
  if (mode === 'since') return { mode, ref, files: dedupe(sinceFiles(ref, cwd)) };

  // auto: staged if a commit is being prepared, otherwise the working tree.
  const staged = stagedFiles(cwd);
  if (staged.length > 0) return { mode: 'staged', files: dedupe(staged) };
  return { mode: 'working', files: dedupe([...unstagedFiles(cwd)]) };
}

module.exports = { changedFiles, isRepo, repoRoot, GitError };
