/**
 * Naming conventions for the per-operation scratch siblings that
 * `StorageAdapter` implementations stage next to a destination during
 * `writeFile` (tmp + backup) and `deleteFile` (trash). The infix
 * markers are shared so callers and `listFiles` filtering use one
 * source of truth.
 *
 * Each marker is followed by `<opId>` (produced by `generateOpId`) so
 * concurrent operations on the same destination never collide and a
 * crashed prior run's stale sibling cannot be confused with the
 * current operation's.
 *
 * @example
 * ```ts
 * const tmpPath = `${fullPath}.${SCRATCH_TMP_INFIX}.${opId}`;
 * const backupPath = `${fullPath}.${SCRATCH_BAK_INFIX}.${opId}`;
 * const trashPath = `${fullPath}.${SCRATCH_DEL_INFIX}.${opId}`;
 * ```
 */

/**
 * Matches any basename that carries one of the scratch-sibling infix
 * markers above followed by an opId payload. Used by `listFiles` to
 * filter adapter-owned scratch state out of the public listing so a
 * crash or in-flight mutation cannot leak internal bookkeeping to
 * callers.
 */
const SCRATCH_SIBLING_PATTERN = /\.__(?:kwtmp|kwbak|kwdel)__\.[^/]+$/;

const SCRATCH_TMP_INFIX = '__kwtmp__';
const SCRATCH_BAK_INFIX = '__kwbak__';
const SCRATCH_DEL_INFIX = '__kwdel__';

/**
 * Return `true` when `basename` matches the shape produced by an
 * adapter's per-operation scratch suffix. Callers (e.g. `listFiles`)
 * skip these entries so internal scratch state never surfaces in the
 * public listing.
 */
function isScratchSibling(basename: string): boolean {
  return SCRATCH_SIBLING_PATTERN.test(basename);
}

export {
  SCRATCH_BAK_INFIX,
  SCRATCH_DEL_INFIX,
  SCRATCH_SIBLING_PATTERN,
  SCRATCH_TMP_INFIX,
  isScratchSibling,
};
