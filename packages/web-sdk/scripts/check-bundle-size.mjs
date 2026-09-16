/**
 * Bundle-size budget gate for the browser bundles. Fails the process
 * when a bundle is missing (a silent-pass on "nothing built" would
 * make the gate meaningless) or when its gzip size exceeds the
 * budget. The budget is a guard against accidental bloat (a stray
 * heavyweight dependency), not a forecast of the SDK's final size -
 * raising it is a deliberate, reviewable change to this file.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 30KB gzip for the IIFE bundle. Raised from the original 25KB when
 * the delivery-correctness work landed: persisting in tabs that do
 * not hold the sender role, gating the exit send on schema
 * registration, and propagating a consent withdrawal that lives on
 * the cookie rung. Those cost about 1KB and each of them closes a
 * path that silently lost data.
 */
const GZIP_BUDGET_BYTES = 30 * 1024;

/**
 * The IIFE (the unpkg/jsdelivr artifact) is the only browser bundle.
 * Bundlers get `dist/src` through the `exports` map with
 * `@keewano/core` as a real dependency, which kills the dual-package
 * hazard of an inlined core copy; no separate browser ESM artifact
 * is built or published.
 */
const BUNDLES = ['dist/browser/keewano.iife.js'];

let failed = false;
for (const relativePath of BUNDLES) {
  let bytes;
  try {
    bytes = readFileSync(resolve(packageRoot, relativePath));
  } catch {
    console.error(`bundle-size: ${relativePath} is missing; run the browser build first.`);
    failed = true;
    continue;
  }
  const gzipBytes = gzipSync(bytes).length;
  const withinBudget = gzipBytes <= GZIP_BUDGET_BYTES;
  console.log(
    `bundle-size: ${relativePath} - ${String(gzipBytes)} B gzip / budget ${String(GZIP_BUDGET_BYTES)} B ${withinBudget ? 'OK' : 'EXCEEDED'}`,
  );
  if (!withinBudget) failed = true;
}

process.exit(failed ? 1 : 0);
