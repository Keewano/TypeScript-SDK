/**
 * Path-resolution helpers shared between the public adapter methods.
 * Kept as free functions so the adapter class itself stays focused on
 * its `StorageAdapter` contract and the helpers can be tested in
 * isolation against any `RNFSLike` fake.
 */

import type { EnsureParentDirArgs, ResolveUnderRootArgs } from '../types/pathHelpers';

import { normalizeRelativePath } from '@keewano/core';

/**
 * Resolve an adapter-relative path to a full filesystem path under the
 * sandbox root. The bare-RN root never carries a trailing slash, so
 * the separator is inserted explicitly between the root and the shared
 * `normalizeRelativePath` result (which strips absolute / traversal /
 * URI-aliasing shapes as a defense-in-depth net below the primary
 * `validPath` check the adapter methods invoke first).
 *
 * @param args - Sandbox root and the adapter-relative path.
 * @returns Fully-qualified filesystem path.
 * @throws Error when the relative path is absolute or contains a
 *   `..` segment.
 */
function resolveUnderRoot({ rootDir, relativePath }: ResolveUnderRootArgs): string {
  const normalized = normalizeRelativePath({ relativePath, fnName: 'resolveUnderRoot' });
  return `${rootDir}/${normalized}`;
}

/**
 * Create the parent directory of `fullPath` when it does not already
 * exist. `react-native-fs.mkdir` succeeds idempotently when the path
 * already exists, but the explicit `exists` check skips the
 * round-trip in the common case. A pre-existing non-directory at the
 * parent path is rejected up-front so the later `writeFile` does not
 * fail with an opaque react-native-fs error.
 *
 * @param args - File-system handle and the fully-qualified path whose
 *   parent must exist.
 * @throws Error when the parent path exists but is not a directory.
 */
async function ensureParentDir({ rnfs, fullPath }: EnsureParentDirArgs): Promise<void> {
  const lastSlash = fullPath.lastIndexOf('/');
  if (lastSlash <= 0) return;
  const parent = fullPath.substring(0, lastSlash);
  if (await rnfs.exists(parent)) {
    const stat = await rnfs.stat(parent);
    if (!stat.isDirectory()) {
      throw new Error('writeFile: parent path is not a directory');
    }
    return;
  }
  await rnfs.mkdir(parent);
}

export { ensureParentDir, resolveUnderRoot };
