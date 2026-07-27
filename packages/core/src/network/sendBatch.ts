/**
 * `POST /in` - submit a single batch to the Keewano ingress endpoint.
 *
 * The body is the raw event-stream bytes (NOT a `.kwub` container);
 * the batch identity / sequence / timing metadata travels in K-*
 * HTTP headers. The server reconstructs everything it needs from the
 * headers + body without any in-body framing.
 *
 * Headers emitted on every call:
 *   Content-Type: application/octet-stream
 *   K-InstallId, K-Uid, K-DS (UUID "D" strings, lowercase hyphenated)
 *   K-Batch, K-BatchStartTime, K-BatchEndTime, K-BatchVersion,
 *   K-CustomEventHash (decimal strings)
 *   K-Token (API key)
 *   K-SDK (SDK identifier + version)
 *
 * Plus, conditionally:
 *   K-Tester - only when a non-null, non-empty `testUser` is passed
 *
 * K-InstallId is all-zero for a server-relay batch (a server-side event
 * has no install identity, and an all-zero id is how the server
 * recognizes one) and a real, non-zero id for a device SDK.
 *
 * The transport never imposes a timeout. Callers that need one wire
 * an `AbortSignal` in via the `signal` arg.
 */

import type { SendBatchArgs, SendBatchInput } from './types/sendBatch';

import { assertIntInRange, assertNonZeroBytes, assertUint8Array } from '../encoding/assertions';
import { uuidBytesToString } from '../encoding/uuid';
import { LIMITS } from '../encoding/limits';
import { assertHeaderValue } from './helpers/assertHeaderValue';
import { CONTENT_TYPE_OCTET_STREAM, ENDPOINT_PATH } from './helpers/constants';
import { isAbortError } from './helpers/isAbortError';
import { joinEndpoint } from './helpers/joinEndpoint';
import { mergeExtraHeaders } from './helpers/mergeExtraHeaders';
import { releaseResponseBody } from './helpers/releaseResponseBody';
import { resolveSdkTag } from './helpers/sdkTag';
import { resolveTransportFetch } from './transportFetch';

/** Byte length of a single mixed-endian UUID buffer. */
const UUID_SIZE = 16;

/**
 * Validate every field of a `SendBatchInput` at the public boundary.
 *
 * `dataSessionId` is checked twice: first for type and length
 * (`assertUint8Array`), then for the all-zero corruption pattern
 * (`assertNonZeroBytes`), which the SDK never legitimately produces.
 * `installId` is only length-checked: an all-zero installId is the
 * legitimate server-relay sentinel (a server-side event has no install
 * identity), while a device SDK validates its install id non-zero at
 * load time, so failing closed on zero here would reject relay batches.
 *
 * `userId` is only length-checked. Zero is the documented
 * "no developer-supplied user identity yet" marker on this wire
 * protocol and the server relies on it for some attribution paths,
 * so the transport must let the marker through verbatim.
 *
 * The remaining fields (payload buffer and the numeric header
 * fields) surface `TypeError` / `RangeError` eagerly instead of
 * letting a malformed batch slip through to a header like
 * `K-Batch: NaN` (which the server would reject as a transport
 * failure, prompting pointless retries from the orchestration
 * layer).
 */
function validateSendBatchInput(batch: SendBatchInput): void {
  /**
   * No non-zero check: an all-zero installId is the legitimate
   * server-relay sentinel (a server-side event has no install identity).
   * A device SDK validates its install id non-zero at load time.
   */
  assertUint8Array({
    expectedLength: UUID_SIZE,
    fnName: 'sendBatch: batch.installId',
    value: batch.installId,
  });
  assertUint8Array({
    expectedLength: UUID_SIZE,
    fnName: 'sendBatch: batch.userId',
    value: batch.userId,
  });
  assertUint8Array({
    expectedLength: UUID_SIZE,
    fnName: 'sendBatch: batch.dataSessionId',
    value: batch.dataSessionId,
  });
  assertNonZeroBytes({ bytes: batch.dataSessionId, fnName: 'sendBatch: batch.dataSessionId' });
  assertUint8Array({ fnName: 'sendBatch: batch.data', value: batch.data });
  assertIntInRange({
    fnName: 'sendBatch: batch.batchNum',
    max: LIMITS.INT32_MAX,
    min: 0,
    n: batch.batchNum,
  });
  assertIntInRange({
    fnName: 'sendBatch: batch.batchStartTime',
    max: LIMITS.UINT32_MAX,
    min: 0,
    n: batch.batchStartTime,
  });
  assertIntInRange({
    fnName: 'sendBatch: batch.batchEndTime',
    max: LIMITS.UINT32_MAX,
    min: 0,
    n: batch.batchEndTime,
  });
  if (batch.batchEndTime < batch.batchStartTime) {
    throw new RangeError('sendBatch: batchEndTime before batchStartTime');
  }
  assertIntInRange({
    fnName: 'sendBatch: batch.batchVersion',
    max: LIMITS.UINT32_MAX,
    min: 0,
    n: batch.batchVersion,
  });
  assertIntInRange({
    fnName: 'sendBatch: batch.customEventsVersion',
    max: LIMITS.UINT32_MAX,
    min: 0,
    n: batch.customEventsVersion,
  });
}

/**
 * Args bag for the private {@link buildSendBatchHeaders} helper.
 *
 * batch - Batch identity and metadata to emit as K-* headers.
 * apiKey - Project-scoped secret sent as `K-Token`.
 * testUser - Test-user marker. When non-null and non-empty, adds
 *   the `K-Tester` header. `null` or `undefined` mean the header
 *   is absent. The field is required (not `?`) so the caller has
 *   to make an explicit choice under `exactOptionalPropertyTypes`.
 */
interface BuildSendBatchHeadersArgs {
  batch: SendBatchInput;
  apiKey: string;
  testUser: string | null | undefined;
}

/**
 * Build the K-* headers (plus `Content-Type`) for `POST /in`. Header
 * insertion order is pinned so byte-comparable wire-format test vectors
 * remain stable across builds. `K-InstallId` is always emitted (all-zero
 * for a server-relay batch); `K-Tester` is added only when a tester is
 * set.
 *
 * Assumes the caller has already run `validateSendBatchInput`, so every
 * UUID buffer is 16 bytes (and non-zero where required) by the time
 * `uuidBytesToString` runs here.
 */
function buildSendBatchHeaders({
  batch,
  apiKey,
  testUser,
}: BuildSendBatchHeadersArgs): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': CONTENT_TYPE_OCTET_STREAM,
    'K-InstallId': uuidBytesToString(batch.installId),
    'K-Uid': uuidBytesToString(batch.userId),
    'K-DS': uuidBytesToString(batch.dataSessionId),
    'K-Batch': String(batch.batchNum),
    'K-BatchStartTime': String(batch.batchStartTime),
    'K-BatchEndTime': String(batch.batchEndTime),
    'K-BatchVersion': String(batch.batchVersion),
    'K-CustomEventHash': String(batch.customEventsVersion),
  };
  /**
   * `K-Tester` lands between `K-CustomEventHash` and `K-Token` to
   * keep the wire-format header order pinned.
   */
  if (testUser != null && testUser.length > 0) {
    headers['K-Tester'] = testUser;
  }
  headers['K-Token'] = apiKey;
  headers['K-SDK'] = resolveSdkTag();
  return headers;
}

/**
 * Submit a batch to `POST {baseUrl}/in`.
 *
 * @returns `true` on any 2xx response, `false` on non-2xx response or
 *   network error. Failures are intentionally collapsed into `false`
 *   so the send loop can treat them uniformly (retry next cycle).
 * @throws TypeError when any UUID buffer is not a 16-byte
 *   `Uint8Array`, when `dataSessionId` is the all-zero corruption
 *   pattern (`installId` all-zero is the legitimate server-relay
 *   sentinel, and `userId` zero is the legitimate "no developer-supplied
 *   user" marker - both allowed), or when `batch.data` is not a
 *   `Uint8Array`.
 * @throws RangeError when any of `batchNum`, `batchStartTime`,
 *   `batchEndTime`, `batchVersion`, `customEventsVersion` falls
 *   outside its wire-format integer range.
 * @throws TypeError when `baseUrl` is empty or otherwise malformed,
 *   when `apiKey` or a non-null `testUser` is empty (apiKey only),
 *   has surrounding whitespace, contains an ASCII control
 *   character, or contains a non-ByteString character.
 *   Configuration-bug throws are deliberately surfaced (not caught
 *   by the transport-failure handler below) so a permanent
 *   misconfiguration cannot masquerade as a transient retry.
 * @throws Whatever `fetch` rejected with when the caller cancels via
 *   `signal` (an `Error`/`DOMException` named `'AbortError'` or
 *   `'TimeoutError'`). Both cancellation shapes propagate rather
 *   than collapse into `false`, so the orchestration layer does
 *   not retry a batch the caller asked to stop or timed out.
 */
async function sendBatch(args: SendBatchArgs): Promise<boolean> {
  const { baseUrl, apiKey, batch, testUser, signal, extraHeaders } = args;
  assertHeaderValue({ value: apiKey, fnName: 'sendBatch', field: 'apiKey', allowEmpty: false });
  if (testUser != null) {
    assertHeaderValue({
      value: testUser,
      fnName: 'sendBatch',
      field: 'testUser',
      allowEmpty: true,
    });
  }
  validateSendBatchInput(batch);
  const headers = mergeExtraHeaders({
    reserved: buildSendBatchHeaders({ batch, apiKey, testUser }),
    extra: extraHeaders,
    fnName: 'sendBatch',
  });
  const url = joinEndpoint({ baseUrl, path: ENDPOINT_PATH.IN });
  /**
   * `signal` is omitted from `RequestInit` when undefined to satisfy
   * `exactOptionalPropertyTypes: true` - `fetch`'s `signal` is typed
   * as `AbortSignal | null`, not `AbortSignal | undefined`.
   *
   * `fetch` accepts `Uint8Array` at runtime as a `BufferSource`, but
   * TS 5.7+ narrows `Uint8Array<ArrayBufferLike>` too strictly against
   * the `BodyInit` union. The cast pins the runtime contract without
   * copying the bytes.
   */
  /**
   * `redirect: 'error'` forces `fetch` to reject on any 3xx
   * response. The transport carries `K-Token` (the API key) plus
   * the install / user / data-session UUIDs in headers; default
   * redirect-following would forward those secrets to whatever URL
   * the response advertises. Fail closed instead.
   *
   * `credentials: 'omit'` suppresses ambient cookies and HTTP
   * authentication. Authentication is carried exclusively by the
   * `K-Token` header; letting `fetch` attach the runtime's stored
   * cookies (or platform-level Basic-Auth) would leak unrelated
   * session material to the ingress endpoint on every batch.
   *
   * `cache: 'no-store'` defeats HTTP cache layers and tells
   * service workers not to satisfy this request from cache or
   * write it back. The endpoint URL is the constant `/in`; the
   * batch identity rides in K-* headers, so a URL-keyed cache
   * could otherwise replay a previous batch's 2xx response and
   * make the SDK believe a never-sent batch was delivered.
   *
   * `referrerPolicy: 'no-referrer'` suppresses the `Referer`
   * header that browser-based runtimes (Expo for web) would
   * otherwise attach with the host app's origin or URL. The
   * analytics endpoint has no use for that metadata and the host
   * has not asked us to leak it.
   *
   * After a successful `fetch`, the response body is released via
   * `releaseResponseBody` so the underlying socket returns to the
   * HTTP pool. Without this, undici / Node native fetch keep the
   * connection busy until GC reclaims the unread body, and under
   * load that backpressure can stall subsequent batch uploads.
   */
  const init: RequestInit = {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers,
    body: batch.data as BodyInit,
    ...(signal === undefined ? {} : { signal }),
  };
  try {
    const response = await resolveTransportFetch().call(globalThis, url, init);
    /*
     * Capture the HTTP result BEFORE attempting body release so
     * the HTTP outcome the caller sees is exactly the HTTP
     * outcome. The release helper is contracted to never throw,
     * but the dedicated try / catch around it is belt-and-
     * suspenders: even if a future regression let an error
     * escape the helper, that error must not flow into the outer
     * catch and turn a delivered batch into a `false` (which the
     * orchestration layer would retry against a server that
     * already accepted the batch).
     */
    const ok = response.ok;
    try {
      await releaseResponseBody(response);
    } catch {
      /* Best-effort cleanup only; preserve the real HTTP result. */
    }
    return ok;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return false;
  }
}

export { sendBatch };
