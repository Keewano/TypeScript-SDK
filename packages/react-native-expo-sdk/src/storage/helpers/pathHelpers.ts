/**
 * Path-resolution helpers shared between the public adapter methods.
 * Kept as free functions so the adapter class itself stays focused on
 * its `StorageAdapter` contract and the helpers can be tested in
 * isolation against any `ExpoFileSystemLike` fake.
 */

import type {
  ComputeRootDirArgs,
  EnsureParentDirArgs,
  ResolveUnderRootArgs,
} from '../types/pathHelpers';

import { normalizeRelativePath } from '@keewano/core';

/**
 * Compute the sandbox root URI. Resolution order:
 *   1. Explicit `rootDir` arg wins (trailing slash appended if
 *      missing).
 *   2. Default `{documentDirectory}keewano/` when the runtime exposes
 *      a document directory.
 *   3. Throw - the adapter cannot pick a directory on its own.
 *
 * @param args - Optional explicit override and the runtime document
 *   directory.
 * @returns Sandbox root URI ending with a slash.
 * @throws Error when both `explicit` is `undefined` and the runtime
 *   does not expose `documentDirectory`.
 */
function computeRootDir({ explicit, documentDirectory }: ComputeRootDirArgs): string {
  if (explicit !== undefined) {
    if (explicit.length === 0) {
      throw new Error('ExpoStorageAdapter: empty rootDir');
    }
    /**
     * Require the local-file URI shape (`file:///...`). `file://host/path`
     * addresses a remote host; `file:/path` is a still-absolute
     * single-slash form some host APIs read inconsistently. `?` / `#`
     * would be parsed as URI query / fragment delimiters.
     */
    if (!explicit.startsWith('file:///') || explicit.includes('?') || explicit.includes('#')) {
      throw new Error(
        'ExpoStorageAdapter: rootDir must be a local file:/// URI without query/fragment',
      );
    }
    return explicit.endsWith('/') ? explicit : `${explicit}/`;
  }
  /**
   * Tolerate `undefined` and the empty string too: `documentDirectory`
   * is typed as `string | null` but a misbehaving host could produce
   * an invalid URI like `undefinedkeewano/` or `file:///docskeewano/`.
   */
  if (documentDirectory == null || documentDirectory.length === 0) {
    throw new Error('ExpoStorageAdapter: documentDirectory unavailable');
  }
  /**
   * Apply the same shape constraints that an explicit `rootDir` gets:
   * a misbehaving host returning `file://host/docs` or `file:/docs`
   * would otherwise produce a broken sandbox URI.
   */
  if (
    !documentDirectory.startsWith('file:///') ||
    documentDirectory.includes('?') ||
    documentDirectory.includes('#')
  ) {
    throw new Error(
      'ExpoStorageAdapter: documentDirectory must be a local file:/// URI without query/fragment',
    );
  }
  const baseDir = documentDirectory.endsWith('/') ? documentDirectory : `${documentDirectory}/`;
  return `${baseDir}keewano/`;
}

/**
 * Resolve an adapter-relative path to a full URI under the sandbox
 * root. The root always ends with a slash, so plain concatenation
 * produces a valid URI. Absolute / traversal segments are rejected
 * as defense-in-depth below the primary `validPath` check.
 *
 * @param args - Sandbox root URI and the adapter-relative path.
 * @returns Fully-qualified file URI.
 * @throws Error when the relative path is absolute or contains a
 *   `..` segment.
 */
function resolveUnderRoot({ rootDir, relativePath }: ResolveUnderRootArgs): string {
  const normalized = normalizeRelativePath({ relativePath, fnName: 'resolveUnderRoot' });
  return `${rootDir}${normalized}`;
}

/**
 * Create the parent directory of `fullUri` when it does not already
 * exist. `makeDirectoryAsync` with `{ intermediates: true }` is
 * mkdir -p semantics. A pre-existing non-directory at the parent
 * path is rejected up-front. A failed create is rechecked so two
 * concurrent writes targeting different files under the same new
 * parent do not collide - the loser sees the winner's directory and
 * proceeds instead of failing the write.
 *
 * @param args - File-system handle and the fully-qualified URI whose
 *   parent must exist.
 * @throws Error when the parent path exists but is not a directory.
 */
async function ensureParentDir({ fileSystem, fullUri }: EnsureParentDirArgs): Promise<void> {
  const lastSlash = fullUri.lastIndexOf('/');
  if (lastSlash <= 0) return;
  /**
   * Root-level file at `file:///foo.bin` would produce `parent ===
   * 'file://'` - an invalid URI. The URI root has no parent directory
   * to create, so short-circuit.
   */
  const fileUriRoot = 'file:///';
  if (fullUri.startsWith(fileUriRoot) && !fullUri.includes('/', fileUriRoot.length)) {
    return;
  }
  const parent = fullUri.substring(0, lastSlash);
  const info = await fileSystem.getInfoAsync(parent);
  if (info.exists) {
    if (info.isDirectory !== true) {
      throw new Error('writeFile: parent path is not a directory');
    }
    return;
  }
  try {
    await fileSystem.makeDirectoryAsync(parent, { intermediates: true });
  } catch (error) {
    /**
     * Race-recover: a concurrent write may have created the parent
     * between our `getInfoAsync` and `makeDirectoryAsync`. If the
     * parent is now a directory, treat the create as a no-op; surface
     * the original failure otherwise.
     */
    const latest = await fileSystem.getInfoAsync(parent);
    if (!latest.exists || latest.isDirectory !== true) {
      throw error;
    }
  }
}

export { computeRootDir, ensureParentDir, resolveUnderRoot };
