/**
 * Contracts for the pluggable batch-delivery layer.
 *
 * A `Transport` ships one `EncodedBatch` and classifies the outcome
 * into a typed result the send loop acts on without knowing the
 * protocol: `ok` deletes the persisted batch, `retryable` leaves it
 * for the next pass, `fatal` drops it (the server permanently
 * rejected the batch and a retry can never succeed).
 *
 * Two implementations are planned: the binary transport (the existing
 * ingress protocol, behavior-identical to the pre-seam
 * implementation) and a REST transport for the JSON codec.
 */

import type { EncodedBatch } from '../../codec/types/codec';

/**
 * Typed delivery outcome. `reason` is a terse diagnostic for internal
 * logging, never parsed.
 *
 * `ok` may carry the server's per-event receipt when the protocol
 * returns one: `received` events reached the server and `accepted` of
 * them were taken for processing. The batch is delivered either way -
 * that is what `ok` means - but a caller that chains deliveries needs
 * to tell a batch that landed from one the server took nothing out of,
 * because sending the next batch past it reorders the queue. A
 * protocol without a receipt omits both fields.
 */
type TransportResult =
  | { kind: 'ok'; received?: number; accepted?: number }
  | { kind: 'retryable'; reason: string }
  | { kind: 'fatal'; reason: string };

/**
 * Per-session context a transport needs beyond the batch itself.
 *
 * endpoint - ingress base URL.
 * apiKey - project key.
 * installId - 16-byte install UUID (all-zero for a server relay).
 * testUser - test-user marker for the current send, or null.
 * signal - abort signal; a transport must propagate cancellation
 *   instead of classifying it as a retryable failure.
 * extraHeaders - caller-supplied headers, already sanitized; reserved
 *   protocol headers always win over them.
 */
interface TransportContext {
  endpoint: string;
  apiKey: string;
  installId: Uint8Array;
  testUser: string | null;
  signal?: AbortSignal;
  extraHeaders?: Record<string, string>;
}

/** Args for `Transport.send`. `batch` - the unit to ship; `ctx` - session context. */
interface TransportSendArgs {
  batch: EncodedBatch;
  ctx: TransportContext;
}

/**
 * A batch delivery protocol. `codecId` names the codec whose payloads
 * this transport understands; the send loop pairs a loaded batch with
 * the transport whose `codecId` matches.
 *
 * `sendSync` is the optional exit-path delivery: a hand-off that
 * completes without the caller awaiting anything, for the one moment
 * a normal send cannot serve - a browser tab being torn down, where
 * no promise is guaranteed to resume. It reports only whether the
 * runtime accepted the payload for delivery, never whether the
 * server received it, so a caller must keep its persisted copy and
 * let ordinary delivery resolve the duplicate. Transports without a
 * fire-and-forget channel simply omit it.
 */
interface Transport {
  readonly codecId: string;
  send(args: TransportSendArgs): Promise<TransportResult>;
  sendSync?(args: TransportSendArgs): boolean;
}

export type { Transport, TransportContext, TransportResult, TransportSendArgs };
