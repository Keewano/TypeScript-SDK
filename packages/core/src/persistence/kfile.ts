/**
 * `.kwub` batch-file I/O on top of the `StorageAdapter` contract.
 *
 * Each batch is a single file at `${dir}/${batchEndTime}_${batchNum}.kwub`
 * with a 56-byte header, a payload of length `DataSize`, and a
 * 4-byte footer (CustomEventsVersion). Total file size is
 * `60 + DataSize` bytes. The layout follows the canonical wire format
 * so files produced by any compliant writer are interchangeable.
 *
 * Operations:
 * - `saveBatch` writes a batch to its canonical filename via the
 *   adapter's best-effort atomic `writeFile`.
 * - `loadBatch` reads a single file and returns `null` on missing /
 *   corrupted contents. The reader never throws: a corrupted batch
 *   collapses into a `null` result so the send loop can skip it.
 * - `listBatches` enumerates the batch directory in `(endTime, batchNum)`
 *   order so the send loop walks chronologically.
 * - `deleteBatch` removes a single file (idempotent via the adapter).
 * - `totalBatchSize` sums the sizes of valid batch files.
 *
 * @example
 * ```ts
 * import { MemoryStorageAdapter, saveBatch, loadBatch } from '@keewano/core';
 *
 * const storage = new MemoryStorageAdapter();
 * const dir = 'batches';
 * const bytesWritten = await saveBatch({ storage, dir, batch });
 * const reloaded = await loadBatch({ storage, path: 'batches/100_5.kwub' });
 * ```
 */

import type {
  BatchFileInfo,
  BatchRecord,
  DeleteBatchArgs,
  ListBatchesArgs,
  LoadBatchArgs,
  SaveBatchArgs,
  TotalBatchSizeArgs,
} from './types/kfile';

import { BATCH_FILE_EXTENSION, batchFilePath, parseBatchFilename } from './helpers/batchFilename';
import { KFILE_FOOTER_SIZE, writeKFileFooter } from './helpers/kfileFooter';
import {
  CURRENT_BATCH_VERSION,
  KFILE_HEADER_SIZE,
  readKFileHeader,
  writeKFileHeader,
} from './helpers/kfileHeader';

/**
 * Persist `batch` to `${dir}/${batchEndTime}_${batchNum}.kwub`. The
 * writer always emits the current batch-protocol version, regardless
 * of `batch.batchVersion` - the field exists for the LOAD path and
 * is intentionally ignored here (see `BatchRecord` JSDoc).
 *
 * @returns Total bytes written (header + payload + footer).
 * @throws TypeError when `batch.data`, `batch.userId`, or
 *   `batch.dataSessionId` is not a `Uint8Array` (caller passed a
 *   regular array or string instead - we want a clear diagnostic
 *   at the boundary instead of silent byte corruption from
 *   `Uint8Array.prototype.set` accepting ArrayLike inputs).
 */
async function saveBatch({ storage, dir, batch }: SaveBatchArgs): Promise<number> {
  if (!(batch.data instanceof Uint8Array)) {
    throw new TypeError('saveBatch: batch.data must be a Uint8Array');
  }
  if (!(batch.userId instanceof Uint8Array)) {
    throw new TypeError('saveBatch: batch.userId must be a Uint8Array');
  }
  if (!(batch.dataSessionId instanceof Uint8Array)) {
    throw new TypeError('saveBatch: batch.dataSessionId must be a Uint8Array');
  }
  const header = writeKFileHeader({
    batchVersion: CURRENT_BATCH_VERSION,
    userId: batch.userId,
    dataSessionId: batch.dataSessionId,
    batchNum: batch.batchNum,
    batchStartTime: batch.batchStartTime,
    batchEndTime: batch.batchEndTime,
    dataSize: batch.data.length,
  });
  const footer = writeKFileFooter(batch.customEventsVersion);
  const total = KFILE_HEADER_SIZE + batch.data.length + KFILE_FOOTER_SIZE;
  const bytes = new Uint8Array(total);
  bytes.set(header, 0);
  bytes.set(batch.data, KFILE_HEADER_SIZE);
  bytes.set(footer, KFILE_HEADER_SIZE + batch.data.length);
  const path = batchFilePath({ dir, batchEndTime: batch.batchEndTime, batchNum: batch.batchNum });
  await storage.writeFile({ path, bytes });
  return total;
}

/**
 * Read a `.kwub` file and parse it into a `BatchRecord`. Returns
 * `null` on:
 * - missing file,
 * - truncation (too short for header / payload / footer),
 * - bad FourCC,
 * - unsupported `BatchVersion`,
 * - inconsistent `DataSize` (negative or pointing past EOF).
 *
 * Collapsing every failure mode into a single `null` result keeps
 * the call sites simple - the sender loop just skips corrupted
 * batches instead of having to classify every parse error.
 */
async function loadBatch({ storage, path }: LoadBatchArgs): Promise<BatchRecord | null> {
  const bytes = await storage.readFile({ path });
  if (bytes === null) {
    return null;
  }
  return decodeBatch(bytes);
}

/**
 * Pure in-memory decode of a `.kwub` byte buffer. Split out so the
 * `loadBatch` test can exercise corruption paths without dragging a
 * `StorageAdapter` fake along. Exported for the in-module conformance
 * tests only - it is deliberately NOT re-exported from the package
 * barrel, so the `.kwub` layout stays free to change.
 */
function decodeBatch(bytes: Uint8Array): BatchRecord | null {
  const header = readKFileHeader(bytes);
  if (header === null) {
    return null;
  }
  const payloadStart = KFILE_HEADER_SIZE;
  const payloadEnd = payloadStart + header.dataSize;
  const footerEnd = payloadEnd + KFILE_FOOTER_SIZE;
  /**
   * Require an exact length match instead of merely "at least enough".
   * Trailing garbage past the declared footer means the file is either
   * truncated mid-write, concatenated with foreign content, or carries
   * a `dataSize` that disagrees with the on-disk length. Any of those
   * makes the batch unsafe to ship, so reject it the same way as a
   * short read.
   */
  if (footerEnd !== bytes.length) {
    return null;
  }
  /**
   * Slice the payload into an owned buffer so the caller can keep it
   * past the lifetime of the parent `bytes` view (the storage adapter
   * may reuse internal buffers between reads on some runtimes).
   */
  const data = bytes.slice(payloadStart, payloadEnd);
  /**
   * Footer is guaranteed to be exactly `KFILE_FOOTER_SIZE` bytes
   * thanks to the exact-length guard above, so `readKFileFooter`
   * cannot return `null` at this point and the non-null result is
   * structurally enforced.
   */
  const footerView = new DataView(bytes.buffer, bytes.byteOffset + payloadEnd, KFILE_FOOTER_SIZE);
  const customEventsVersion = footerView.getUint32(0, true);
  return {
    batchVersion: header.batchVersion,
    userId: header.userId,
    dataSessionId: header.dataSessionId,
    batchNum: header.batchNum,
    batchStartTime: header.batchStartTime,
    batchEndTime: header.batchEndTime,
    data,
    customEventsVersion,
  };
}

/**
 * Enumerate the batch directory and return one entry per file matching
 * `<digits>_<digits>.kwub`. Sorted ascending by `(batchEndTime,
 * batchNum)` so the caller can walk chronologically without an
 * intermediate sort step.
 *
 * Files whose `fileSize` query returns `null` (vanished between
 * listing and stat) are silently dropped - the next pass will pick
 * them up if they reappear, or skip them permanently if they were a
 * concurrent removal.
 */
async function listBatches({ storage, dir }: ListBatchesArgs): Promise<BatchFileInfo[]> {
  const names = await storage.listFiles({ dir, pattern: `*${BATCH_FILE_EXTENSION}` });
  /**
   * Parse first (cheap, sync), then fan out `fileSize` lookups in
   * parallel via `Promise.all`. Serial `await` in the loop would
   * pay the storage round-trip per entry; parallel keeps the wall-
   * clock close to a single round-trip even for hundreds of batches.
   * Order is restored by the lexicographic sort below.
   */
  const parsedEntries: { path: string; batchEndTime: number; batchNum: number }[] = [];
  for (const basename of names) {
    const parsed = parseBatchFilename(basename);
    if (parsed === null) {
      continue;
    }
    parsedEntries.push({
      path: batchFilePath({
        dir,
        batchEndTime: parsed.batchEndTime,
        batchNum: parsed.batchNum,
      }),
      batchEndTime: parsed.batchEndTime,
      batchNum: parsed.batchNum,
    });
  }
  const sizes = await Promise.all(
    parsedEntries.map((entry) => storage.fileSize({ path: entry.path })),
  );
  const out: BatchFileInfo[] = [];
  for (let i = 0; i < parsedEntries.length; i += 1) {
    const size = sizes[i];
    const entry = parsedEntries[i];
    if (size === null || size === undefined || entry === undefined) {
      continue;
    }
    out.push({
      path: entry.path,
      batchEndTime: entry.batchEndTime,
      batchNum: entry.batchNum,
      size,
    });
  }
  out.sort((a, b) => {
    if (a.batchEndTime !== b.batchEndTime) {
      return a.batchEndTime - b.batchEndTime;
    }
    return a.batchNum - b.batchNum;
  });
  return out;
}

/**
 * Idempotent delete. The underlying `StorageAdapter.deleteFile` is
 * idempotent on missing paths; this wrapper exists for symmetry with
 * the rest of the persistence surface.
 */
async function deleteBatch({ storage, path }: DeleteBatchArgs): Promise<void> {
  await storage.deleteFile({ path });
}

/**
 * Sum the byte sizes of all valid batch files under `dir`. Vanished
 * files are silently skipped; foreign files (not matching the batch
 * naming convention) are ignored.
 */
async function totalBatchSize({ storage, dir }: TotalBatchSizeArgs): Promise<number> {
  const entries = await listBatches({ storage, dir });
  let total = 0;
  for (const entry of entries) {
    total += entry.size;
  }
  return total;
}

export { decodeBatch, deleteBatch, listBatches, loadBatch, saveBatch, totalBatchSize };
