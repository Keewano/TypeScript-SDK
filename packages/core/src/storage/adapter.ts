/**
 * In-memory `StorageAdapter` for unit tests and the JS-only execution
 * paths inside the SDK. State lives in a `Map` for the lifetime of the
 * instance and is discarded when the instance is garbage-collected;
 * data does not survive across separate adapters or process restarts.
 *
 * Defensive copies are made on the `writeFile` / `readFile` boundary so
 * that callers cannot accidentally mutate stored bytes by retaining a
 * reference to the buffer they passed in or got back.
 *
 * @example
 * ```ts
 * const storage = new MemoryStorageAdapter();
 *
 * await storage.writeFile({ path: 'batches/1.kwub', bytes: new Uint8Array([1, 2, 3]) });
 * const files = await storage.listFiles({ dir: 'batches', pattern: '*.kwub' });
 * ```
 */

import type {
  DeleteFileArgs,
  FileSizeArgs,
  ListFilesArgs,
  ReadFileArgs,
  StorageAdapter,
  WriteFileArgs,
} from './types/adapter';
import type { ValidPath } from './types/path';

import { globToRegex } from './helpers/glob';
import { validPath } from './helpers/path';

class MemoryStorageAdapter implements StorageAdapter {
  private readonly fileStore: Map<string, Uint8Array>;

  /**
   * Construct an empty in-memory adapter. A single `Map` backs the file
   * pool; it is discarded with the instance, so separate adapters do
   * not share state.
   */
  constructor() {
    this.fileStore = new Map();
  }

  /**
   * Snapshot the caller's bytes and store them under `path`. A fresh
   * `Uint8Array` is copied so a later mutation to the input buffer
   * cannot leak into the stored value. Parent-is-file and
   * destination-is-directory collisions are rejected so the in-memory
   * store cannot represent states (`foo` and `foo/bar` coexisting)
   * that the filesystem-backed adapters would refuse.
   *
   * @param args - Path key and binary contents.
   * @throws TypeError when `bytes` is not a `Uint8Array`.
   * @throws Error when a sibling key already occupies the parent path
   *   as a file, or when sibling keys already use `path` as a
   *   directory prefix.
   */
  async writeFile({ path, bytes }: WriteFileArgs): Promise<void> {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('writeFile: not a Uint8Array');
    }
    validPath({ path, fnName: 'writeFile' });
    const key = MemoryStorageAdapter.normalize(path);
    const childPrefix = `${key}/`;
    for (const existingPath of this.fileStore.keys()) {
      if (key.startsWith(`${existingPath}/`)) {
        throw new Error('writeFile: parent path is not a directory');
      }
      if (existingPath.startsWith(childPrefix)) {
        throw new Error('writeFile: destination path is a directory');
      }
    }
    this.fileStore.set(key, new Uint8Array(bytes));
  }

  /**
   * Return a defensive copy of the stored bytes. Mutating the returned
   * `Uint8Array` is safe and does not affect subsequent reads. Throws
   * when `path` is a logical directory (a sibling key starts with
   * `path + '/'`) so the in-memory store reports the same shape that
   * the filesystem-backed adapters would.
   *
   * @param args - Path key.
   * @returns Copy of the stored bytes, or `null` when the path is absent.
   * @throws Error when `path` resolves to a logical directory.
   */
  async readFile({ path }: ReadFileArgs): Promise<Uint8Array | null> {
    validPath({ path, fnName: 'readFile' });
    const key = MemoryStorageAdapter.normalize(path);
    const stored = this.fileStore.get(key);
    if (stored !== undefined) {
      return new Uint8Array(stored);
    }
    this.throwIfDirectory({ path: key, fnName: 'readFile' });
    return null;
  }

  /**
   * Remove a stored file. Resolves successfully when the path was not
   * present. Throws when `path` is a logical directory so a mistaken
   * caller does not silently drop a no-op where a real adapter would
   * refuse to recursively wipe a subtree.
   *
   * @param args - Path key.
   * @throws Error when `path` resolves to a logical directory.
   */
  async deleteFile({ path }: DeleteFileArgs): Promise<void> {
    validPath({ path, fnName: 'deleteFile' });
    const key = MemoryStorageAdapter.normalize(path);
    this.throwIfDirectory({ path: key, fnName: 'deleteFile' });
    this.fileStore.delete(key);
  }

  /**
   * List the basenames of direct children of `dir`, optionally
   * filtered by a glob pattern. Nested entries are excluded so the
   * semantics match a real filesystem `readdir`.
   *
   * @param args - Directory key and optional glob filter.
   * @returns Basenames of matching entries, or an empty array when
   *   nothing matches.
   */
  async listFiles({ dir, pattern }: ListFilesArgs): Promise<string[]> {
    validPath({ path: dir, fnName: 'listFiles' });
    /** `normalize` trims any trailing separator so the prefix is exact. */
    const normalizedDir = MemoryStorageAdapter.normalize(dir);
    /**
     * Filesystem-backed adapters fail `readdir(file)`; mirror that
     * here so a file target cannot silently look like an empty dir.
     */
    if (this.fileStore.has(normalizedDir)) {
      throw new Error('listFiles: path is not a directory');
    }
    const dirPrefix = `${normalizedDir}/`;
    const directChildren: string[] = [];
    for (const path of this.fileStore.keys()) {
      if (!path.startsWith(dirPrefix)) continue;
      const basename = path.substring(dirPrefix.length);
      /** Reject nested entries; only direct children of `dir`. */
      if (basename.includes('/')) continue;
      directChildren.push(basename);
    }
    /**
     * Sort lexicographically so order is deterministic across adapters
     * - native `readDir` / `readDirectoryAsync` make no order guarantee.
     */
    directChildren.sort((a, b) => a.localeCompare(b));
    if (pattern === undefined) {
      return directChildren;
    }
    const regex = globToRegex(pattern);
    return directChildren.filter((name) => regex.test(name));
  }

  /**
   * Report the byte length of a stored file. Throws when `path` is a
   * logical directory so the in-memory store reports the same shape
   * that the filesystem-backed adapters would.
   *
   * @param args - Path key.
   * @returns Byte length, or `null` when the path is absent.
   * @throws Error when `path` resolves to a logical directory.
   */
  async fileSize({ path }: FileSizeArgs): Promise<number | null> {
    validPath({ path, fnName: 'fileSize' });
    const key = MemoryStorageAdapter.normalize(path);
    const stored = this.fileStore.get(key);
    if (stored !== undefined) {
      return stored.length;
    }
    this.throwIfDirectory({ path: key, fnName: 'fileSize' });
    return null;
  }

  /**
   * Normalize backslash separators to forward slashes and trim a
   * single trailing separator so a path written as `foo\bar`, `foo/`,
   * or `foo` all collapse to the same logical entry. Real filesystem-
   * backed adapters resolve those forms to the same on-disk target,
   * and the in-memory store must match that invariant to keep parent
   * / child collision checks honest.
   *
   * Keys remain case-sensitive: `Foo/x` and `foo/x` stay distinct.
   * This matches POSIX (`react-native-fs`) but NOT case-insensitive
   * volumes (default APFS / NTFS), where the platform adapter would
   * merge them. The SDK never writes two paths that differ only in
   * case (identity keys are fixed lowercase, batch filenames are
   * numeric), so the difference is unreachable in practice; callers
   * must not rely on case to distinguish files.
   */
  private static normalize(path: string): string {
    const slashed = path.replaceAll('\\', '/');
    return slashed.endsWith('/') ? slashed.slice(0, -1) : slashed;
  }

  /**
   * Throw when any stored key starts with `path + '/'`, which means
   * `path` is acting as a logical directory inside the flat map.
   * Callers invoke this on a miss to distinguish "absent file" from
   * "directory target".
   */
  private throwIfDirectory({ path, fnName }: ValidPath): void {
    const childPrefix = `${path}/`;
    for (const existingPath of this.fileStore.keys()) {
      if (existingPath.startsWith(childPrefix)) {
        throw new Error(`${fnName}: path is a directory`);
      }
    }
  }
}

export { MemoryStorageAdapter };
