const fs = require('node:fs');
const path = require('node:path');
const { parse: parseYaml, YamlError } = require('./yaml');

const MANIFEST_NAMES = ['preflight.yaml', 'preflight.yml', '.preflight.yaml', '.preflight.yml', 'preflight.json'];

const DEFAULT_BUDGET_MS = 60_000;

class ManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestError';
  }
}

function findManifest(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    for (const name of MANIFEST_NAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Budgets are written the way people say them: `20s`, `2m`, `500ms`, or a
// bare number of seconds.
function parseBudget(value, checkName) {
  if (value == null) return DEFAULT_BUDGET_MS;
  if (typeof value === 'number') return Math.round(value * 1000);
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/);
  if (!match) throw new ManifestError(`check "${checkName}": budget ${JSON.stringify(value)} is not a duration like "20s"`);
  const amount = Number(match[1]);
  const unit = match[2] || 's';
  const factor = unit === 'ms' ? 1 : unit === 'm' ? 60_000 : 1000;
  return Math.round(amount * factor);
}

function asList(value, field, checkName) {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') throw new ManifestError(`check "${checkName}": ${field} must be a list of strings`);
    }
    return value;
  }
  throw new ManifestError(`check "${checkName}": ${field} must be a string or a list of strings`);
}

function normalizeCheck(raw, index) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManifestError(`checks[${index}] must be a mapping`);
  }
  const name = raw.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ManifestError(`checks[${index}] is missing a "name"`);
  }
  if (typeof raw.run !== 'string' || raw.run.trim() === '') {
    throw new ManifestError(`check "${name}" is missing a "run" command`);
  }
  const known = new Set(['name', 'when', 'not', 'run', 'fix', 'why', 'budget', 'each', 'always', 'severity', 'cwd']);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw new ManifestError(`check "${name}": unknown field "${key}"`);
  }
  const when = asList(raw.when, 'when', name);
  const not = asList(raw.not, 'not', name);
  const always = raw.always === true;
  if (when.length === 0 && !always) {
    throw new ManifestError(`check "${name}" needs "when" patterns, or "always: true" to run on every invocation`);
  }
  const severity = raw.severity ?? 'error';
  if (severity !== 'error' && severity !== 'warn') {
    throw new ManifestError(`check "${name}": severity must be "error" or "warn"`);
  }
  return {
    name,
    when,
    not,
    always,
    run: raw.run,
    fix: typeof raw.fix === 'string' && raw.fix.trim() !== '' ? raw.fix : null,
    why: typeof raw.why === 'string' ? raw.why.trim() : null,
    budgetMs: parseBudget(raw.budget, name),
    each: raw.each === true,
    severity,
    cwd: typeof raw.cwd === 'string' ? raw.cwd : null,
  };
}

const PRESETS_DIR = path.join(__dirname, '..', 'presets');

// `extends: [preflight:secrets, ./team-checks.yaml]`
function resolveExtend(reference, fromDir) {
  if (reference.startsWith('preflight:')) {
    const name = reference.slice('preflight:'.length);
    if (!/^[\w-]+$/.test(name)) throw new ManifestError(`invalid preset name ${JSON.stringify(reference)}`);
    const candidate = path.join(PRESETS_DIR, `${name}.yaml`);
    if (!fs.existsSync(candidate)) {
      const available = fs.existsSync(PRESETS_DIR)
        ? fs
            .readdirSync(PRESETS_DIR)
            .filter((entry) => entry.endsWith('.yaml'))
            .map((entry) => `preflight:${entry.replace(/\.yaml$/, '')}`)
        : [];
      throw new ManifestError(`unknown preset ${JSON.stringify(reference)}${available.length ? `; available: ${available.join(', ')}` : ''}`);
    }
    return candidate;
  }
  const resolved = path.resolve(fromDir, reference);
  if (!fs.existsSync(resolved)) throw new ManifestError(`extends: cannot find ${JSON.stringify(reference)} (looked at ${resolved})`);
  return resolved;
}

function normalize(doc, { baseDir = process.cwd() } = {}) {
  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ManifestError('manifest must be a mapping with a "checks" list');
  }
  const known = new Set(['version', 'checks', 'extends', 'disable']);
  for (const key of Object.keys(doc)) {
    if (!known.has(key)) throw new ManifestError(`unknown top-level field "${key}"`);
  }
  // A manifest that only pulls in presets is legitimate, and so is one whose
  // `checks:` key is present but still empty (which YAML reads as null).
  const inherits = doc.extends != null;
  if (doc.checks == null) {
    if (!inherits) throw new ManifestError('manifest must have a "checks" list, or an "extends" that supplies one');
    doc = { ...doc, checks: [] };
  } else if (!Array.isArray(doc.checks)) {
    throw new ManifestError('"checks" must be a list');
  }
  // Every check remembers where it was declared, so a preset's `{here}` points
  // at the preset's own directory rather than the consuming repository.
  const checks = doc.checks.map((raw, index) => ({ ...normalizeCheck(raw, index), baseDir }));
  const seen = new Set();
  for (const check of checks) {
    if (seen.has(check.name)) throw new ManifestError(`duplicate check name "${check.name}"`);
    seen.add(check.name);
  }
  return { checks, version: doc.version ?? 1 };
}

function readDoc(manifestPath) {
  const source = fs.readFileSync(manifestPath, 'utf8');
  try {
    return manifestPath.endsWith('.json') ? JSON.parse(source) : parseYaml(source);
  } catch (error) {
    if (error instanceof YamlError || error instanceof SyntaxError) {
      throw new ManifestError(`${path.basename(manifestPath)}: ${error.message}`);
    }
    throw error;
  }
}

function loadWithExtends(manifestPath, seenPaths) {
  const real = path.resolve(manifestPath);
  if (seenPaths.has(real)) throw new ManifestError(`extends: circular reference through ${path.basename(real)}`);
  seenPaths.add(real);

  const doc = readDoc(real);
  const dir = path.dirname(real);
  const inherited = [];
  const extendsList = doc.extends == null ? [] : Array.isArray(doc.extends) ? doc.extends : [doc.extends];
  for (const reference of extendsList) {
    if (typeof reference !== 'string') throw new ManifestError('extends: must be a string or a list of strings');
    inherited.push(...loadWithExtends(resolveExtend(reference, dir), seenPaths).checks);
  }

  const own = normalize(doc, { baseDir: dir });

  // A local check with the same name replaces the inherited one, in place.
  // That is how you keep a preset and retune one of its checks.
  const merged = [];
  const ownByName = new Map(own.checks.map((check) => [check.name, check]));
  const used = new Set();
  for (const check of inherited) {
    if (ownByName.has(check.name)) {
      merged.push(ownByName.get(check.name));
      used.add(check.name);
    } else {
      merged.push(check);
    }
  }
  for (const check of own.checks) if (!used.has(check.name)) merged.push(check);

  const disabled = new Set(
    doc.disable == null ? [] : Array.isArray(doc.disable) ? doc.disable : [doc.disable],
  );
  for (const name of disabled) {
    if (!merged.some((check) => check.name === name)) {
      throw new ManifestError(`disable: no check named ${JSON.stringify(name)} to disable`);
    }
  }

  seenPaths.delete(real);
  return { checks: merged.filter((check) => !disabled.has(check.name)), version: own.version };
}

function load(manifestPath) {
  const manifest = loadWithExtends(manifestPath, new Set());
  manifest.path = path.resolve(manifestPath);
  manifest.root = path.dirname(manifest.path);
  return manifest;
}

module.exports = { load, normalize, findManifest, ManifestError, MANIFEST_NAMES, DEFAULT_BUDGET_MS, PRESETS_DIR };
