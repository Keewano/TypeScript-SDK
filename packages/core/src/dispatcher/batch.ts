/**
 * Per-batch state for one side of the dispatcher's double buffer.
 *
 * A `KBatch` binds the identity context (install / user / data-session
 * UUIDs), the wire-protocol version stamp, the custom-events schema
 * version, and the sequencing number to a codec `BatchBuilder` that
 * owns the encoded event bytes, the cut bookkeeping, and the batch
 * time interval.
 *
 * The dispatcher owns two `KBatch` instances at all times: `inBatch`
 * (accumulates new events through its builder) and `sendingBatch`
 * (frozen snapshot being persisted / shipped). They are swapped
 * atomically by `swapBatches`.
 */

import type { KBatchArgs } from './types/batch';
import type { BatchBuilder } from '../codec/types/codec';

/**
 * Wire-protocol batch-format version emitted on disk and read back.
 *
 * Bumped when the on-disk batch layout changes in a way that would
 * confuse older readers. The server-side decoder accepts both versions
 * 1 and 2; this writer always emits 2.
 */
const CURRENT_BATCH_VERSION = 2;

class KBatch {
  installId: Uint8Array;
  userId: Uint8Array;
  dataSessionId: Uint8Array;
  batchNum: number;
  builder: BatchBuilder;
  customEventsVersion: number;
  batchVersion: number;

  /**
   * Construct an empty batch bound to the given identity UUIDs and
   * codec builder.
   *
   * `customEventsVersion` defaults to `0`, which is the wire-protocol
   * sentinel meaning "no custom-events schema registered". The host
   * application overwrites it after loading or uploading the schema
   * via the storage / network layer.
   */
  constructor({ installId, userId, dataSessionId, builder }: KBatchArgs) {
    this.installId = installId;
    this.userId = userId;
    this.dataSessionId = dataSessionId;
    this.batchNum = 0;
    this.builder = builder;
    this.customEventsVersion = 0;
    this.batchVersion = CURRENT_BATCH_VERSION;
  }

  /** Encoded byte size accumulated in the builder so far. */
  byteSize(): number {
    return this.builder.byteSize();
  }

  /**
   * Reset the accumulator to the post-swap empty state without
   * dropping the install / user / session identity or the builder.
   *
   * @returns This batch for chaining.
   */
  resetForReuse(): this {
    this.batchNum = 0;
    this.builder.reset();
    return this;
  }
}

export type { KBatchArgs } from './types/batch';
export { CURRENT_BATCH_VERSION, KBatch };
