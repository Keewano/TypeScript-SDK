/**
 * The origin's `.kwub` queue as this session writes it, plus the two
 * facts the exit path gates on: whether sending now can reorder the
 * session, and whether the server already knows the schema hash the
 * batches carry.
 *
 * Both facts are only correct while EVERY writer reports, so they are
 * assigned in this module alone: the facade's persists all run through
 * {@link persistQueuedBatches}, the send loop reports its own persists
 * and ship passes through {@link queueObservers}, and
 * {@link canSendAtExit} is the single read. A future flush path that
 * forgets the bookkeeping cannot compile its way past the wrapper.
 */

import type { EncodedBatch, StorageAdapter } from '@keewano/core';

import type { PersistQueuedBatchesArgs, QueueObservers, QueueSeed } from './types/batchQueue';
import type { WebSdkRuntime } from '../types/runtime';

import { listBatches, persistAccumulatedBatch } from '@keewano/core';

import { allocBatchNum } from '../runtime';

/** Directory name (relative to the queue storage adapter root) under which batch files live. */
const BATCHES_DIR = 'keewano';

/**
 * Read what a previous visit left behind, which decides two things at
 * once: where this session's batch numbering starts, and whether the
 * exit path may send at all.
 *
 * A listing failure must not fail boot, so it reports the numbering it
 * would have used for an empty queue - a same-second overwrite is the
 * accepted worst case - while reporting the queue as NOT empty, since
 * a session that could not see the directory has no grounds to claim
 * nothing is waiting in it.
 */
async function readQueueSeed(storage: StorageAdapter): Promise<QueueSeed> {
  try {
    const files = await listBatches({ storage, dir: BATCHES_DIR });
    let maxBatchNum = -1;
    for (const file of files) {
      if (file.batchNum > maxBatchNum) {
        maxBatchNum = file.batchNum;
      }
    }
    return { nextBatchNum: maxBatchNum + 1, queueEmpty: files.length === 0 };
  } catch {
    return { nextBatchNum: 0, queueEmpty: false };
  }
}

/**
 * Drain whatever the dispatcher accumulated into the queue, wired to
 * this session's storage, codec, batch numbering and filename suffix.
 *
 * @returns Core's persist result: `true` when every sealed slice
 *   landed on disk or there was nothing to persist.
 */
function persistQueuedBatches(args: PersistQueuedBatchesArgs): Promise<boolean> {
  const { runtime } = args;
  return persistAccumulatedBatch({
    storage: runtime.queueStorage,
    dispatcher: runtime.dispatcher,
    dir: BATCHES_DIR,
    allocBatchNum: () => allocBatchNum(runtime),
    filenameSuffix: runtime.batchFilenameSuffix,
    codec: runtime.codec,
    onBatchesSealed: (batches: readonly EncodedBatch[]) => {
      /**
       * These batches are queued from this moment on, so a later exit
       * may not send past them - including the ones handed to an exit
       * send below, whose delivery is never confirmed.
       */
      runtime.exitSendSafe = false;
      args.onBatchesSealed?.(batches);
    },
  });
}

/** Queue observers for the send loop; see {@link QueueObservers}. */
function queueObservers(runtime: WebSdkRuntime): QueueObservers {
  return {
    onBatchesSealed: () => {
      runtime.exitSendSafe = false;
    },
    onShipPass: ({ remaining }) => {
      /**
       * A ship pass runs only past the loop's registration gate, so a
       * completed pass is this tab's proof that the server knows the
       * schema hash stamped on every batch it persists.
       */
      runtime.customEventsRegistered = true;
      if (remaining === 0) {
        runtime.exitSendSafe = true;
        /**
         * The exit copies this guard protected are drained: a later
         * teardown that only persists may wake the loop again without
         * shipping a duplicate. Left set, the guard would silence every
         * wake for the rest of the page - a hide, a return with new
         * events, and a second hide would leave that batch to the
         * throttled hidden-tab timer, or lose it outright on the
         * memory-only fallback.
         */
        runtime.exitSendStarted = false;
      }
    },
  };
}

/**
 * `true` when the exit path may deliver the batches it just sealed
 * instead of only persisting them. Two independent conditions:
 *
 *   - nothing of this session is still queued, because the server
 *     drops a lower-numbered batch that arrives after a higher one;
 *   - the declared custom-event schema is registered, because a batch
 *     stamped with a hash the server never saw is rejected - and on
 *     the next visit that rejection is indistinguishable from a
 *     duplicate, so the disk copy is deleted and the events are lost.
 */
function canSendAtExit(runtime: WebSdkRuntime): boolean {
  const schemaKnown = runtime.customEventSet === undefined || runtime.customEventsRegistered;
  return runtime.exitSendSafe && schemaKnown;
}

export { BATCHES_DIR, canSendAtExit, persistQueuedBatches, queueObservers, readQueueSeed };
