/**
 * Batch-file persistence layer. Wraps the `StorageAdapter` contract
 * with the `.kwub` byte format and the disk-cap tombstone policy.
 *
 * The on-disk layout follows the canonical wire format so files
 * captured by any compliant writer can be replayed against the same
 * server.
 *
 * Byte-format internals (FourCC, header / footer / filename codecs,
 * tombstone sizing, the pure `decodeBatch`) stay in their impl files
 * and are NOT re-exported here. They are implementation details of the
 * `.kwub` layout, mirroring the same rule the encoding and dispatcher
 * barrels apply to their wire constants. Their impl modules keep them
 * exported only so the in-module conformance tests can assert on raw
 * byte values - do not reach for them through deep import paths.
 */

export type {
  BatchFileInfo,
  DeleteBatchArgs,
  ListBatchesArgs,
  LoadBatchArgs,
  SaveBatchArgs,
  TotalBatchSizeArgs,
} from './types/kfile';
export type { ReduceStorageSizeArgs } from './types/storageCap';

/**
 * UUID byte length. Re-exported as a shared primitive (identity, network,
 * and the platform packages all build 16-byte identity buffers from it);
 * it is not a `.kwub`-specific byte-format internal.
 */
export { UUID_SIZE } from './helpers/kfileHeader';

export { deleteBatch, listBatches, loadBatch, saveBatch, totalBatchSize } from './kfile';
export { reduceStorageSize } from './storageCap';
