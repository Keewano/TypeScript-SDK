/**
 * Args / state types for the batch module.
 */

import type { BatchBuilder } from '../../codec/types/codec';

/**
 * Constructor args for {@link KBatch}.
 *
 * @property installId - 16-byte install UUID. Persisted across launches.
 * @property userId - 16-byte user UUID. May be all-zero before the
 *   game sets it via `setUserId`.
 * @property dataSessionId - 16-byte session UUID, fresh per launch.
 * @property builder - Codec batch builder that owns the encoded event
 *   bytes, the cut bookkeeping, and the batch time interval.
 */
interface KBatchArgs {
  installId: Uint8Array;
  userId: Uint8Array;
  dataSessionId: Uint8Array;
  builder: BatchBuilder;
}

export type { KBatchArgs };
