/**
 * Node.js `StorageAdapter` backed by `node:fs/promises`. Every value the
 * SDK persists is a file under the sandbox root named by `dataDir`.
 * There is no default, deliberately: a queue directory is addressed to
 * one project, a batch inside it carries its own user and payload, and
 * a process reading a neighbour's file ships that neighbour's end users
 * into its own project.
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

import type {
  NodeFsLike,
  NodeStorageAdapterArgs,
  SweepScratchArgs,
} from './types/nodeStorageAdapter';

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

/**
 * How old a scratch sibling must be before the sweep treats it as
 * abandoned. Far past any single write, so a file this old cannot be
 * one another process is still staging.
 */
const ORPHANED_SCRATCH_AGE_MS = 60 * 60 * 1000;

class NodeStorageAdapter implements StorageAdapter {
  private readonly rootDir: string;
  private readonly fs: NodeFsLike;

  /**
   * @param args - Optional sandbox root override (`dataDir`) and a
   *   filesystem seam (`fs`). See `NodeStorageAdapterArgs`.
   */
  constructor(args: NodeStorageAdapterArgs) {
    /**
     * Reads `args` defensively: a JavaScript host reaching this with
     * nothing at all would otherwise get a property-of-undefined error
     * that names neither the adapter nor the field it wants.
     */
    if (typeof args?.dataDir !== 'string' || args.dataDir.length === 0) {
      throw new Error('NodeStorageAdapter: dataDir is required');
    }
    this.rootDir = resolve(args.dataDir);
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
    /**
     * Copied here, before the first await rather than at the write:
     * the caller is told it may reuse its buffer once this returns to
     * the event loop, and everything between then and the write is
     * time in which it can.
     */
    const owned = new Uint8Array(bytes);
    validPath({ path, fnName: 'writeFile' });
    const fullPath = this.resolveFullPath(path);
    await assertNotDirectory(this.fs, fullPath);
    await ensureParentDir(this.fs, fullPath);
    const tmpPath = `${fullPath}.${SCRATCH_TMP_INFIX}.${generateOpId()}`;
    try {
      await this.fs.writeFile(tmpPath, owned);
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
   * Delete scratch siblings a killed process left behind.
   *
   * A write stages to `<name>.<infix>.<opId>` and renames it over the
   * destination; a process killed between those two steps leaves the
   * staged file. `listFiles` hides scratch siblings, so the file is
   * invisible to the batch listing and to the disk cap that would
   * otherwise reclaim it - it occupies the budget forever without
   * being a candidate for eviction.
   *
   * Age-gated rather than gated on "we are the only process here":
   * a live write's scratch file is milliseconds old, so anything past
   * the threshold cannot belong to a write still in progress, and the
   * sweep stays correct even where two processes share a directory.
   *
   * Best-effort throughout: this reclaims space, and failing to
   * reclaim it must never stop the SDK from starting.
   */
  async sweepOrphanedScratchFiles({ dir }: SweepScratchArgs): Promise<void> {
    const fullDir = this.resolveFullPath(dir);
    let entries: Dirent[];
    try {
      entries = await this.fs.readdir(fullDir, { withFileTypes: true });
    } catch {
      return;
    }
    const staleBefore = Date.now() - ORPHANED_SCRATCH_AGE_MS;
    for (const entry of entries) {
      if (entry.isDirectory() || !isScratchSibling(entry.name)) continue;
      const candidate = join(fullDir, entry.name);
      try {
        const stats = await this.fs.stat(candidate);
        if (stats.mtimeMs < staleBefore) await this.fs.unlink(candidate);
      } catch {
        /** Gone already, or unreadable; either way not this run's problem. */
      }
    }
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
