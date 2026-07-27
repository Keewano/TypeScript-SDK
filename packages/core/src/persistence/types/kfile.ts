/**
 * Args and record types for the batch-file I/O layer.
 *
 * The persisted unit is the codec's `EncodedBatch`; persistence owns
 * only file naming, directory listing, and storage I/O. The container
 * byte layout lives behind `Codec.serializeContainer` /
 * `Codec.deserializeContainer`, so this layer stays format-agnostic.
 */

import type { Codec, EncodedBatch } from '../../codec/types/codec';
import type { StorageAdapter } from '../../storage';

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
 * dir - Adapter-relative directory under which the batch file is
 *   stored. The full path resolves to `${dir}/${batchEndTime}_${batchNum}.kwub`.
 * codec - Codec whose `serializeContainer` produces the stored bytes.
 * batch - Batch to persist. The source object is not mutated.
 */
interface SaveBatchArgs {
  storage: StorageAdapter;
  dir: string;
  codec: Codec;
  batch: EncodedBatch;
}

/**
 * storage - Storage adapter that backs the on-disk batch file.
 * path - Adapter-relative path to a single batch file.
 * codec - Codec whose `deserializeContainer` parses the stored bytes.
 */
interface LoadBatchArgs {
  storage: StorageAdapter;
  path: string;
  codec: Codec;
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
  DeleteBatchArgs,
  ListBatchesArgs,
  LoadBatchArgs,
  SaveBatchArgs,
  TotalBatchSizeArgs,
};
