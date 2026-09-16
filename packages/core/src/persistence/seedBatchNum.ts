/**
 * Seed the runtime's monotonic batchNum counter from the batches already
 * on disk. A restarted process that starts the counter at 0 while unsent
 * `.kwub` files from the prior run still carry low batchNums will seal a
 * new batch onto an identical `${batchEndTime}_${batchNum}.kwub` path
 * within the same second, silently overwriting the older file - and the
 * backend then sees duplicate batch numbers in one directory. Starting at
 * max(batchNum) + 1 keeps the sequence collision-free across restarts of
 * the same data directory.
 *
 * Lives here rather than in a platform package because every platform
 * that persists batches needs it and the rule is the same for all of
 * them; the directory differs, so it is an argument.
 */

import type { SeedNextBatchNumArgs } from './types/seedBatchNum';

import { listBatches } from './kfile';

/**
 * Resolve the first batchNum this session may use.
 *
 * @returns The highest on-disk batchNum + 1; 0 when the directory is
 *   empty. A listing failure also falls back to 0 - boot must not fail
 *   on a storage hiccup, and a possible same-second overwrite is the
 *   accepted worst case then.
 */
async function seedNextBatchNum({ storage, dir }: SeedNextBatchNumArgs): Promise<number> {
  try {
    const files = await listBatches({ storage, dir });
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
