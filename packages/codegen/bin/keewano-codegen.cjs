#!/usr/bin/env node
/**
 * Shim that boots the compiled CLI. Kept as `.cjs` so npm's bin
 * resolution works on hosts that have not set `"type": "module"` on
 * their own package.json. The actual CLI logic lives in TypeScript
 * under `src/cli.ts` and is compiled to `dist/src/cli.js`.
 *
 * The shim MUST propagate `run()`'s returned exit code to the OS, or
 * CI scripts gating on the documented exit-code contract would see
 * every invocation as success.
 */
'use strict';

const { run } = require('../dist/src/cli.js');

run(process.argv.slice(2)).then(
  (code) => {
    process.exit(code);
  },
  (err) => {
    process.stderr.write(`keewano-codegen: ${err?.stack ?? String(err)}\n`);
    process.exit(3);
  },
);
