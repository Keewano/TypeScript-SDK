/**
 * Seed the runtime's monotonic batchNum counter from the batches already
 * on disk. A restarted process used to start the counter at 0 while
 * unsent `.kwub` files from the prior run still carried low batchNums; a
 * new batch sealed within the same second would then land on an
 * identical `${batchEndTime}_${batchNum}.kwub` path and silently
 * overwrite the older file, and the backend would see duplicate batch
 * numbers within one directory. Starting at max(batchNum) + 1 keeps the
 * sequence collision-free across restarts of the same data directory.
 */

import type { StorageAdapter } from '@keewano/core';

import { listBatches } from '@keewano/core';

import { BATCHES_DIR } from './constants';

/**
 * Resolve the first batchNum this process may use.
 *
 * @returns The highest on-disk batchNum + 1; 0 when the directory is
 *   empty. A listing failure also falls back to 0 - boot must not fail
 *   on a storage hiccup, and a possible same-second overwrite is the
 *   accepted worst case then.
 */
async function seedNextBatchNum(storage: StorageAdapter): Promise<number> {
  try {
    const files = await listBatches({ storage, dir: BATCHES_DIR });
    let maxBatchNum = -1;
    for (const file of files) {
      if (file.batchNum > maxBatchNum) {
        maxBatchNum = file.batchNum;
      }
    }
    return maxBatchNum + 1;
  } catch {
    return 0;
  }
}

export { seedNextBatchNum };
