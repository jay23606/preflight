#!/usr/bin/env node
// Designer files are machine-generated per checkout. Committing one turns
// every parallel edit of the same page into a conflict.
const files = process.argv.slice(2);
if (files.length > 0) {
  for (const file of files) console.error(`${file}  is a generated designer file`);
  console.error('');
  console.error('Add *.designer.cs to .gitignore and `git rm --cached` these.');
  process.exit(1);
}
