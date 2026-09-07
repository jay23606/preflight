const useColor =
  process.env.NO_COLOR == null && process.env.TERM !== 'dumb' && (process.stdout.isTTY || process.env.FORCE_COLOR != null);

const ESC = String.fromCharCode(27) + String.fromCharCode(91); // ESC[
const paint = (code) => (text) => (useColor ? `${ESC}${code}m${text}${ESC}0m` : text);
const color = {
  dim: paint('2'),
  bold: paint('1'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  cyan: paint('36'),
};

const MARK = { pass: '+', fail: 'x', timeout: 'T', warn: '!' };

function seconds(ms) {
  if (ms < 950) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function wrap(text, width, indent) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current === '') current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.map((line, index) => (index === 0 ? line : indent + line));
}

function header(selection, planned, total) {
  const scope = selection.ref ? `${selection.mode} ${selection.ref}` : selection.mode;
  return `${color.bold('preflight')} ${color.dim('·')} ${plural(selection.files.length, 'file')} ${color.dim(
    `(${scope})`,
  )} ${color.dim('·')} ${planned}/${total} checks`;
}

function line(result) {
  const failed = result.status !== 'pass';
  const isWarn = failed && result.severity === 'warn';
  const symbol = isWarn ? color.yellow(MARK.warn) : failed ? color.red(MARK.fail) : color.green(MARK.pass);
  const name = failed ? (isWarn ? color.yellow(result.name) : color.red(result.name)) : result.name;
  const padded = name + ' '.repeat(Math.max(0, 24 - result.name.length));
  const fixed = result.status === 'pass' && result.fixApplied ? color.yellow(' fixed') : '';
  const timing = result.status === 'timeout' ? color.red(`timeout >${seconds(result.budgetMs)}`) : color.dim(seconds(result.durationMs));
  return `  ${symbol} ${padded} ${timing} ${color.dim(plural(result.files.length, 'file'))}${fixed}`;
}

function detail(result) {
  const out = [];
  const label = result.severity === 'warn' ? color.yellow(`${result.name} warned`) : color.red(`${result.name} failed`);
  out.push('');
  out.push(label);
  if (result.why) {
    const wrapped = wrap(result.why, 76, '       ');
    out.push(`  ${color.dim('why')}  ${wrapped.join('\n')}`);
  }
  out.push(`  ${color.dim('run')}  ${color.cyan(result.command)}`);
  if (result.status === 'timeout') {
    out.push(`  ${color.dim('---')}  killed after its ${seconds(result.budgetMs)} budget`);
  }
  const body = [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (body) {
    out.push(color.dim('  ---'));
    for (const bodyLine of body.split('\n')) out.push(`  ${bodyLine}`);
    if (result.capped) out.push(color.dim('  --- output truncated'));
  }
  return out.join('\n');
}

function summary(results, elapsedMs) {
  const failed = results.filter((r) => r.status !== 'pass' && r.severity === 'error');
  const warned = results.filter((r) => r.status !== 'pass' && r.severity === 'warn');
  const passed = results.filter((r) => r.status === 'pass');
  const parts = [];
  if (failed.length) parts.push(color.red(`${plural(failed.length, 'check')} failed`));
  if (warned.length) parts.push(color.yellow(`${warned.length} warned`));
  parts.push(`${passed.length} passed`);
  return `\n${parts.join(', ')}  ${color.dim(`(${seconds(elapsedMs)})`)}`;
}

function nothingToDo(selection) {
  if (selection.files.length === 0) {
    return `${color.bold('preflight')} ${color.dim('·')} no changed files ${color.dim(`(${selection.mode})`)}`;
  }
  return `${color.bold('preflight')} ${color.dim('·')} ${plural(selection.files.length, 'file')} changed, no checks matched`;
}

function listChecks(manifest) {
  const out = [`${color.bold('preflight')} ${color.dim('·')} ${manifest.path}`, ''];
  for (const check of manifest.checks) {
    out.push(`  ${color.bold(check.name)}  ${color.dim(check.always ? 'always' : check.when.join(', '))}`);
    if (check.why) out.push(`    ${color.dim(wrap(check.why, 72, '    ').join('\n'))}`);
    out.push(`    ${color.cyan(check.run)}  ${color.dim(`budget ${seconds(check.budgetMs)}`)}`);
    out.push('');
  }
  return out.join('\n');
}

function toJson(selection, results, elapsedMs) {
  return JSON.stringify(
    {
      ok: results.every((r) => r.status === 'pass' || r.severity === 'warn'),
      mode: selection.mode,
      ref: selection.ref ?? null,
      files: selection.files,
      durationMs: elapsedMs,
      checks: results.map((r) => ({
        name: r.name,
        status: r.status,
        severity: r.severity,
        why: r.why,
        command: r.command,
        files: r.files,
        exitCode: r.code,
        durationMs: r.durationMs,
        fixApplied: r.fixApplied === true,
        output: [r.stdout, r.stderr].filter(Boolean).join('\n'),
      })),
    },
    null,
    2,
  );
}

module.exports = { header, line, detail, summary, nothingToDo, listChecks, toJson, color, seconds };
