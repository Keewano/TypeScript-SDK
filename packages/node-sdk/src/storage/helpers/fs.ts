/**
 * Stateless filesystem helpers for `NodeStorageAdapter`: the default
 * `node:fs/promises` binding, errno classification, and the stat /
 * parent / cleanup operations the adapter methods delegate to. Kept here
 * so the adapter class holds only the `StorageAdapter` contract surface.
 */

import type { Stats } from 'node:fs';

import type { IsErrnoArgs, NodeFsLike } from '../types/nodeStorageAdapter';

import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Default filesystem binding: a thin wrapper that pins each
 * `node:fs/promises` call to the single argument shape the adapter uses.
 * Wrapping (rather than passing the module directly) keeps `NodeFsLike`
 * free of the broad overload set and gives test doubles a small surface.
 */
const REAL_FS: NodeFsLike = {
  readFile: (path) => readFile(path),
  writeFile: (path, data) => writeFile(path, data),
  rename: (oldPath, newPath) => rename(oldPath, newPath),
  unlink: (path) => unlink(path),
  readdir: (path, options) => readdir(path, options),
  stat: (path) => stat(path),
  mkdir: (path, options) => mkdir(path, options),
};

/** Narrow an unknown thrown value to a Node errno error with `code`. */
function isErrno({ error, code }: IsErrnoArgs): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** True when the errno means the path is absent: no entry, or a parent segment is a file. */
function isAbsentPath(error: unknown): boolean {
  return isErrno({ error, code: 'ENOENT' }) || isErrno({ error, code: 'ENOTDIR' });
}

/** Stat `fullPath`, mapping a missing path (or file-parent) to `null`. */
async function statOrNull(fs: NodeFsLike, fullPath: string): Promise<Stats | null> {
  try {
    return await fs.stat(fullPath);
  } catch (error) {
    if (isAbsentPath(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Reject a write whose destination is an existing directory. A missing
 * destination (`ENOENT`) or a parent segment that is a file (`ENOTDIR`)
 * passes through here; the latter surfaces as the parent-not-a-directory
 * error from `ensureParentDir`.
 */
async function assertNotDirectory(fs: NodeFsLike, fullPath: string): Promise<void> {
  let stats: Stats;
  try {
    stats = await fs.stat(fullPath);
  } catch (error) {
    if (isAbsentPath(error)) {
      return;
    }
    throw error;
  }
  if (stats.isDirectory()) {
    throw new Error('writeFile: destination path is a directory');
  }
}

/**
 * Create the destination's parent chain. `mkdir` reports `ENOTDIR` (an
 * intermediate segment is a file) or `EEXIST` (the parent itself is a
 * file) for a parent that cannot hold children; both map to the single
 * parent-not-a-directory contract error.
 */
async function ensureParentDir(fs: NodeFsLike, fullPath: string): Promise<void> {
  try {
    await fs.mkdir(dirname(fullPath), { recursive: true });
  } catch (error) {
    if (isErrno({ error, code: 'ENOTDIR' }) || isErrno({ error, code: 'EEXIST' })) {
      throw new Error('writeFile: parent path is not a directory');
    }
    throw error;
  }
}

/**
 * Best-effort cleanup of a scratch sibling. The target is always our own
 * per-operation tmp file, so a cleanup failure must not mask the original
 * write error.
 */
async function bestEffortUnlink(fs: NodeFsLike, target: string): Promise<void> {
  try {
    await fs.unlink(target);
  } catch {
    /* Preserve the original write failure. */
  }
}

export {
  REAL_FS,
  assertNotDirectory,
  bestEffortUnlink,
  ensureParentDir,
  isAbsentPath,
  isErrno,
  statOrNull,
};
