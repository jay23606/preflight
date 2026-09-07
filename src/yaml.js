// A deliberately small YAML subset parser.
//
// preflight has zero dependencies so it can be run with `npx` in any repo
// without dragging a package tree into a pre-commit hook. The manifest schema
// is tiny, so this handles exactly what it needs: block mappings, block
// sequences, plain/quoted scalars, flow sequences, and `|` / `>` block
// scalars. Anything fancier is a parse error rather than a silent misread.

class YamlError extends Error {
  constructor(message, line) {
    super(line == null ? message : `${message} (line ${line + 1})`);
    this.name = 'YamlError';
    this.line = line;
  }
}

function stripComment(text) {
  let out = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') {
        out += ch + (text[i + 1] ?? '');
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      out += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) break;
    out += ch;
  }
  return out;
}

function parseScalar(raw, lineNo) {
  const text = raw.trim();
  if (text === '') return '';
  if (text === '~' || text === 'null') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return Number(text);
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new YamlError('unterminated double-quoted string', lineNo);
    return text
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) throw new YamlError('unterminated single-quoted string', lineNo);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new YamlError('unterminated flow sequence', lineNo);
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    return splitFlow(inner, lineNo).map((part) => parseScalar(part, lineNo));
  }
  if (text.startsWith('{')) throw new YamlError('flow mappings are not supported', lineNo);
  return text;
}

function splitFlow(text, lineNo) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"') {
        current += text[i + 1] ?? '';
        i++;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote) throw new YamlError('unterminated string in flow sequence', lineNo);
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

// Tokenize into { indent, content, lineNo }, dropping blank and comment-only lines.
function tokenize(source) {
  const lines = [];
  const raw = source.split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    if (/^\s*(#.*)?$/.test(raw[i])) continue;
    if (/^(---|\.\.\.)\s*$/.test(raw[i])) continue;
    if (/\t/.test(raw[i].match(/^\s*/)[0])) throw new YamlError('tabs are not valid YAML indentation', i);
    const indent = raw[i].match(/^ */)[0].length;
    lines.push({ indent, content: raw[i].slice(indent), lineNo: i, raw: raw[i] });
  }
  return { lines, raw };
}

function parse(source) {
  const { lines, raw } = tokenize(source);
  if (lines.length === 0) return {};
  const state = { i: 0 };
  const value = parseBlock(lines, state, lines[0].indent, raw);
  if (state.i < lines.length) throw new YamlError('unexpected indentation', lines[state.i].lineNo);
  return value;
}

function parseBlock(lines, state, indent, raw) {
  const first = lines[state.i];
  if (first.content.startsWith('- ') || first.content === '-') return parseSeq(lines, state, indent, raw);
  return parseMap(lines, state, indent, raw);
}

function parseSeq(lines, state, indent, raw) {
  const items = [];
  while (state.i < lines.length) {
    const line = lines[state.i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlError('unexpected indentation in sequence', line.lineNo);
    if (!(line.content.startsWith('- ') || line.content === '-')) break;
    const rest = line.content === '-' ? '' : line.content.slice(2);
    state.i++;
    if (rest.trim() === '') {
      items.push(parseNested(lines, state, indent, raw));
      continue;
    }
    // `- key: value` opens a mapping whose sibling keys align past the dash.
    if (isMapEntry(rest)) {
      const childIndent = indent + 2;
      const synthetic = [{ indent: childIndent, content: rest, lineNo: line.lineNo, raw: line.raw }];
      while (state.i < lines.length && lines[state.i].indent >= childIndent) {
        synthetic.push(lines[state.i]);
        state.i++;
      }
      const inner = { i: 0 };
      items.push(parseMap(synthetic, inner, childIndent, raw));
      continue;
    }
    items.push(parseScalar(stripComment(rest), line.lineNo));
  }
  return items;
}

function isMapEntry(text) {
  const cleaned = stripComment(text);
  return /^(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:#]+?)\s*:(\s|$)/.test(cleaned);
}

function splitMapEntry(text, lineNo) {
  const cleaned = stripComment(text);
  const match = cleaned.match(/^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^:#]+?))\s*:(?:\s+([\s\S]*))?$/);
  if (!match) throw new YamlError(`expected "key: value", got ${JSON.stringify(text.trim())}`, lineNo);
  const key = match[1] ?? match[2] ?? match[3];
  return { key: key.trim(), rest: (match[4] ?? '').trim() };
}

function parseMap(lines, state, indent, raw) {
  const map = {};
  while (state.i < lines.length) {
    const line = lines[state.i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlError('unexpected indentation in mapping', line.lineNo);
    if (line.content.startsWith('- ')) break;
    const { key, rest } = splitMapEntry(line.content, line.lineNo);
    if (Object.hasOwn(map, key)) throw new YamlError(`duplicate key ${JSON.stringify(key)}`, line.lineNo);
    state.i++;
    if (rest === '') {
      map[key] = parseNested(lines, state, indent, raw);
    } else if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      map[key] = parseBlockScalar(lines, state, indent, rest);
    } else {
      map[key] = parseScalar(rest, line.lineNo);
    }
  }
  return map;
}

function parseNested(lines, state, indent, raw) {
  if (state.i >= lines.length || lines[state.i].indent <= indent) return null;
  return parseBlock(lines, state, lines[state.i].indent, raw);
}

function parseBlockScalar(lines, state, indent, marker) {
  const fold = marker.startsWith('>');
  const chomp = marker.endsWith('-');
  const collected = [];
  let blockIndent = null;
  while (state.i < lines.length && lines[state.i].indent > indent) {
    const line = lines[state.i];
    if (blockIndent === null) blockIndent = line.indent;
    collected.push(line.raw.slice(blockIndent));
    state.i++;
  }
  let text = fold ? collected.join(' ') : collected.join('\n');
  if (!chomp && !fold) text += '\n';
  return text;
}

module.exports = { parse, YamlError };
