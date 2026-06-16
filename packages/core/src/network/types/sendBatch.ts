/**
 * Args / input types for the `sendBatch` transport function.
 */

/**
 * HTTP-layer view of a batch. Kept distinct from `BatchRecord` (the
 * on-disk shape) so the network layer never grows an accidental
 * coupling to disk persistence. `installId` lives here because it
 * travels in the `K-InstallId` header but never lands in a `.kwub`
 * file - the asymmetry is carried explicitly.
 *
 * installId - 16-byte mixed-endian GUID for the persistent install
 *   identity. Sent as `K-InstallId`.
 * userId - 16-byte GUID for the developer-assigned user. Zero-filled
 *   when not set. Sent as `K-Uid`.
 * dataSessionId - 16-byte GUID for the per-launch session. Sent as
 *   `K-DS`.
 * batchNum - Monotonic batch sequence per process. Sent as `K-Batch`
 *   (decimal int32).
 * batchStartTime - Unix seconds UTC of the first event in the batch.
 *   Sent as `K-BatchStartTime` (decimal uint32).
 * batchEndTime - Unix seconds UTC when the batch was sealed. Sent as
 *   `K-BatchEndTime` (decimal uint32).
 * batchVersion - Wire-format batch-protocol version. Sent as
 *   `K-BatchVersion` (decimal uint32). Writer emits 2; reader accepts
 *   1 and 2.
 * customEventsVersion - FNV-1a 32-bit hash of the custom-events map
 *   referenced by this batch's events, or 0 when the batch carries
 *   no custom events. Sent as `K-CustomEventHash`.
 * data - Raw event-stream bytes. Sent as the HTTP body verbatim; the
 *   K-* headers carry every metadata field, so the body is payload
 *   only (no `.kwub` container).
 */
interface SendBatchInput {
  installId: Uint8Array;
  userId: Uint8Array;
  dataSessionId: Uint8Array;
  batchNum: number;
  batchStartTime: number;
  batchEndTime: number;
  batchVersion: number;
  customEventsVersion: number;
  data: Uint8Array;
}

/**
 * Args bag for `sendBatch`.
 *
 * baseUrl - Server base URL (for example
 *   `https://api.keewano.com/event/ingress/v1/data`). The path `/in`
 *   is appended internally; trailing slashes on `baseUrl` are
 *   normalized.
 * apiKey - Project-scoped secret sent as `K-Token`. Treated as opaque
 *   by this layer.
 * batch - Batch identity / metadata / payload to submit.
 * testUser - Optional test-user marker. When non-null and non-empty,
 *   a `K-Tester` header is added with this value. Otherwise the
 *   header is absent.
 * signal - Optional `AbortSignal` for caller-controlled cancellation
 *   or timeout. The transport layer imposes no built-in timeout -
 *   that policy belongs to the orchestrating send loop.
 * extraHeaders - Optional caller-supplied headers merged into the
 *   request (for example an auth header to clear a proxy in front of
 *   a staging endpoint). Reserved K-* / Content-* headers always win
 *   a name collision; each name and value is validated as header-safe.
 */
interface SendBatchArgs {
  baseUrl: string;
  apiKey: string;
  batch: SendBatchInput;
  testUser?: string | null;
  signal?: AbortSignal;
  extraHeaders?: Record<string, string>;
}

export type { SendBatchArgs, SendBatchInput };
