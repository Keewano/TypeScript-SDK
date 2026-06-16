/**
 * In-memory accumulator for one batch's worth of event-stream bytes.
 *
 * A `KBatch` holds the identity context (install / user / data-session
 * GUIDs), the wire-protocol version stamp, batch sequencing metadata
 * (number, start / end timestamps), the variable-sized event-stream
 * payload, and the cut-point list used by the send loop to slice an
 * oversized in-flight batch into multiple on-disk files.
 *
 * The dispatcher owns two `KBatch` instances at all times: `inBatch`
 * (accumulates new events) and `sendingBatch` (frozen snapshot being
 * persisted / shipped). They are swapped atomically by `swapBatches`.
 *
 * @example
 * ```ts
 * const batch = new KBatch({
 *   installId: install,
 *   userId: user,
 *   dataSessionId: session,
 * });
 *
 * batch.data.writeUint32LE(timestamp);
 * batch.data.writeUint16LE(KEvents.BUTTON_CLICK);
 * batch.data.writeString('Play');
 * ```
 */

import type { CutPoint, KBatchArgs } from './types/batch';

import { BinaryStream } from '../encoding/binaryStream';

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
  data: BinaryStream;
  customEventsVersion: number;
  batchStartTime: number;
  batchEndTime: number;
  batchVersion: number;
  cutPositions: CutPoint[];

  /**
   * Construct an empty batch bound to the given identity GUIDs.
   *
   * `customEventsVersion` defaults to `0`, which is the wire-protocol
   * sentinel meaning "no custom-events schema registered". The host
   * application overwrites it after loading or uploading the schema
   * via the storage / network layer.
   */
  constructor({ installId, userId, dataSessionId }: KBatchArgs) {
    this.installId = installId;
    this.userId = userId;
    this.dataSessionId = dataSessionId;
    this.batchNum = 0;
    this.data = new BinaryStream();
    this.customEventsVersion = 0;
    this.batchStartTime = 0;
    this.batchEndTime = 0;
    this.batchVersion = CURRENT_BATCH_VERSION;
    this.cutPositions = [];
  }

  /**
   * Reset the accumulator to the post-swap empty state without
   * dropping the install / user / session identity or reallocating
   * the underlying byte buffer.
   *
   * @returns This batch for chaining.
   */
  resetForReuse(): this {
    this.batchNum = 0;
    this.data.reset();
    this.cutPositions = [];
    this.batchStartTime = 0;
    this.batchEndTime = 0;
    return this;
  }
}

export type { CutPoint, KBatchArgs } from './types/batch';
export { CURRENT_BATCH_VERSION, KBatch };
