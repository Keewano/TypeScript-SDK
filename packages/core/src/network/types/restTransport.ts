import type { TransportContext } from './transport';

/**
 * Types for the REST transport's response envelope.
 *
 * received - Events the server saw in the submitted batch.
 * accepted - Events that passed per-event validation. `0` with a 2xx
 *   status means the whole batch was a server-side duplicate (or out
 *   of sequence) and must not be retried.
 */
interface RestIngestReceipt {
  received: number;
  accepted: number;
}

/**
 * Args for the transport's entry validation.
 *
 * ctx - Session context whose key, tester name and install identity
 *   are checked.
 * userId - The batch's user identity, checked together with the
 *   context's install identity because the server needs at least one
 *   of the two.
 */
interface ValidateSendInputsArgs {
  ctx: TransportContext;
  userId: Uint8Array;
}

export type { RestIngestReceipt, ValidateSendInputsArgs };
