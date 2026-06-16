/**
 * Args / result types for the custom-events map sub-protocol
 * (`GET /custom` and `POST /custom`).
 */

import type { CustomEventSet } from './customEventSet';

/**
 * Tri-state result of `getCustomEventMapStatus`.
 *
 * `'known'` - Server already has the requested map version. Proceed
 *   directly to the batch send.
 * `'needs-registration'` - Server does not know this version. Caller
 *   must follow up with `registerCustomEventMap`.
 * `'error'` - Transient error (network failure, or any status that
 *   is neither 200 nor 204). Caller should retry on the next send
 *   cycle.
 */
type CustomEventMapStatus = 'known' | 'needs-registration' | 'error';

/**
 * Args bag for `getCustomEventMapStatus`.
 *
 * baseUrl - Server base URL. The path `/custom` is appended
 *   internally.
 * apiKey - Project-scoped secret sent as `K-Token`.
 * version - Custom-events map version to probe. Sent as
 *   `K-CustomEventHash` (decimal uint32).
 * signal - Optional `AbortSignal` for caller-controlled cancellation.
 * extraHeaders - Optional caller-supplied headers merged into the
 *   request. Reserved headers win a collision; each is header-safe
 *   validated.
 */
interface GetCustomEventMapStatusArgs {
  baseUrl: string;
  apiKey: string;
  version: number;
  signal?: AbortSignal;
  extraHeaders?: Record<string, string>;
}

/**
 * Args bag for `registerCustomEventMap`.
 *
 * baseUrl - Server base URL. The path `/custom` is appended
 *   internally.
 * apiKey - Project-scoped secret sent as `K-Token`.
 * ceSet - Map to register. `gzipData` is sent verbatim as the HTTP
 *   body; the server reads `Content-Encoding: gzip` to mean "the
 *   body is already gzipped - decompress before processing".
 * signal - Optional `AbortSignal` for caller-controlled cancellation.
 * extraHeaders - Optional caller-supplied headers merged into the
 *   request. Reserved headers win a collision; each is header-safe
 *   validated.
 */
interface RegisterCustomEventMapArgs {
  baseUrl: string;
  apiKey: string;
  ceSet: CustomEventSet;
  signal?: AbortSignal;
  extraHeaders?: Record<string, string>;
}

export type { CustomEventMapStatus, GetCustomEventMapStatusArgs, RegisterCustomEventMapArgs };
