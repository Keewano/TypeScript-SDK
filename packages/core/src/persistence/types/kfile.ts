/**
 * Args and record types for the `.kwub` batch-file I/O layer.
 */

import type { StorageAdapter } from '../../storage';

/**
 * Plain on-disk representation of a single batch. Intentionally
 * decoupled from F4's `KBatch` class:
 *
 * - `KBatch` carries dispatcher-only state (`installId`,
 *   `cutPositions`, the live `BinaryStream` accumulator) that has no
 *   place on disk. `installId` ships in the HTTP `K-InstallId` header,
 *   never in the `.kwub` file; `cutPositions` is purely an in-memory
 *   slice plan.
 * - Keeping persistence stateless lets a test harness or future
 *   migration tool produce a byte-identical file without instantiating
 *   a dispatcher.
 * - `KBatch` is structurally assignable to `BatchRecord` (every field
 *   below exists on `KBatch` with the same type), so F9 can hand a
 *   live `KBatch` to `saveBatch` directly when it integrates the two
 *   layers.
 *
 * batchVersion - Wire-protocol batch-format version reported by the
 *   reader. **Ignored on save:** `saveBatch` always emits the writer's
 *   current version, regardless of this field. Setting it on a record
 *   you intend to persist does NOT round-trip; the value you read
 *   back will be the current writer version.
 * userId - 16-byte Microsoft-mixed-endian GUID. The same buffer
 *   used in HTTP headers; not transformed during save / load.
 * dataSessionId - 16-byte GUID. Same encoding contract as `userId`.
 * batchNum - Monotonic batch sequence number assigned by the
 *   dispatcher. Combined with `batchEndTime` makes the on-disk
 *   filename.
 * batchStartTime - Unix seconds (UTC) when the first event was
 *   recorded into this batch. Encoded as `uint32 LE`.
 * batchEndTime - Unix seconds (UTC) when the batch was sealed.
 *   Encoded as `uint32 LE`. Used as the leading sort key for the
 *   send loop.
 * data - Raw event-stream bytes. Length is encoded separately as
 *   `int32 LE` in the header; this field is the payload only.
 * customEventsVersion - Version stamp for the custom-events schema
 *   that produced the events in `data`. Persisted as a `uint32 LE`
 *   footer after the payload.
 */
interface BatchRecord {
  batchVersion: number;
  userId: Uint8Array;
  dataSessionId: Uint8Array;
  batchNum: number;
  batchStartTime: number;
  batchEndTime: number;
  data: Uint8Array;
  customEventsVersion: number;
}

/**
 * Metadata returned by `listBatches` for each on-disk batch file.
 *
 * path - Adapter-relative path to the file (e.g. `batches/1234_5.kwub`).
 * batchEndTime - Parsed `batchEndTime` from the filename.
 * batchNum - Parsed `batchNum` from the filename.
 * size - File length in bytes, as reported by the storage adapter.
 */
interface BatchFileInfo {
  path: string;
  batchEndTime: number;
  batchNum: number;
  size: number;
}

/**
 * storage - Storage adapter that backs the on-disk batch directory.
 * dir - Adapter-relative directory under which the `.kwub` file is
 *   stored. The full path resolves to `${dir}/${batchEndTime}_${batchNum}.kwub`.
 * batch - Batch record to persist. Fields are pulled into the
 *   fixed-width binary layout; the source object is not mutated.
 */
interface SaveBatchArgs {
  storage: StorageAdapter;
  dir: string;
  batch: BatchRecord;
}

/**
 * storage - Storage adapter that backs the on-disk batch file.
 * path - Adapter-relative path to a single `.kwub` file.
 */
interface LoadBatchArgs {
  storage: StorageAdapter;
  path: string;
}

/**
 * storage - Storage adapter that backs the batch directory.
 * dir - Adapter-relative directory listed for `.kwub` files. Files
 *   whose basename does not match `<digits>_<digits>.kwub` are
 *   ignored so unrelated entries (locks, scratch siblings) cannot
 *   poison the result.
 */
interface ListBatchesArgs {
  storage: StorageAdapter;
  dir: string;
}

/**
 * storage - Storage adapter that backs the batch file.
 * path - Adapter-relative path of the `.kwub` file to remove. A
 *   missing path is a no-op per the `StorageAdapter` contract.
 */
interface DeleteBatchArgs {
  storage: StorageAdapter;
  path: string;
}

/**
 * storage - Storage adapter that backs the batch directory.
 * dir - Adapter-relative directory whose `.kwub` files are summed.
 */
interface TotalBatchSizeArgs {
  storage: StorageAdapter;
  dir: string;
}

export type {
  BatchFileInfo,
  BatchRecord,
  DeleteBatchArgs,
  ListBatchesArgs,
  LoadBatchArgs,
  SaveBatchArgs,
  TotalBatchSizeArgs,
};
