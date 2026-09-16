/**
 * Construction options and the filesystem seam for `NodeStorageAdapter`.
 *
 * NodeStorageAdapterArgs:
 *   dataDir - sandbox root that holds every SDK-owned file. Required,
 *     with no default: a shared one would put two services' queues in
 *     one directory, and each ships whatever it finds under its own
 *     project. Relative values resolve against the process working
 *     directory. Give it a private, persistent location - the same
 *     across restarts of one service, different per service and per
 *     replica - so batches survive a restart without being visible to
 *     anybody else.
 *   fs - advanced seam that injects a `node:fs/promises` stand-in so the
 *     adapter's defensive error branches can be exercised in tests.
 *     Defaults to the real `node:fs/promises`.
 *
 * NodeFsLike - the minimal `node:fs/promises` subset the adapter calls,
 *   narrowed to the exact argument shapes used so a test double only has
 *   to implement what the adapter actually invokes.
 *
 * IsErrnoArgs - inputs for the internal errno predicate:
 *   error - the unknown thrown value to inspect.
 *   code - the Node errno string to match (e.g. 'ENOENT').
 */

import type { Dirent, Stats } from 'node:fs';

interface NodeFsLike {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  stat(path: string): Promise<Stats>;
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
}

/**
 * Arguments for `sweepOrphanedScratchFiles`.
 *
 * dir - Adapter-relative directory to sweep.
 */
interface SweepScratchArgs {
  dir: string;
}

interface NodeStorageAdapterArgs {
  dataDir: string;
  fs?: NodeFsLike;
}

interface IsErrnoArgs {
  error: unknown;
  code: string;
}

export type { IsErrnoArgs, NodeFsLike, NodeStorageAdapterArgs, SweepScratchArgs };
