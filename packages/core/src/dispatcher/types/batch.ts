/**
 * Args / state types for the batch module.
 */

/**
 * A position in the in-batch byte stream at which the send loop is
 * allowed to slice the accumulated events into a separate on-disk
 * batch file. Recorded by `sendIfNeeded` whenever the in-batch grows
 * by at least `THRESHOLDS.CUT` bytes since the previous cut, so that
 * very large bursts split into multiple files instead of one
 * oversized blob.
 *
 * @property pos - Byte offset within `KBatch.data` where the cut lands.
 *   Equal to `data.length` at the moment the threshold was crossed.
 * @property lastEventTime - Unix-seconds timestamp of the last event
 *   that was written before the cut. Becomes the next sub-batch's
 *   `batchStartTime` after the cut is consumed.
 */
interface CutPoint {
  pos: number;
  lastEventTime: number;
}

/**
 * Constructor args for {@link KBatch}.
 *
 * @property installId - 16-byte install GUID. Persisted across launches.
 * @property userId - 16-byte user GUID. May be all-zero before the
 *   game sets it via `setUserId`.
 * @property dataSessionId - 16-byte session GUID, fresh per launch.
 */
interface KBatchArgs {
  installId: Uint8Array;
  userId: Uint8Array;
  dataSessionId: Uint8Array;
}

export type { CutPoint, KBatchArgs };
