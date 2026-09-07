#!/usr/bin/env node
const { main } = require('../src/cli');

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`preflight: ${error && error.stack ? error.stack : error}`);
    process.exitCode = 2;
  },
);
