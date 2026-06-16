/**
 * Args type for the disk-cap reducer that replaces oversized
 * unsent batches with `BATCH_DROPPED` tombstones.
 */

import type { StorageAdapter } from '../../storage';

/**
 * storage - Storage adapter that backs the batch directory.
 * dir - Adapter-relative directory whose `.kwub` files are
 *   considered for replacement. Files outside the batch naming
 *   convention are ignored.
 * capBytes - Soft cap on total `.kwub` byte usage. Reduction
 *   stops as soon as the running total falls at or below this
 *   number; the cap is not a hard limit because individual files
 *   are processed serially and the running total is updated after
 *   each rewrite.
 */
interface ReduceStorageSizeArgs {
  storage: StorageAdapter;
  dir: string;
  capBytes: number;
}

export type { ReduceStorageSizeArgs };
