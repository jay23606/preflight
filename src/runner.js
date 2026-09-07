const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { selectFiles } = require('./glob');

// Argument lists get long fast on a big diff, and cmd.exe caps the command
// line at ~8k. Anything past this many files is passed only via the
// PREFLIGHT_FILES_FILE env var, and {files} expands to nothing.
const MAX_INLINE_FILES = 200;

function quote(value) {
  if (value === '') return '""';
  if (!/[\s"'$`\\&|<>^();]/.test(value)) return value;
  return `"${value.replace(/(["\\])/g, '\\$1')}"`;
}

function substitute(command, files, baseDir = null) {
  const inline = files.length <= MAX_INLINE_FILES ? files.map(quote).join(' ') : '';
  return (
    command
      .replace(/\{files\}/g, inline)
      .replace(/\{file\}/g, files.length > 0 ? quote(files[0]) : '')
      // {here} is the directory of the file that DECLARED the check, so a
      // preset can invoke its own scripts from inside someone else's repo.
      // Forward slashes so the same command works in cmd.exe and in sh.
      .replace(/\{here\}/g, baseDir ? quote(baseDir.split(path.sep).join('/')) : '.')
  );
}

// Which checks fire for this file set, and with which files.
function planChecks(checks, files, { only = null } = {}) {
  const plan = [];
  for (const check of checks) {
    if (only && !only.includes(check.name)) continue;
    let matched = check.when.length > 0 ? selectFiles(check.when, files) : [];
    if (check.not.length > 0) {
      const excluded = new Set(selectFiles(check.not, matched));
      matched = matched.filter((file) => !excluded.has(file));
    }
    if (matched.length === 0 && !check.always) continue;
    plan.push({ check, files: matched });
  }
  return plan;
}

// Checks run through a shell, so the process we spawn is the shell and the
// real work is its child. Node's own `timeout` only kills the shell, which
// leaves the actual command running past its budget — so kill the whole tree.
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

function runCommand(command, { cwd, budgetMs, files, env }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, {
      cwd,
      shell: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // A process group on POSIX so one kill takes the shell and its children.
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let capped = false;
    const LIMIT = 256 * 1024;
    const append = (target, chunk) => {
      const text = chunk.toString();
      if (target.length + text.length > LIMIT) {
        capped = true;
        return target + text.slice(0, Math.max(0, LIMIT - target.length));
      }
      return target + text;
    };
    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    let timedOut = false;
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(budgetTimer);
      clearTimeout(graceTimer);
      resolve({ code, stdout, stderr, durationMs: Date.now() - started, timedOut, capped, files });
    };

    let graceTimer = null;
    const budgetTimer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      // A grandchild can hold the pipes open after the shell dies; don't wait
      // on `close` forever just to report a timeout we already know about.
      graceTimer = setTimeout(() => finish(124), 2000);
      graceTimer.unref?.();
    }, budgetMs);

    child.on('error', (error) => {
      stderr += error.message;
      finish(127);
    });
    child.on('close', (code) => {
      finish(code == null ? (timedOut ? 124 : 1) : code);
    });
  });
}

async function runCheck(entry, { root, tmpDir, allFiles = [], fix = false }) {
  const { check } = entry;
  const applyFix = fix && Boolean(check.fix);
  const cwd = check.cwd ? path.resolve(root, check.cwd) : root;
  const listPath = path.join(tmpDir, `${check.name.replace(/[^\w.-]/g, '_')}.files.txt`);
  fs.writeFileSync(listPath, entry.files.join('\n') + (entry.files.length ? '\n' : ''), 'utf8');
  const baseEnv = {
    ...process.env,
    PREFLIGHT: '1',
    PREFLIGHT_CHECK: check.name,
    PREFLIGHT_ROOT: root,
    PREFLIGHT_FILES: entry.files.join('\n'),
    PREFLIGHT_FILES_FILE: listPath,
    // The whole changed set, for checks whose invariant is about a file NOT
    // being touched (spec drift, generated code, paired migrations).
    PREFLIGHT_CHANGED_FILES: allFiles.join('\n'),
  };

  const batches = check.each ? entry.files.map((file) => [file]) : [entry.files];
  const results = [];
  for (const batch of batches) {
    const command = substitute(check.run, batch, check.baseDir);
    // eslint-disable-next-line no-await-in-loop -- `each` batches are ordered on purpose
    const result = await runCommand(command, {
      cwd,
      budgetMs: check.budgetMs,
      files: batch,
      env: check.each ? { ...baseEnv, PREFLIGHT_FILES: batch.join('\n') } : baseEnv,
    });
    results.push({ ...result, command });
    if (result.code !== 0) break;
  }

  // A check that failed and knows how to repair itself: run the fix once,
  // then re-run the check. The re-run is what decides pass or fail — a fix
  // that did not actually fix anything must not turn the run green.
  let fixApplied = false;
  if (applyFix && results.some((result) => result.code !== 0)) {
    const fixCommand = substitute(check.fix, entry.files, check.baseDir);
    const fixResult = await runCommand(fixCommand, { cwd, budgetMs: check.budgetMs, files: entry.files, env: baseEnv });
    fixApplied = fixResult.code === 0;
    if (fixApplied) {
      results.length = 0;
      for (const batch of batches) {
        const command = substitute(check.run, batch, check.baseDir);
        // eslint-disable-next-line no-await-in-loop -- same ordering rule as above
        const result = await runCommand(command, {
          cwd,
          budgetMs: check.budgetMs,
          files: batch,
          env: check.each ? { ...baseEnv, PREFLIGHT_FILES: batch.join('\n') } : baseEnv,
        });
        results.push({ ...result, command });
        if (result.code !== 0) break;
      }
    } else {
      results.push({ ...fixResult, command: fixCommand });
    }
  }

  const failed = results.find((result) => result.code !== 0);
  const durationMs = results.reduce((sum, result) => sum + result.durationMs, 0);
  const chosen = failed ?? results[results.length - 1];
  return {
    name: check.name,
    severity: check.severity,
    why: check.why,
    files: entry.files,
    command: chosen.command,
    status: failed ? (failed.timedOut ? 'timeout' : 'fail') : 'pass',
    fixApplied,
    code: chosen.code,
    durationMs,
    budgetMs: check.budgetMs,
    stdout: chosen.stdout.trimEnd(),
    stderr: chosen.stderr.trimEnd(),
    capped: chosen.capped,
  };
}

async function runAll(plan, { root, concurrency = 4, onResult = null, allFiles = [], fix = false } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
  const results = new Array(plan.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, plan.length || 1) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= plan.length) return;
      const result = await runCheck(plan[index], { root, tmpDir, allFiles, fix });
      results[index] = result;
      if (onResult) onResult(result);
    }
  });
  try {
    await Promise.all(workers);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return results;
}

module.exports = { planChecks, runAll, runCheck, substitute, MAX_INLINE_FILES };
