/**
 * Node.js `StorageAdapter` backed by `node:fs/promises`. Every value the
 * SDK persists is a file under an SDK-owned sandbox root (default
 * `<os.tmpdir()>/keewano`, overridable via `dataDir`).
 *
 * Writes are atomic with no backup/swap dance: `node:fs/promises.rename`
 * is an atomic replace on
 * every supported platform (POSIX `rename(2)`; Windows `MoveFileEx` with
 * `REPLACE_EXISTING`), so a fresh write and an overwrite are both atomic
 * and a reader never observes a half-written or missing destination.
 * `unlink` refuses directories instead of recursing, so `deleteFile`
 * needs no trash sibling to stay non-destructive. That atomicity also
 * makes a per-path mutation queue unnecessary: concurrent writers each
 * stage a uniquely-named scratch sibling and the final `rename` wins
 * cleanly.
 *
 * This file holds only the `StorageAdapter` contract surface; the
 * stateless errno / stat / parent / cleanup helpers live in
 * `./helpers/fs`.
 *
 * @example
 * ```ts
 * import { NodeStorageAdapter } from '@keewano/node-sdk';
 *
 * const storage = new NodeStorageAdapter({ dataDir: '/var/lib/myapp/keewano' });
 * await storage.writeFile({ path: 'batches/1.kwub', bytes });
 * ```
 */

import type { Dirent } from 'node:fs';

import type { NodeFsLike, NodeStorageAdapterArgs } from './types/nodeStorageAdapter';

import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  type DeleteFileArgs,
  type FileSizeArgs,
  type ListFilesArgs,
  type ReadFileArgs,
  type StorageAdapter,
  type WriteFileArgs,
  SCRATCH_TMP_INFIX,
  generateOpId,
  globToRegex,
  isScratchSibling,
  normalizeRelativePath,
  validPath,
} from '@keewano/core';

import {
  REAL_FS,
  assertNotDirectory,
  bestEffortUnlink,
  ensureParentDir,
  isAbsentPath,
  isErrno,
  statOrNull,
} from './helpers/fs';

const DEFAULT_SUBDIR = 'keewano';

class NodeStorageAdapter implements StorageAdapter {
  private readonly rootDir: string;
  private readonly fs: NodeFsLike;

  /**
   * @param args - Optional sandbox root override (`dataDir`) and a
   *   filesystem seam (`fs`). See `NodeStorageAdapterArgs`.
   */
  constructor(args: NodeStorageAdapterArgs = {}) {
    if (args.dataDir?.length === 0) {
      throw new Error('NodeStorageAdapter: empty dataDir');
    }
    this.rootDir = resolve(args.dataDir ?? join(tmpdir(), DEFAULT_SUBDIR));
    this.fs = args.fs ?? REAL_FS;
  }

  /**
   * Stage the bytes to a per-operation scratch sibling and atomically
   * rename it over the destination. A defensive copy of `bytes` is taken
   * synchronously so the caller may reuse the buffer after the call.
   *
   * @param args - Adapter-relative path and binary contents.
   * @throws TypeError when `bytes` is not a `Uint8Array`.
   * @throws Error when the destination is a directory or a parent path
   *   segment is an existing file.
   */
  async writeFile({ path, bytes }: WriteFileArgs): Promise<void> {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('writeFile: not a Uint8Array');
    }
    validPath({ path, fnName: 'writeFile' });
    const fullPath = this.resolveFullPath(path);
    await assertNotDirectory(this.fs, fullPath);
    await ensureParentDir(this.fs, fullPath);
    const tmpPath = `${fullPath}.${SCRATCH_TMP_INFIX}.${generateOpId()}`;
    try {
      await this.fs.writeFile(tmpPath, new Uint8Array(bytes));
      await this.fs.rename(tmpPath, fullPath);
    } catch (error) {
      await bestEffortUnlink(this.fs, tmpPath);
      throw error;
    }
  }

  /**
   * @param args - Adapter-relative path.
   * @returns A defensive copy of the file contents, or `null` when the
   *   path does not exist.
   * @throws Error when the path resolves to a directory.
   */
  async readFile({ path }: ReadFileArgs): Promise<Uint8Array | null> {
    validPath({ path, fnName: 'readFile' });
    const fullPath = this.resolveFullPath(path);
    try {
      const buffer = await this.fs.readFile(fullPath);
      return new Uint8Array(buffer);
    } catch (error) {
      /**
       * ENOENT (missing) and ENOTDIR (a parent segment is a file, so the
       * path cannot exist) both mean "absent" -> null, matching the
       * StorageAdapter contract and `statOrNull`'s own mapping.
       */
      if (isAbsentPath(error)) {
        return null;
      }
      if (isErrno({ error, code: 'EISDIR' })) {
        throw new Error('readFile: path is a directory');
      }
      throw error;
    }
  }

  /**
   * Idempotent: removing a missing path is a no-op. A directory target
   * is rejected up-front; `unlink` never recurses, so even a concurrent
   * file-to-directory swap stays non-destructive.
   *
   * @param args - Adapter-relative path.
   * @throws Error when the path resolves to a directory.
   */
  async deleteFile({ path }: DeleteFileArgs): Promise<void> {
    validPath({ path, fnName: 'deleteFile' });
    const fullPath = this.resolveFullPath(path);
    const stats = await statOrNull(this.fs, fullPath);
    if (stats === null) {
      return;
    }
    if (stats.isDirectory()) {
      throw new Error('deleteFile: path is a directory');
    }
    try {
      await this.fs.unlink(fullPath);
    } catch (error) {
      if (isErrno({ error, code: 'ENOENT' })) {
        return;
      }
      throw error;
    }
  }

  /**
   * Lists the direct file children of `dir`, dropping subdirectories and
   * adapter-owned scratch siblings, sorted lexicographically so ordering
   * is deterministic across adapters.
   *
   * @param args - Adapter-relative directory and optional glob filter.
   * @returns Matching basenames, or an empty array when the directory
   *   does not exist or nothing matches.
   * @throws Error when `dir` resolves to an existing non-directory.
   */
  async listFiles({ dir, pattern }: ListFilesArgs): Promise<string[]> {
    validPath({ path: dir, fnName: 'listFiles' });
    const fullDir = this.resolveFullPath(dir);
    let entries: Dirent[];
    try {
      entries = await this.fs.readdir(fullDir, { withFileTypes: true });
    } catch (error) {
      if (isErrno({ error, code: 'ENOENT' })) {
        return [];
      }
      if (isErrno({ error, code: 'ENOTDIR' })) {
        /**
         * readdir reports ENOTDIR both when `dir` itself is a file and
         * when an ancestor segment is a file. Re-stat to tell them apart:
         * a present entry is the contract violation (throw); an absent one
         * means the directory does not exist, which the StorageAdapter
         * contract resolves to [].
         */
        if ((await statOrNull(this.fs, fullDir)) !== null) {
          throw new Error('listFiles: path is not a directory');
        }
        return [];
      }
      throw error;
    }
    /**
     * Filter on `!isDirectory()` rather than `isFile()`: `readdir` with
     * `withFileTypes` derives the type from the directory entry's
     * `d_type`, which is `DT_UNKNOWN` on some filesystems (NFS, certain
     * FUSE / overlay mounts). An unknown-type entry reports false for
     * BOTH predicates, so keying on `isFile()` would silently drop a
     * real batch file there; `!isDirectory()` keeps it and still excludes
     * subdirectories.
     */
    const names = entries
      .filter((entry) => !entry.isDirectory() && !isScratchSibling(entry.name))
      .map((entry) => entry.name);
    names.sort((a, b) => a.localeCompare(b));
    if (pattern === undefined) {
      return names;
    }
    const regex = globToRegex(pattern);
    return names.filter((name) => regex.test(name));
  }

  /**
   * @param args - Adapter-relative path.
   * @returns Byte length, or `null` when the path does not exist.
   * @throws Error when the path resolves to a directory.
   */
  async fileSize({ path }: FileSizeArgs): Promise<number | null> {
    validPath({ path, fnName: 'fileSize' });
    const fullPath = this.resolveFullPath(path);
    const stats = await statOrNull(this.fs, fullPath);
    if (stats === null) {
      return null;
    }
    if (stats.isDirectory()) {
      throw new Error('fileSize: path is a directory');
    }
    return stats.size;
  }

  /**
   * Resolve an adapter-relative path to a full filesystem path under the
   * sandbox root. `normalizeRelativePath` strips absolute / traversal /
   * URI-aliasing shapes as a defense-in-depth net below the primary
   * `validPath` check each method runs first, and yields a canonical
   * slash-separated relative path that `join` maps onto the host
   * separator. The fixed `fnName` never surfaces: by the time this runs
   * `validPath` has already rejected every shape `normalizeRelativePath`
   * would, so its error path is unreachable here.
   */
  private resolveFullPath(relativePath: string): string {
    return join(this.rootDir, normalizeRelativePath({ relativePath, fnName: 'resolveFullPath' }));
  }
}

export { NodeStorageAdapter };
