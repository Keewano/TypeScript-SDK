/**
 * Batch-file I/O on top of the `StorageAdapter` contract.
 *
 * Each batch is a single file at `${dir}/${batchEndTime}_${batchNum}.kwub`
 * whose byte content is produced and parsed by the active codec's
 * container serializer. Persistence owns naming, listing, and storage
 * I/O only; the container byte layout is the codec's concern, so this
 * layer works unchanged for any batch encoding.
 *
 * Operations:
 * - `saveBatch` serializes a batch via the codec and writes it to its
 *   canonical filename via the adapter's best-effort atomic `writeFile`.
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
 * import { BinaryCodec, MemoryStorageAdapter, saveBatch, loadBatch } from '@keewano/core';
 *
 * const codec = new BinaryCodec();
 * const storage = new MemoryStorageAdapter();
 * const dir = 'batches';
 * const bytesWritten = await saveBatch({ storage, dir, codec, batch });
 * const reloaded = await loadBatch({ storage, path: 'batches/100_5.kwub', codec });
 * ```
 */

import type {
  BatchFileInfo,
  DeleteBatchArgs,
  ListBatchesArgs,
  LoadBatchArgs,
  SaveBatchArgs,
  TotalBatchSizeArgs,
} from './types/kfile';
import type { EncodedBatch } from '../codec/types/codec';

import { BATCH_FILE_EXTENSION, batchFilePath, parseBatchFilename } from './helpers/batchFilename';

/**
 * Persist `batch` to `${dir}/${batchEndTime}_${batchNum}.kwub`. The
 * byte content is whatever the codec's `serializeContainer` produces;
 * for the binary codec that is the historical container format,
 * byte-identical.
 *
 * @returns Total bytes written.
 * @throws Whatever `serializeContainer` throws on malformed input
 *   (wrong-typed identity buffers, out-of-range numeric fields) - a
 *   clear diagnostic at the boundary instead of silent byte
 *   corruption.
 */
async function saveBatch({ storage, dir, codec, batch }: SaveBatchArgs): Promise<number> {
  const bytes = codec.serializeContainer(batch);
  const path = batchFilePath({ dir, batchEndTime: batch.batchEndTime, batchNum: batch.batchNum });
  await storage.writeFile({ path, bytes });
  return bytes.length;
}

/**
 * Read a batch file and parse it via the codec. Returns `null` on a
 * missing file or any corruption (`deserializeContainer` collapses
 * every parse-failure mode into `null`), keeping call sites simple -
 * the sender loop just skips corrupted batches instead of having to
 * classify every parse error.
 */
async function loadBatch({ storage, path, codec }: LoadBatchArgs): Promise<EncodedBatch | null> {
  const bytes = await storage.readFile({ path });
  if (bytes === null) {
    return null;
  }
  /**
   * The Codec contract requires `deserializeContainer` to return
   * `null` on corruption, but a non-conforming codec that throws must
   * not break loadBatch's documented never-throws contract - collapse
   * the throw into the same `null` the callers already handle.
   */
  try {
    return codec.deserializeContainer(bytes);
  } catch {
    return null;
  }
}

/**
 * Enumerate the batch directory and return one entry per file matching
 * `<digits>_<digits>.kwub`. Sorted ascending by `(batchEndTime,
 * batchNum)` so the caller can walk chronologically without an
 * intermediate sort step.
 *
 * Files whose `fileSize` query returns `null` (vanished between
 * listing and stat) OR rejects (present but unreadable - EACCES /
 * EIO / EMFILE on an SDK-owned file) are silently skipped - one bad
 * file never throws out of here and hides every other valid batch
 * from the ship / delete / cap passes. The next pass picks it up if
 * it recovers.
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
  /**
   * `allSettled`, not `all`: a single rejecting `fileSize` (a present
   * but unreadable .kwub) would otherwise reject the whole listing and
   * starve ship / delete / cap of every other valid batch. A rejected
   * or null size skips just that one entry.
   */
  const sizes = await Promise.allSettled(
    parsedEntries.map((entry) => storage.fileSize({ path: entry.path })),
  );
  const out: BatchFileInfo[] = [];
  for (let i = 0; i < parsedEntries.length; i += 1) {
    const settled = sizes[i];
    const entry = parsedEntries[i];
    if (entry === undefined || settled?.status !== 'fulfilled') {
      continue;
    }
    const size = settled.value;
    if (size === null || size === undefined) {
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

export { deleteBatch, listBatches, loadBatch, saveBatch, totalBatchSize };
