/**
 * Disk-cap policy that replaces oversized unsent batches with
 * `BATCH_DROPPED` tombstones so the on-disk batch directory never
 * exceeds the configured byte budget.
 *
 * When `totalBytes > capBytes`, walk the batches in chronological
 * order (`(batchEndTime, batchNum)`) and rewrite each one larger
 * than {@link BATCH_DROP_THRESHOLD_BYTES} as a 70-byte tombstone:
 *   `[batchStartTime uint32 LE][BATCH_DROPPED uint16 LE][TOO_MANY_UNSENT_EVENTS uint32 LE]`
 * The tombstone keeps the original identity (UserId, DataSessionId,
 * BatchNum, BatchStartTime, BatchEndTime, CustomEventsVersion) so the
 * server can correlate the drop with the session that produced it.
 *
 * Stops as soon as the running total falls at or below `capBytes`.
 * Files already at or below {@link BATCH_DROP_THRESHOLD_BYTES} are
 * skipped because they are already tombstoned (a fresh tombstone
 * emits exactly 70 bytes).
 */

import type { BatchFileInfo, BatchRecord } from './types/kfile';
import type { ReduceStorageSizeArgs } from './types/storageCap';

import { KEvents } from '../events/kevents';
import { KBatchDropReason } from '../events/batchDropReason';

import { listBatches, loadBatch, saveBatch } from './kfile';
import { KFILE_FOOTER_SIZE } from './helpers/kfileFooter';
import { KFILE_HEADER_SIZE } from './helpers/kfileHeader';

/**
 * Bytes a fresh tombstone payload occupies: timestamp (4) +
 * eventId (2) + reason (4).
 */
const TOMBSTONE_PAYLOAD_SIZE = 10;

/**
 * Total on-disk size of a tombstoned batch file: header + tombstone
 * payload + footer. Used as the lower bound for the "is this file
 * worth rewriting?" check.
 */
const TOMBSTONE_FILE_SIZE = KFILE_HEADER_SIZE + TOMBSTONE_PAYLOAD_SIZE + KFILE_FOOTER_SIZE;

/**
 * Files at or below this size are skipped during reduction. A fresh
 * tombstone is exactly {@link TOMBSTONE_FILE_SIZE} = 70 bytes, so any
 * file at or under 70 is already a tombstone (or smaller) and would
 * not free meaningful disk space on rewrite.
 */
const BATCH_DROP_THRESHOLD_BYTES = TOMBSTONE_FILE_SIZE;

/**
 * Build the 10-byte tombstone payload that replaces the original
 * batch's event-stream. Format:
 *
 * ```
 * 0..3   timestamp  uint32 LE  (= batchStartTime)
 * 4..5   eventId    uint16 LE  (= KEvents.BATCH_DROPPED = 42)
 * 6..9   reason     uint32 LE  (= KBatchDropReason.TOO_MANY_UNSENT_EVENTS = 2)
 * ```
 */
function buildTombstonePayload(batchStartTime: number): Uint8Array {
  if (!Number.isSafeInteger(batchStartTime) || batchStartTime < 0 || batchStartTime > 0xffffffff) {
    throw new RangeError('buildTombstonePayload: batchStartTime must be a uint32');
  }
  const payload = new Uint8Array(TOMBSTONE_PAYLOAD_SIZE);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  view.setUint32(0, batchStartTime, true);
  view.setUint16(4, KEvents.BATCH_DROPPED, true);
  view.setUint32(6, KBatchDropReason.TOO_MANY_UNSENT_EVENTS, true);
  return payload;
}

/**
 * Replace `original` with a tombstone batch carrying the same
 * identity / sequence / timing / schema-version fields. Only the
 * event-stream payload differs.
 */
function buildTombstoneBatch(original: BatchRecord): BatchRecord {
  return {
    batchVersion: original.batchVersion,
    userId: original.userId,
    dataSessionId: original.dataSessionId,
    batchNum: original.batchNum,
    batchStartTime: original.batchStartTime,
    batchEndTime: original.batchEndTime,
    data: buildTombstonePayload(original.batchStartTime),
    customEventsVersion: original.customEventsVersion,
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
 * header, not from `entry.path`. It is not purely a concurrency
 * defense: a file whose on-disk header identity disagrees with its
 * filename (a corrupted file, or one left by an aborted prior rewrite)
 * would otherwise be tombstoned at a different canonical path, leaving
 * the original oversized file untouched and charging the new
 * tombstone's size against the listed entry. The size check closes the
 * same gap for a file whose byte length drifted from what `listBatches`
 * reported. The reduction stays correct under the documented
 * single-writer contract; these checks keep it correct against stale or
 * malformed on-disk state as well.
 */
async function tombstoneOne(args: ReduceStorageSizeArgs, entry: BatchFileInfo): Promise<number> {
  const { storage, dir } = args;
  const original = await loadBatch({ storage, path: entry.path });
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
  const tombstone = buildTombstoneBatch(original);
  const newSize = await saveBatch({ storage, dir, batch: tombstone });
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
  buildTombstonePayload,
  reduceStorageSize,
};
