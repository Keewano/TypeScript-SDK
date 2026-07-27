/**
 * Construction options and the filesystem seam for `NodeStorageAdapter`.
 *
 * NodeStorageAdapterArgs:
 *   dataDir - sandbox root that holds every SDK-owned file. Relative
 *     values resolve against the process working directory. Defaults to
 *     `<os.tmpdir()>/keewano`; pass a persistent location so batches
 *     survive process restarts and temp-dir cleanup.
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

interface NodeStorageAdapterArgs {
  dataDir?: string;
  fs?: NodeFsLike;
}

interface IsErrnoArgs {
  error: unknown;
  code: string;
}

export type { IsErrnoArgs, NodeFsLike, NodeStorageAdapterArgs };
