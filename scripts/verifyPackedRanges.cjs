/**
 * Every packed tarball names its siblings with a range a consumer can
 * resolve. Read out of the artifact, not inferred from the mechanism.
 *
 * `prepack` rewrites the `@keewano/*` ranges to `^<version>` at pack time
 * (scripts/syncSiblingRanges.cjs). Three things have to hold for that to
 * land, and all three live outside this repository: `npm pack` must not
 * run with `--ignore-scripts`, the release version must be stamped into
 * every package before the pack, and `npm pack -w` must run lifecycle
 * scripts in the workspace directory. Miss any one and the rewrite is
 * skipped without a failure - the placeholder branch logs "ranges left as
 * they are", which reads like a deliberate success - and what publishes
 * is `"@keewano/core": "*"`. Two packages of ours in one consumer tree
 * then resolve to two cores, and the core holds the runtime singleton.
 *
 * So the gate is the tarball itself: the manifest is extracted from each
 * `*.tgz` the build job produced and checked for the placeholder version
 * and for any `*` on a sibling. That catches all three preconditions at
 * once, `--ignore-scripts` included, because it inspects what ships.
 *
 * Runs from the directory holding the tarballs: the repository root in
 * CI, where sdk:build leaves them.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const { readdirSync } = require('node:fs');

const PLACEHOLDER = '0.0.0';
const SIBLING_SCOPE = '@keewano/';
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'devDependencies'];

/** What is wrong with one packed manifest; empty when nothing is. */
function problemsIn(pkg) {
  const problems = [];
  if (pkg.version === PLACEHOLDER) {
    problems.push(`version is still the ${PLACEHOLDER} placeholder`);
  }
  for (const field of DEPENDENCY_FIELDS) {
    for (const [dep, range] of Object.entries(pkg[field] ?? {})) {
      if (dep.startsWith(SIBLING_SCOPE) && range === '*') {
        problems.push(`${field}.${dep} is "*"`);
      }
    }
  }
  return problems;
}

/** The manifest inside a tarball, read without unpacking it. */
function packedManifest(tarball) {
  const raw = execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], {
    encoding: 'utf8',
  });
  return JSON.parse(raw);
}

const tarballs = readdirSync('.').filter((name) => name.endsWith('.tgz'));
if (tarballs.length === 0) {
  process.stderr.write('verifyPackedRanges: no *.tgz found; the build job did not pack\n');
  process.exit(1);
}

let failed = false;
for (const tarball of tarballs) {
  const pkg = packedManifest(tarball);
  const problems = problemsIn(pkg);
  if (problems.length === 0) {
    process.stdout.write(`verifyPackedRanges: ${pkg.name}@${pkg.version} OK\n`);
    continue;
  }
  failed = true;
  for (const problem of problems) {
    process.stderr.write(`verifyPackedRanges: ${tarball}: ${problem}\n`);
  }
}

if (failed) {
  process.stderr.write('verifyPackedRanges: the prepack range rewrite did not take effect\n');
  process.exit(1);
}
