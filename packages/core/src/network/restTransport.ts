/**
 * The REST implementation of the `Transport` contract: ships an
 * `EncodedBatch` produced by the JSON codec to the JSON ingestion API
 * (`POST <endpoint>/event/ingress/v1/json/in?k-token=<key>`).
 *
 * Envelope rules (per the backend's published example and answers):
 * - The API key travels as the `k-token` query parameter - the request
 *   needs no custom headers, which is what lets the exit path reuse
 *   it during page teardown.
 * - `installId` / `userId` are canonical UUID strings, and all-zero
 *   is how the SDKs spell "not set", so such a value is omitted
 *   rather than sent. Either one may legitimately be absent - a
 *   browser always has an install identity, a server relay carries a
 *   user identity instead - but the server needs one of the two, and
 *   {@link validateSendInputs} refuses to send a batch that has
 *   neither.
 * - `testUserName` is omitted entirely when there is no tester.
 * - `sdkVersion` is the lowercased platform tag (`web/1.2.3`) - the
 *   backend asked for lowercase, while the binary `K-SDK` header
 *   keeps its historical casing.
 * - The codec payload (comma-separated event objects) is spliced
 *   into the `events` array as text, never re-parsed.
 *
 * Outcome mapping: 2xx -> `ok`, carrying the `{received, accepted}`
 * receipt when the response holds one, because a caller chaining
 * deliveries has to tell a batch the server took nothing out of from
 * one it accepted. A partial acceptance is warned about and a fully
 * rejected batch is reported at debug level, since the exit path makes
 * the duplicate case routine. Only the statuses the
 * backend documents as permanent rejections of the batch itself (see
 * {@link FATAL_STATUS}) -> `fatal`; every other status, and every
 * network failure, -> `retryable`. The default leans to `retryable`
 * on purpose: `fatal` makes the send loop delete the batch, so a
 * status nobody anticipated - a gateway's 404 mid-migration, a
 * proxy's 451 - must cost one retry cycle rather than an entire
 * offline backlog. Cancellation propagates as a throw so the send
 * loop can stop the pass.
 */

import type { RestIngestReceipt, ValidateSendInputsArgs } from './types/restTransport';
import type {
  Transport,
  TransportContext,
  TransportResult,
  TransportSendArgs,
} from './types/transport';

import { JSON_CODEC_ID } from '../codec/jsonCodec';
import { uuidBytesToString } from '../encoding/uuid';
import { isAllZeroUuid } from '../identity/identifiers';

import { assertHeaderValue } from './helpers/assertHeaderValue';
import { REST_AUTH_QUERY_PARAM } from './helpers/constants';
import { hardenedRequestInit } from './helpers/hardenedRequestInit';
import { isAbortError } from './helpers/isAbortError';
import { joinEndpoint } from './helpers/joinEndpoint';
import { mergeExtraHeaders } from './helpers/mergeExtraHeaders';
import { releaseResponseBody } from './helpers/releaseResponseBody';
import { resolveSdkTag } from './helpers/sdkTag';
import { resolveTransportFetch } from './transportFetch';

/**
 * Endpoint paths of the JSON ingestion API, relative to the configured
 * base URL. The published API reference writes these as
 * `/api/v1/json/...`, but the service answers on
 * `/event/ingress/v1/json/...` - the same `/event/ingress/v1` prefix
 * the binary ingress uses, with `json` in place of `data`. Reached by
 * a live run and confirmed by the service owner as identical in every
 * environment; the published reference is the one to distrust.
 */
const REST_ENDPOINT_PATH = {
  IN: '/event/ingress/v1/json/in',
} as const;

/**
 * Server-side cap on the raw (pre-compression) JSON body. The
 * authoritative rejection is the server's 413 (classified `fatal`);
 * this local guard only skips the doomed request. The dispatcher's
 * 50 KB cut threshold keeps real batches far below it.
 */
const REST_MAX_BODY_BYTES = 100 * 1024;

/**
 * Payload ceiling browsers enforce on keep-alive requests. Note the
 * browser applies it to the SUM of a page's in-flight keep-alive
 * bodies, while this check can only see one batch, so a teardown that
 * sends several large batches can still have a later one refused.
 * That costs nothing: every batch is on disk too, and a refused one
 * ships on the next visit.
 */
const EXIT_MAX_BODY_BYTES = 64 * 1024;

/**
 * `text/plain` keeps the exit request a CORS "simple request". Any
 * other content type triggers a preflight, and a page being torn
 * down is never alive long enough to complete one - the batch would
 * be lost exactly when the exit path exists to save it.
 */
const EXIT_CONTENT_TYPE = 'text/plain';

/**
 * The backend's documented drop list: statuses that describe the batch
 * itself as unacceptable, so a retry can never change the answer and
 * deleting it is the honest outcome. Everything else stays retryable,
 * which is what keeps a rate limit (429) or a request timeout (408)
 * from discarding exactly the backlog that provoked it.
 */
const FATAL_STATUS: ReadonlySet<number> = new Set([400, 401, 403, 413]);

/** TextEncoder/TextDecoder are stateless; allocate once at module load. */
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

/**
 * Build the request body: the envelope head via `JSON.stringify`
 * (correct escaping for the identity fields), then the payload
 * spliced in as the `events` array text.
 */
function buildEnvelope(args: TransportSendArgs): string {
  const { batch, ctx } = args;
  const head: Record<string, unknown> = {
    dataSessionId: uuidBytesToString(batch.metadata.dataSessionId),
    batch: batch.batchNum,
    customEventsHash: batch.metadata.customEventsVersion,
  };
  if (!isAllZeroUuid(ctx.installId)) {
    head['installId'] = uuidBytesToString(ctx.installId);
  }
  if (!isAllZeroUuid(batch.metadata.userId)) {
    head['userId'] = uuidBytesToString(batch.metadata.userId);
  }
  if (ctx.testUser !== null) {
    head['testUserName'] = ctx.testUser;
  }
  head['sdkVersion'] = resolveSdkTag().toLowerCase();
  const headJson = JSON.stringify(head);
  return `${headJson.slice(0, -1)},"events":[${utf8Decoder.decode(batch.payload)}]}`;
}

/** The keyed ingestion URL both delivery paths post to. */
function buildIngestUrl(ctx: TransportContext): string {
  const base = joinEndpoint({ baseUrl: ctx.endpoint, path: REST_ENDPOINT_PATH.IN });
  return `${base}?${REST_AUTH_QUERY_PARAM}=${encodeURIComponent(ctx.apiKey)}`;
}

/**
 * Read the `{received, accepted}` receipt from a 2xx response, or
 * `null` when the body is missing or malformed - a 2xx without a
 * readable receipt is still a delivered batch.
 */
async function readReceipt(response: Response): Promise<RestIngestReceipt | null> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const { received, accepted } = parsed as Record<string, unknown>;
  if (typeof received !== 'number' || typeof accepted !== 'number') {
    return null;
  }
  return { received, accepted };
}

class RestTransport implements Transport {
  readonly codecId = JSON_CODEC_ID;

  async send(args: TransportSendArgs): Promise<TransportResult> {
    const { batch, ctx } = args;
    /**
     * This transport can never ship a foreign encoding, and a retry
     * would fail the same way forever; `fatal` is honest.
     */
    if (batch.codecId !== this.codecId) {
      return {
        kind: 'fatal',
        reason: `codec mismatch: expected ${this.codecId}, got ${batch.codecId}`,
      };
    }
    validateSendInputs({ ctx, userId: batch.metadata.userId });
    const body = utf8Encoder.encode(buildEnvelope(args));
    if (body.length > REST_MAX_BODY_BYTES) {
      return {
        kind: 'fatal',
        reason: `body ${body.length} B over the ${REST_MAX_BODY_BYTES} B limit`,
      };
    }
    const url = buildIngestUrl(ctx);
    /** A `redirect: 'error'` rejection lands in the catch below as a retryable network failure. */
    const init = hardenedRequestInit({
      method: 'POST',
      headers: mergeExtraHeaders({
        reserved: { 'Content-Type': 'application/json' },
        extra: ctx.extraHeaders,
        fnName: 'restTransport',
      }),
      body,
      signal: ctx.signal,
    });
    let response: Response;
    try {
      response = await resolveTransportFetch().call(globalThis, url, init);
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw error;
      }
      return { kind: 'retryable', reason: 'network failure' };
    }
    if (response.ok) {
      /** `readReceipt` consumes the body, which also releases the socket. */
      const receipt = await readReceipt(response);
      /**
       * `accepted: 0` means the batch was a duplicate, arrived out of
       * sequence, or held nothing the server could parse. The exit
       * path makes the duplicate case normal - a batch sent during
       * teardown is deliberately resent from disk on the next visit -
       * so this is reported at debug level while a partial acceptance,
       * where some events failed validation and others landed, is a
       * warning.
       */
      if (receipt === null) {
        return { kind: 'ok' };
      }
      if (receipt.accepted === 0 && receipt.received > 0) {
        console.debug(
          `Keewano: server accepted none of ${receipt.received} events in batch ${batch.batchNum}; it was a duplicate, out of sequence, or unparseable.`,
        );
      } else if (receipt.accepted > 0 && receipt.accepted < receipt.received) {
        console.warn(
          `Keewano: server accepted ${receipt.accepted} of ${receipt.received} events in batch ${batch.batchNum}.`,
        );
      }
      return { kind: 'ok', received: receipt.received, accepted: receipt.accepted };
    }
    /** Error bodies are never read; release them so the socket returns to the pool. */
    try {
      await releaseResponseBody(response);
    } catch {
      /** Best-effort cleanup only; preserve the real HTTP outcome. */
    }
    if (FATAL_STATUS.has(response.status)) {
      return { kind: 'fatal', reason: `status ${response.status}` };
    }
    return { kind: 'retryable', reason: `status ${response.status}` };
  }

  /**
   * Issue the batch as a keep-alive request: the browser completes it
   * after the page is gone, which is what makes it usable from a
   * closing tab. `navigator.sendBeacon` serves the same purpose, but
   * it accepts no request options, so it would silently drop every
   * protection {@link send} applies - it sends ambient credentials
   * and follows redirects, which would hand the keyed URL to whatever
   * a redirect names. A keep-alive `fetch` keeps all four flags.
   *
   * The only deliberate differences from {@link send} are the content
   * type - the exit request must stay a CORS simple request (see
   * {@link EXIT_CONTENT_TYPE}) because a preflight cannot complete
   * during teardown - and that the response is never read.
   *
   * @returns `true` when the request was handed to the runtime.
   *   `false` means the attempt did not happen at all (no fetch, an
   *   over-size body, or a foreign codec) - never that delivery
   *   failed, which is unknowable here. Either way the caller keeps
   *   its persisted copy; a batch that also arrives this way is
   *   deduplicated server-side on resend.
   */
  sendSync(args: TransportSendArgs): boolean {
    const { batch, ctx } = args;
    if (batch.codecId !== this.codecId) {
      return false;
    }
    try {
      validateSendInputs({ ctx, userId: batch.metadata.userId });
      const body = utf8Encoder.encode(buildEnvelope(args));
      if (body.length > EXIT_MAX_BODY_BYTES) {
        return false;
      }
      const init = hardenedRequestInit({
        method: 'POST',
        headers: { 'Content-Type': EXIT_CONTENT_TYPE },
        body,
        signal: undefined,
        keepalive: true,
      });
      /**
       * Deliberately not awaited: the caller is a closing page and
       * has no way to act on the outcome. The rejection handler only
       * exists so a failed request cannot surface as an unhandled
       * rejection in the host's console.
       */
      resolveTransportFetch()
        .call(globalThis, buildIngestUrl(ctx), init)
        .catch(() => undefined);
      return true;
    } catch {
      /**
       * The exit path has no error channel a closing page could act
       * on, and a throw here would abort the persistence that runs
       * after it. Report "not sent" and let the disk copy ship on the
       * next visit.
       */
      return false;
    }
  }
}

/**
 * Fail loudly on inputs that could only come from a wiring bug: the
 * validation mirrors the binary transport's `sendBatch` entry checks,
 * so a misconfiguration surfaces as a throw instead of an endless
 * retry loop.
 */
function validateSendInputs(args: ValidateSendInputsArgs): void {
  const { ctx, userId } = args;
  assertHeaderValue({
    value: ctx.apiKey,
    fnName: 'restTransport',
    field: 'apiKey',
    allowEmpty: false,
  });
  if (ctx.testUser !== null) {
    assertHeaderValue({
      value: ctx.testUser,
      fnName: 'restTransport',
      field: 'testUser',
      allowEmpty: true,
    });
  }
  /**
   * The server needs at least one identity, and a session carrying
   * neither cannot produce an acceptable batch. Throwing keeps the
   * queue on disk until the wiring is fixed; letting the server
   * reject each batch instead would delete the whole backlog one
   * permanent rejection at a time.
   */
  if (isAllZeroUuid(ctx.installId) && isAllZeroUuid(userId)) {
    throw new TypeError('restTransport: installId or userId required');
  }
}

export { EXIT_MAX_BODY_BYTES, REST_MAX_BODY_BYTES, RestTransport };
