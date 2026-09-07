const path = require('node:path');
const { load, findManifest, ManifestError } = require('./manifest');
const { init } = require('./init');
const { changedFiles, GitError } = require('./git');
const { planChecks, runAll } = require('./runner');
const report = require('./report');

const VERSION = require('../package.json').version;

const HELP = `preflight ${VERSION} — run the narrow checks that a diff actually implicates.

Usage
  preflight [options] [paths...]
  preflight init            write a starter preflight.yaml here

Scope (default: staged files if any, else the working tree)
  --staged            files staged for commit
  --working           staged + unstaged + untracked
  --since <ref>       everything this branch changed vs <ref> (e.g. origin/main)
  --all               every tracked file
  paths...            check these paths explicitly

Options
  -o, --only <names>  run only these checks (comma-separated, repeatable)
  -c, --config <path> manifest to use (default: nearest preflight.yaml)
  -j, --json          machine-readable results on stdout
  -l, --list          list the checks in the manifest and exit
      --concurrency N run N checks at once (default 4)
  -q, --quiet         print only failures
      --fix           run a failing check's fix command, then re-check
      --no-color      disable ANSI color
      --force         with 'init', overwrite an existing manifest
  -h, --help          this
  -v, --version       print the version

Exit codes
  0  every implicated check passed (warnings do not fail)
  1  at least one check failed
  2  bad usage, bad manifest, or no git repository
`;

function parseArgs(argv) {
  const options = { mode: 'auto', ref: null, paths: [], only: null, config: null, json: false, list: false, concurrency: 4, quiet: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value == null) throw new UsageError(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case '--staged': options.mode = 'staged'; break;
      case '--working': options.mode = 'working'; break;
      case '--all': options.mode = 'all'; break;
      case '--since': options.mode = 'since'; options.ref = next(); break;
      case '-o': case '--only':
        options.only = [...(options.only ?? []), ...next().split(',').map((s) => s.trim()).filter(Boolean)];
        break;
      case '-c': case '--config': options.config = next(); break;
      case '-j': case '--json': options.json = true; break;
      case '-l': case '--list': options.list = true; break;
      case '-q': case '--quiet': options.quiet = true; break;
      case '--concurrency': options.concurrency = Math.max(1, Number(next()) || 1); break;
      case '--no-color': process.env.NO_COLOR = '1'; break;
      case '--force': options.force = true; break;
      case '--fix': options.fix = true; break;
      case '-h': case '--help': options.help = true; break;
      case '-v': case '--version': options.version = true; break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`unknown option ${arg}`);
        rest.push(arg);
    }
  }
  if (rest.length > 0) {
    options.paths = rest;
    if (rest[0] === 'init') {
      options.init = true;
      options.paths = [];
    } else if (options.mode === 'auto') {
      options.mode = 'explicit';
    }
  }
  return options;
}

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

async function main(argv, io = console) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.error(`preflight: ${error.message}`);
    io.error('try `preflight --help`');
    return 2;
  }
  if (options.help) {
    io.log(HELP);
    return 0;
  }
  if (options.version) {
    io.log(VERSION);
    return 0;
  }

  if (options.init) {
    const result = init(process.cwd(), { force: options.force });
    if (!result.created) {
      io.error('preflight: ' + result.reason);
      return 2;
    }
    io.log('Wrote ' + result.path + (result.stacks.length ? ' (detected ' + result.stacks.join(', ') + ')' : ''));
    io.log('Edit it, then run: preflight');
    return 0;
  }

  const manifestPath = options.config ? path.resolve(options.config) : findManifest(process.cwd());
  if (!manifestPath) {
    io.error('preflight: no preflight.yaml found in this directory or any parent.');
    io.error('Create one — see https://github.com/jay23606/preflight#the-manifest');
    return 2;
  }

  let manifest;
  try {
    manifest = load(manifestPath);
  } catch (error) {
    if (error instanceof ManifestError) {
      io.error(`preflight: ${error.message}`);
      return 2;
    }
    throw error;
  }

  if (options.list) {
    io.log(report.listChecks(manifest));
    return 0;
  }

  if (options.only) {
    const known = new Set(manifest.checks.map((c) => c.name));
    const unknown = options.only.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      io.error(`preflight: no such check: ${unknown.join(', ')}`);
      return 2;
    }
  }

  let selection;
  try {
    selection = changedFiles({ mode: options.mode, ref: options.ref, paths: options.paths, cwd: manifest.root, root: manifest.root });
  } catch (error) {
    if (error instanceof GitError) {
      io.error(`preflight: ${error.message}`);
      return 2;
    }
    throw error;
  }

  const plan = planChecks(manifest.checks, selection.files, { only: options.only });

  if (plan.length === 0) {
    if (options.json) io.log(report.toJson(selection, [], 0));
    else if (!options.quiet) io.log(report.nothingToDo(selection));
    return 0;
  }

  const started = Date.now();
  if (!options.json && !options.quiet) {
    io.log(report.header(selection, plan.length, manifest.checks.length));
    io.log('');
  }

  const results = await runAll(plan, {
    root: manifest.root,
    concurrency: options.concurrency,
    allFiles: selection.files,
    fix: options.fix === true,
    onResult: (result) => {
      if (options.json) return;
      if (options.quiet && result.status === 'pass') return;
      io.log(report.line(result));
    },
  });
  const elapsed = Date.now() - started;

  if (options.json) {
    io.log(report.toJson(selection, results, elapsed));
  } else {
    for (const result of results) {
      if (result.status !== 'pass') io.log(report.detail(result));
    }
    if (!options.quiet || results.some((r) => r.status !== 'pass')) io.log(report.summary(results, elapsed));
  }

  return results.some((r) => r.status !== 'pass' && r.severity === 'error') ? 1 : 0;
}

module.exports = { main, parseArgs, HELP, VERSION };
