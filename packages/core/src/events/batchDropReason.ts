/**
 * Reasons that justify replacing an unsent batch with a tombstone.
 *
 * When the on-disk batch queue exceeds its size cap (50 MB), the oldest
 * batches are replaced with a small `BATCH_DROPPED` event carrying the
 * reason code. The server then knows how many user events were lost and
 * why, without having to retransmit the dropped batch contents.
 *
 * Serialized as uint32 LE on the wire as the payload of a
 * `BATCH_DROPPED` event.
 *
 * @example
 * ```ts
 * import { KBatchDropReason } from '@keewano/core';
 *
 * KBatchDropReason.BROKEN_CUSTOM_EVENT_MAPPING; // 1
 * KBatchDropReason.TOO_MANY_UNSENT_EVENTS;      // 2
 * ```
 */

/**
 * Wire-protocol drop reason codes.
 *
 * Values are uint32 on the wire.
 */
const KBatchDropReason = {
  BROKEN_CUSTOM_EVENT_MAPPING: 1,
  TOO_MANY_UNSENT_EVENTS: 2,
} as const;

/**
 * Union of all valid `KBatchDropReason` numeric values.
 */
type KBatchDropReasonValue = (typeof KBatchDropReason)[keyof typeof KBatchDropReason];

export type { KBatchDropReasonValue };
export { KBatchDropReason };
