/**
 * Contracts for the batch-queue write bookkeeping.
 */

import type { EncodedBatch, OnShipPassArgs } from '@keewano/core';

import type { WebSdkRuntime } from '../../types/runtime';

/**
 * Arguments of `persistQueuedBatches`.
 *
 * runtime - Session whose dispatcher is drained into the queue.
 * onBatchesSealed - Optional synchronous observer of the batches this
 *   persist sealed, invoked once before the first storage write and
 *   after the queue bookkeeping has been updated.
 */
interface PersistQueuedBatchesArgs {
  runtime: WebSdkRuntime;
  onBatchesSealed?: (batches: readonly EncodedBatch[]) => void;
}

/**
 * Observers the send loop reports through, because it writes and
 * drains the same queue from inside core.
 *
 * onBatchesSealed - Reports a persist of the loop's own swap.
 * onShipPass - Reports what a completed ship pass left on disk.
 */
interface QueueObservers {
  onBatchesSealed: () => void;
  onShipPass: (args: OnShipPassArgs) => void;
}

/**
 * What a boot-time read of the queue directory tells the session.
 *
 * nextBatchNum - First batch number this session may allocate: one
 *   past the highest already on disk, so a restart cannot reuse a
 *   number an unsent file still carries.
 * queueEmpty - `true` only when the directory was read and held no
 *   batches. A read that failed reports `false`, because a session
 *   that cannot see the queue must not assume it is empty.
 */
interface QueueSeed {
  nextBatchNum: number;
  queueEmpty: boolean;
}

export type { PersistQueuedBatchesArgs, QueueObservers, QueueSeed };
