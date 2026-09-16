import type { StorageAdapter } from '../../storage';

/**
 * Arguments for `seedNextBatchNum`.
 *
 * storage - Adapter whose batch directory is read.
 * dir - Directory holding the `.kwub` files, as the platform names it.
 */
interface SeedNextBatchNumArgs {
  storage: StorageAdapter;
  dir: string;
}

export type { SeedNextBatchNumArgs };
