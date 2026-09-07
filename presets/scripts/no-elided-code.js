#!/usr/bin/env node
// Catches prose-in-place-of-code: a comment that says the rest of the file is
// still there, in a file where the rest of the file is now gone.
//
// The distinguishing feature is a comment that REFERS to code rather than
// explaining it — "unchanged", "as before", "rest of", "existing" — usually
// next to an ellipsis. Patterns that could plausibly appear in ordinary prose
// are anchored to the end of the comment, so "// this function unchanged the
// world" is left alone while "// implementation unchanged" is not.
const fs = require('node:fs');
const path = require('node:path');

const COMMENT_PREFIX = /^\s*(?:\/\/|#|--|\/\*|\*|<!--|;|%)?\s*/;

const PATTERNS = [
  /\.\.\.\s*\(?\s*(rest|remainder|remaining|the rest)\b/i,
  /\b(rest|remainder) of (the )?(code|file|function|method|class|implementation|logic|body)\b/i,
  /\b(code|implementation|logic|function|method|body|section|block)s?\s+(here|omitted|unchanged|elided|truncated|as before|remains? the same|stays? the same)\s*\.{0,3}\s*(\*\/|-->)?\s*$/i,
  /\b(unchanged|same as (above|before)|as (above|before))\s*\.{0,3}\s*(\*\/|-->)?\s*$/i,
  /\b(existing|previous|original) (code|implementation|content|logic)\b/i,
  /^\s*(\/\/|#|--|\*)?\s*\.{3,}\s*$/,
  /\byour (code|implementation) here\b/i,
  /<\s*(insert|add|your)\b[^>]*>/i,
];

const root = process.env.PREFLIGHT_ROOT || process.cwd();
const hits = [];

for (const relative of process.argv.slice(2)) {
  const full = path.join(root, relative);
  let content;
  try {
    if (!fs.statSync(full).isFile()) continue;
    content = fs.readFileSync(full, 'utf8');
  } catch {
    continue; // deleted in this diff
  }
  if (content.indexOf(String.fromCharCode(0)) !== -1) continue; // binary

  content.split(/\r?\n/).forEach((line, index) => {
    if (/preflight[- ]?ignore/i.test(line)) return;
    const trimmed = line.trim();
    if (trimmed === '') return;
    // Only comments and bare ellipses count. The same words inside a string
    // literal are somebody's error message, not an elision.
    const isComment = /^\s*(\/\/|#|--|\/\*|\*|<!--|;|%)/.test(line) || /^\s*\.{3,}\s*$/.test(line);
    if (!isComment) return;
    const body = line.replace(COMMENT_PREFIX, '');
    for (const pattern of PATTERNS) {
      if (pattern.test(body)) {
        hits.push(`${relative}:${index + 1}  ${trimmed.slice(0, 80)}`);
        return;
      }
    }
  });
}

if (hits.length > 0) {
  console.error('code appears to have been replaced by a description of itself:');
  console.error(hits.join('\n'));
  console.error('');
  console.error('Write the real code, or restore what was there. If the comment is genuinely');
  console.error('describing something else, add a `preflight-ignore` comment on the line.');
  process.exit(1);
}
