/**
 * Point this package's `@keewano/*` ranges at the version being packed.
 *
 * The manifests carry `*` because the workspace version is a placeholder
 * that no release ever ships: a range naming it would be an exact pin on
 * something absent from the registry, and every install would fail. `*`
 * keeps the workspace resolvable, and it is what reaches the registry,
 * where it means a published sibling accepts ANY core - including one
 * released after it, across any change to the wire format. Two packages
 * of ours in one tree can then resolve to two different cores, and the
 * core holds the runtime singleton.
 *
 * `npm pack` runs `prepack` in the package directory after the release
 * version has been stamped, which is the one moment both facts are
 * known, so the rewrite happens here and `postpack` puts the manifest
 * back. A pack that still carries the placeholder version is a local
 * one - the environment harnesses do this - and is left alone.
 *
 *   node syncSiblingRanges.cjs --apply | --restore
 */
const fs = require('fs');
const path = require('path');

const PLACEHOLDER = '0.0.0';
const BACKUP = 'package.json.prepack-backup';

function main() {
  const mode = process.argv[2];
  const manifest = path.resolve('package.json');
  const backup = path.resolve(BACKUP);

  if (mode === '--restore') {
    if (fs.existsSync(backup)) {
      fs.copyFileSync(backup, manifest);
      fs.unlinkSync(backup);
      console.log('syncSiblingRanges: manifest restored');
    }
    return;
  }
  if (mode !== '--apply') {
    throw new Error('syncSiblingRanges: pass --apply or --restore');
  }

  /**
   * Drop any backup before deciding anything, so one exists only if THIS
   * run wrote it. A pack killed between the rewrite and `postpack`
   * leaves one behind; without this, the next pack that changes nothing
   * still runs `--restore`, and the restore puts that stale manifest
   * back over whatever the file says now.
   */
  if (fs.existsSync(backup)) {
    fs.unlinkSync(backup);
    console.log('syncSiblingRanges: discarded a backup left by an earlier pack');
  }

  const raw = fs.readFileSync(manifest, 'utf8');
  const pkg = JSON.parse(raw);
  if (pkg.version === PLACEHOLDER) {
    console.log(`syncSiblingRanges: ${pkg.name} still at the placeholder version; ranges left as they are`);
    return;
  }

  const wanted = `^${pkg.version}`;
  let changed = false;
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies']) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (!dep.startsWith('@keewano/')) continue;
      if (pkg[field][dep] === wanted) continue;
      pkg[field][dep] = wanted;
      changed = true;
      console.log(`syncSiblingRanges: ${pkg.name} ${field}.${dep} -> ${wanted}`);
    }
  }
  if (!changed) return;
  fs.writeFileSync(backup, raw);
  fs.writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);
}

main();
