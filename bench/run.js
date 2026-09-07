#!/usr/bin/env node
// Measures what preflight actually buys, against a baseline of the toolchain
// the repo already runs.
//
// For each example: build a clean git repo, run the baseline command and
// preflight on the clean state, apply the seeded-defect scenario, then run
// both again. A defect "escapes" the baseline when the baseline still exits 0
// with the defect present.
//
// What this measures: detection, and wall-clock cost.
// What it does not measure: whether a human or an AI reviewer would have
// caught the same defect by reading the diff. That needs a different study
// and is not claimed here.

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXAMPLES = path.join(__dirname, '..', 'examples');
const CLI = path.join(__dirname, '..', 'bin', 'preflight.js');
const REPEATS = Number(process.env.BENCH_REPEATS || 3);

function copyTree(from, to, { skip = [] } = {}) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target, { skip });
    else fs.copyFileSync(source, target);
  }
}

function sh(command, cwd) {
  const started = Date.now();
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { code: result.status, ms: Date.now() - started, output: `${result.stdout || ''}${result.stderr || ''}` };
}

function preflight(cwd, args = []) {
  return sh(`"${process.execPath}" "${CLI}" ${args.join(' ')}`, cwd);
}

function available(spec) {
  if (!spec) return true;
  const command = [spec.command, ...(spec.args || ['--version'])].join(' ');
  return spawnSync(command, { stdio: 'ignore', shell: true }).status === 0;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function benchExample(name) {
  const source = path.join(EXAMPLES, name);
  const configPath = path.join(source, 'bench.json');
  if (!fs.existsSync(configPath)) return null;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const requires = fs.existsSync(path.join(source, 'requires.json'))
    ? JSON.parse(fs.readFileSync(path.join(source, 'requires.json'), 'utf8'))
    : null;
  if (!available(requires)) return { name, skipped: requires.reason };

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `preflight-bench-${name}-`));
  try {
    copyTree(source, temp, { skip: ['scenario', 'requires.json', 'bench.json', 'README.md'] });
    execFileSync('git', ['init', '-q'], { cwd: temp, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'bench@example.com'], { cwd: temp, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'bench'], { cwd: temp, stdio: 'ignore' });
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: temp, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: temp, stdio: 'ignore' });
    execFileSync('git', ['commit', '-qm', 'clean'], { cwd: temp, stdio: 'ignore' });

    const baselineClean = config.baseline ? sh(config.baseline, temp) : null;

    copyTree(path.join(source, 'scenario'), temp);
    execFileSync('git', ['add', '-A'], { cwd: temp, stdio: 'ignore' });

    const baselineDirty = config.baseline ? sh(config.baseline, temp) : null;

    const scopedTimes = [];
    const fullTimes = [];
    let scoped = null;
    for (let i = 0; i < REPEATS; i++) {
      scoped = preflight(temp, []);
      scopedTimes.push(scoped.ms);
      fullTimes.push(preflight(temp, ['--all']).ms);
    }

    const planned = (scoped.output.match(/·\s(\d+)\/(\d+)\schecks/) || []).slice(1).map(Number);
    const failedNames = new Set(
      [...scoped.output.matchAll(/^\s*[x!]\s+(\S+)/gm)].map((match) => match[1]),
    );

    const defects = config.defects.map((defect) => ({
      ...defect,
      caughtByPreflight: failedNames.has(defect.check),
      caughtByBaseline: baselineDirty ? baselineDirty.code !== 0 : null,
    }));

    return {
      name,
      baseline: config.baseline || null,
      baselineCleanCode: baselineClean ? baselineClean.code : null,
      baselineDirtyCode: baselineDirty ? baselineDirty.code : null,
      baselineMs: baselineDirty ? baselineDirty.ms : null,
      defects,
      scopedMs: median(scopedTimes),
      fullMs: median(fullTimes),
      checksRun: planned[0] ?? null,
      checksTotal: planned[1] ?? null,
      preflightExit: scoped.code,
    };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const names = fs
  .readdirSync(EXAMPLES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(EXAMPLES, entry.name, 'bench.json')))
  .map((entry) => entry.name);

const results = names.map(benchExample).filter(Boolean);
const measured = results.filter((r) => !r.skipped);
const allDefects = measured.flatMap((r) => r.defects);

const lines = [];
lines.push('# preflight benchmark');
lines.push('');
lines.push(`Node ${process.version} · ${os.platform()} ${os.arch()} · ${REPEATS} repeats, median reported`);
lines.push('');
lines.push('## Seeded defects');
lines.push('');
lines.push('| # | defect | surfaces as | baseline | preflight |');
lines.push('|---|--------|-------------|----------|-----------|');
allDefects.forEach((defect, index) => {
  const baseline = defect.caughtByBaseline === null ? '—' : defect.caughtByBaseline ? 'caught' : '**escapes**';
  lines.push(
    `| ${index + 1} | ${defect.title} | ${defect.surfaces} | ${baseline} | ${defect.caughtByPreflight ? '**caught**' : 'missed'} |`,
  );
});
lines.push('');

// "escapes the baseline" only means something if the baseline passes when the
// code is clean. Say so loudly rather than quietly reporting a nicer number.
const brokenBaselines = measured.filter((r) => r.baseline && r.baselineCleanCode !== 0);
if (brokenBaselines.length > 0) {
  lines.push(
    `> **Warning:** the baseline command already fails on the clean tree for ${brokenBaselines
      .map((r) => r.name)
      .join(', ')}, so its column proves nothing there.`,
  );
  lines.push('');
  process.exitCode = 1;
}

const caught = allDefects.filter((d) => d.caughtByPreflight).length;
const baselineCaught = allDefects.filter((d) => d.caughtByBaseline === true).length;
const comparable = allDefects.filter((d) => d.caughtByBaseline !== null).length;
lines.push(`**${caught}/${allDefects.length}** seeded defects caught by preflight.`);
if (comparable > 0) {
  lines.push('');
  lines.push(
    `**${baselineCaught}/${comparable}** caught by the baseline toolchain (compile + vet + import), which exits 0 on the rest.`,
  );
}
lines.push('');
lines.push('## Cost');
lines.push('');
lines.push('| example | baseline | preflight (scoped) | preflight (--all) | checks run |');
lines.push('|---------|----------|--------------------|-------------------|------------|');
for (const result of measured) {
  lines.push(
    `| ${result.name} | ${result.baselineMs == null ? '—' : `${result.baselineMs} ms`} | ${result.scopedMs} ms | ${result.fullMs} ms | ${result.checksRun}/${result.checksTotal} |`,
  );
}
for (const result of results.filter((r) => r.skipped)) {
  lines.push(`| ${result.name} | _skipped: ${result.skipped}_ | | | |`);
}
lines.push('');
lines.push('## What this does not measure');
lines.push('');
lines.push('- Whether a reviewer, human or AI, would have caught the same defect by reading the diff.');
lines.push('- False positives on real repositories; every check here is tuned for its example.');
lines.push('- Anything about defect *frequency*. These are seeded, not sampled from history.');
lines.push(
  '- Scoping headroom. Each seeded diff happens to implicate every check in its example, so scoped and `--all` times are close here. Scoping is what keeps the cost flat once a repo has a check the diff does not implicate — a test suite, an integration probe — and that saving is not visible at this size.',
);
lines.push('');

const report = lines.join('\n');
console.log(report);

const outPath = process.env.BENCH_OUT;
if (outPath) fs.writeFileSync(outPath, report + '\n', 'utf8');

if (measured.length > 0 && caught < allDefects.length) process.exitCode = 1;
