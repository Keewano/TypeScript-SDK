/**
 * Disk-cap policy that replaces oversized unsent batches with
 * `BATCH_DROPPED` tombstones so the on-disk batch directory never
 * exceeds the configured byte budget.
 *
 * When `totalBytes > capBytes`, walk the batches in chronological
 * order (`(batchEndTime, batchNum)`) and rewrite each one larger
 * than {@link BATCH_DROP_THRESHOLD_BYTES} as a tombstone whose
 * payload is a single `BATCH_DROPPED` event (reason
 * `TOO_MANY_UNSENT_EVENTS`) encoded by the active codec. The
 * tombstone keeps the original identity (UserId, DataSessionId,
 * BatchNum, BatchStartTime, BatchEndTime, CustomEventsVersion) so the
 * server can correlate the drop with the session that produced it.
 *
 * Stops as soon as the running total falls at or below `capBytes`.
 * Files already at or below {@link BATCH_DROP_THRESHOLD_BYTES} are
 * skipped because they are already tombstoned (a fresh binary
 * tombstone file is exactly 70 bytes).
 */

import type { BatchFileInfo } from './types/kfile';
import type { ReduceStorageSizeArgs } from './types/storageCap';
import type { Codec, EncodedBatch } from '../codec/types/codec';

import { KEvents } from '../events/kevents';
import { KBatchDropReason } from '../events/batchDropReason';

import { listBatches, loadBatch, saveBatch } from './kfile';
import { KFILE_FOOTER_SIZE } from './helpers/kfileFooter';
import { KFILE_HEADER_SIZE } from './helpers/kfileHeader';

/**
 * Bytes a fresh binary tombstone payload occupies: timestamp (4) +
 * eventId (2) + reason (4).
 */
const TOMBSTONE_PAYLOAD_SIZE = 10;

/**
 * Total on-disk size of a binary tombstoned batch file: header +
 * tombstone payload + footer. Used as the lower bound for the "is
 * this file worth rewriting?" check.
 */
const TOMBSTONE_FILE_SIZE = KFILE_HEADER_SIZE + TOMBSTONE_PAYLOAD_SIZE + KFILE_FOOTER_SIZE;

/**
 * Files at or below this size are skipped during reduction. A fresh
 * binary tombstone is exactly {@link TOMBSTONE_FILE_SIZE} = 70 bytes,
 * so any file at or under 70 is already a tombstone (or smaller) and
 * would not free meaningful disk space on rewrite.
 */
const BATCH_DROP_THRESHOLD_BYTES = TOMBSTONE_FILE_SIZE;

/**
 * Replace `original` with a tombstone batch carrying the same
 * identity / sequence / timing / schema-version fields. Only the
 * payload differs: a single `BATCH_DROPPED(TOO_MANY_UNSENT_EVENTS)`
 * event stamped with the original `batchStartTime`, encoded by the
 * same codec that will serialize the container - so the tombstone
 * stays valid for any batch encoding.
 */
function buildTombstoneBatch(codec: Codec, original: EncodedBatch): EncodedBatch {
  /**
   * The cut threshold is irrelevant for a single 10-byte event; any
   * positive value works. Reuse the payload size to avoid importing
   * dispatcher policy here.
   */
  const builder = codec.createBuilder({ cutThresholdBytes: TOMBSTONE_PAYLOAD_SIZE + 1 });
  builder.addEventUint32({
    eventId: KEvents.BATCH_DROPPED,
    timestamp: original.batchStartTime,
    value: KBatchDropReason.TOO_MANY_UNSENT_EVENTS,
  });
  const slices = builder.seal({ finalBatchEndTime: original.batchEndTime });
  /**
   * A single added event must seal to exactly one slice. A codec that
   * returns anything else violates the builder contract, and silently
   * persisting an empty or truncated tombstone would hide the bug -
   * fail loudly instead.
   */
  const slice = slices[0];
  if (slice === undefined || slices.length !== 1) {
    throw new Error('buildTombstoneBatch: expected one tombstone slice');
  }
  return {
    /**
     * Stamp the active codec's id, not the original's: the tombstone
     * payload was just encoded by this codec.
     */
    codecId: codec.id,
    metadata: {
      userId: original.metadata.userId,
      dataSessionId: original.metadata.dataSessionId,
      batchVersion: original.metadata.batchVersion,
      customEventsVersion: original.metadata.customEventsVersion,
    },
    batchNum: original.batchNum,
    /** The slice carries the codec's (clamp-corrected) timing stamps. */
    batchStartTime: slice.batchStartTime,
    batchEndTime: slice.batchEndTime,
    payload: slice.payload,
  };
}

/**
 * Rewrite the file at `entry.path` as a tombstone and return the
 * delta (`new size - old size`, always non-positive). Returns `0`
 * when the original cannot be loaded (corrupted / vanished), or when
 * the file's on-disk identity / size has drifted from what
 * `listBatches` reported - the file is left alone so a future pass
 * can retry once the filesystem stabilizes.
 *
 * The drift guard matters because `saveBatch` writes to the canonical
 * `${batchEndTime}_${batchNum}.kwub` path derived from the *loaded*
 * container, not from `entry.path`. It is not purely a concurrency
 * defense: a file whose on-disk identity disagrees with its filename
 * (a corrupted file, or one left by an aborted prior rewrite) would
 * otherwise be tombstoned at a different canonical path, leaving the
 * original oversized file untouched and charging the new tombstone's
 * size against the listed entry. The size check closes the same gap
 * for a file whose byte length drifted from what `listBatches`
 * reported. The reduction stays correct under the documented
 * single-writer contract; these checks keep it correct against stale
 * or malformed on-disk state as well.
 */
async function tombstoneOne(args: ReduceStorageSizeArgs, entry: BatchFileInfo): Promise<number> {
  const { storage, dir, codec } = args;
  const original = await loadBatch({ storage, path: entry.path, codec });
  if (original === null) {
    return 0;
  }
  if (original.batchEndTime !== entry.batchEndTime || original.batchNum !== entry.batchNum) {
    return 0;
  }
  const currentSize = await storage.fileSize({ path: entry.path });
  if (currentSize === null || currentSize !== entry.size) {
    return 0;
  }
  const tombstone = buildTombstoneBatch(codec, original);
  /**
   * Serialize before writing: a non-binary codec's tombstone container
   * can be larger than the original file, and rewriting would grow the
   * directory instead of shrinking it. Skip the write in that case.
   */
  const newSize = codec.serializeContainer(tombstone).length;
  if (newSize >= entry.size) {
    return 0;
  }
  await saveBatch({ storage, dir, codec, batch: tombstone });
  return newSize - entry.size;
}

/**
 * Reduce the total `.kwub` byte usage under `dir` to `capBytes` or
 * less by tombstoning the oldest oversized batches first.
 *
 * @returns Final total bytes after reduction. May still exceed
 *   `capBytes` if every remaining file is already a tombstone (or at
 *   / below the drop threshold) - the policy never deletes batches,
 *   only shrinks them.
 *
 * KNOWN LIMITATION: the load-modify-save cycle for each entry is
 * NOT held under a single mutex. A concurrent `saveBatch` against
 * the same path that lands between our `loadBatch` and our
 * tombstone `saveBatch` is overwritten by the tombstone. In the
 * normal dispatcher flow new batches always use fresh
 * `batchNum` / `batchEndTime` filenames so this race does not fire;
 * callers MUST NOT issue concurrent writes to an existing batch
 * file while `reduceStorageSize` is running.
 */
async function reduceStorageSize(args: ReduceStorageSizeArgs): Promise<number> {
  const { storage, dir, capBytes } = args;
  /**
   * Validate `capBytes` up-front: `NaN` would make `total <= capBytes`
   * always false and silently tombstone everything; negative or
   * fractional values lead to the same surprise. Fail loudly so the
   * caller sees the bad input instead of unexpectedly empty disk.
   */
  if (!Number.isSafeInteger(capBytes) || capBytes < 0) {
    throw new RangeError('reduceStorageSize: capBytes must be a non-negative safe integer');
  }
  const entries = await listBatches({ storage, dir });
  let total = 0;
  for (const entry of entries) {
    total += entry.size;
  }
  if (total <= capBytes) {
    return total;
  }
  for (const entry of entries) {
    if (total <= capBytes) {
      break;
    }
    if (entry.size <= BATCH_DROP_THRESHOLD_BYTES) {
      continue;
    }
    const delta = await tombstoneOne(args, entry);
    total += delta;
  }
  return total;
}

export {
  BATCH_DROP_THRESHOLD_BYTES,
  TOMBSTONE_FILE_SIZE,
  TOMBSTONE_PAYLOAD_SIZE,
  buildTombstoneBatch,
  reduceStorageSize,
};
