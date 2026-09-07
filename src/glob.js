// Glob matching for `when:` patterns. Paths are always POSIX-style and
// repo-relative by the time they get here, so this never has to think about
// backslashes or drive letters.
//
// Supported: `*` (no slash), `**` (any depth), `?`, `{a,b}`, `[abc]`,
// and a leading `!` for negation.

function expandBraces(pattern) {
  const open = pattern.indexOf('{');
  if (open === -1) return [pattern];
  let depth = 0;
  for (let i = open; i < pattern.length; i++) {
    if (pattern[i] === '{') depth++;
    else if (pattern[i] === '}') {
      depth--;
      if (depth === 0) {
        const head = pattern.slice(0, open);
        const tail = pattern.slice(i + 1);
        const options = splitTop(pattern.slice(open + 1, i));
        return options.flatMap((option) => expandBraces(head + option + tail));
      }
    }
  }
  return [pattern];
}

function splitTop(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function toRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      const isDouble = pattern[i + 1] === '*';
      if (isDouble) {
        i++;
        // `a/**/b` should also match `a/b`, so swallow the trailing slash.
        if (pattern[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    if (ch === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close !== -1) {
        let body = pattern.slice(i + 1, close);
        if (body.startsWith('!')) body = '^' + body.slice(1);
        out += `[${body}]`;
        i = close;
        continue;
      }
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const cache = new Map();

function compile(pattern) {
  let entry = cache.get(pattern);
  if (entry) return entry;
  const negated = pattern.startsWith('!');
  const body = negated ? pattern.slice(1) : pattern;
  entry = { negated, regexes: expandBraces(body).map(toRegex) };
  cache.set(pattern, entry);
  return entry;
}

function matchOne(pattern, filePath) {
  const { regexes } = compile(pattern);
  return regexes.some((regex) => regex.test(filePath));
}

// A file matches when at least one positive pattern hits and no negative
// pattern does. A list of only negations is treated as "everything except".
function matches(patterns, filePath) {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  let hit = list.every((pattern) => compile(pattern).negated);
  for (const pattern of list) {
    const { negated } = compile(pattern);
    if (negated) {
      if (matchOne(pattern, filePath)) return false;
    } else if (matchOne(pattern, filePath)) {
      hit = true;
    }
  }
  return hit;
}

function selectFiles(patterns, files) {
  return files.filter((file) => matches(patterns, file));
}

module.exports = { matches, selectFiles };
