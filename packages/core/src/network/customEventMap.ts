/**
 * `GET /custom` and `POST /custom` - the two halves of the
 * custom-events map sub-protocol. Both functions are pure transport
 * with no state; the caller decides which version to probe and
 * caches the result.
 *
 * GET headers (3): `K-Token`, `K-CustomEventHash`, `K-SDK`.
 * POST headers (6): the GET set plus `K-CustomEventCount`,
 * `Content-Encoding: gzip`, `Content-Type: application/octet-stream`.
 *
 * `Content-Encoding: gzip` on POST means "the body is already
 * gzipped" - this layer never compresses on the fly. The
 * `signal === undefined ? {} : { signal }` spreads below are there
 * because `exactOptionalPropertyTypes: true` forbids assigning
 * `undefined` to `fetch`'s `signal: AbortSignal | null` field.
 */

import type {
  CustomEventMapStatus,
  GetCustomEventMapStatusArgs,
  RegisterCustomEventMapArgs,
} from './types/customEventMap';

import { assertIntInRange, assertUint8Array } from '../encoding/assertions';

import { LIMITS } from '../encoding/limits';
import { assertHeaderValue } from './helpers/assertHeaderValue';
import { CONTENT_TYPE_OCTET_STREAM, ENDPOINT_PATH } from './helpers/constants';
import { resolveSdkTag } from './helpers/sdkTag';
import { isAbortError } from './helpers/isAbortError';
import { joinEndpoint } from './helpers/joinEndpoint';
import { mergeExtraHeaders } from './helpers/mergeExtraHeaders';
import { releaseResponseBody } from './helpers/releaseResponseBody';
import { resolveTransportFetch } from './transportFetch';

/**
 * Upper bound for the gzip body `registerCustomEventMap` uploads.
 * MAX_GZIP_BYTES caps the already-compressed map at 1 MiB. The map is
 * gzipped JSON of at most ~63k event definitions; 1 MiB of compressed
 * payload is far beyond any legitimate generated set. A larger buffer
 * means a malformed or hostile `CustomEventSet`, which must surface as
 * a configuration error rather than turn into a repeated multi-hundred
 * -megabyte upload whenever the registration retries.
 */
const REGISTER_LIMITS = {
  MAX_GZIP_BYTES: 1024 * 1024,
} as const;

/**
 * Probe whether the server already knows the given custom-events map
 * `version`.
 *
 * Maps the HTTP response to a tri-state:
 * - `200 OK` -> `'known'`
 * - `204 No Content` -> `'needs-registration'`
 * - any other status, or network error -> `'error'`
 *
 * The request is sent with `cache: 'no-store'`. The URL is always
 * `/custom`; the version under test rides in the `K-CustomEventHash`
 * header. An HTTP cache that keys on URL alone (no `Vary` on that
 * header) would otherwise serve a stale per-version response.
 *
 * @throws RangeError when `version` is not a `uint32`.
 * @throws TypeError when `baseUrl` is empty or otherwise malformed,
 *   or when `apiKey` is empty, has surrounding whitespace,
 *   contains an ASCII control character, or contains a
 *   non-ByteString character. Configuration-bug throws are
 *   deliberately surfaced (not collapsed into `'error'`) so a
 *   permanent misconfiguration cannot masquerade as a transient
 *   retry.
 * @throws Whatever `fetch` rejected with when the caller cancels via
 *   `signal` (`Error`/`DOMException` named `'AbortError'` or
 *   `'TimeoutError'`). Both shapes propagate rather than
 *   collapsing into `'error'`.
 */
async function getCustomEventMapStatus(
  args: GetCustomEventMapStatusArgs,
): Promise<CustomEventMapStatus> {
  const { baseUrl, apiKey, version, signal, extraHeaders } = args;
  assertHeaderValue({
    value: apiKey,
    fnName: 'getCustomEventMapStatus',
    field: 'apiKey',
    allowEmpty: false,
  });
  assertIntInRange({
    fnName: 'getCustomEventMapStatus: version',
    max: LIMITS.UINT32_MAX,
    min: 0,
    n: version,
  });

  const headers = mergeExtraHeaders({
    reserved: {
      'K-Token': apiKey,
      'K-CustomEventHash': String(version),
      'K-SDK': resolveSdkTag(),
    },
    extra: extraHeaders,
    fnName: 'getCustomEventMapStatus',
  });
  const url = joinEndpoint({ baseUrl, path: ENDPOINT_PATH.CUSTOM });
  /**
   * `redirect: 'error'` rejects 3xx responses. Both `/custom`
   * requests carry `K-Token`; default redirect-following would
   * forward the API key to whatever URL the response advertises.
   *
   * `credentials: 'omit'` suppresses ambient cookies and HTTP
   * authentication. Authentication is carried exclusively by the
   * `K-Token` header; allowing `fetch` to attach the runtime's
   * stored cookies (or platform-level Basic-Auth) would leak
   * unrelated session material to the `/custom` endpoint.
   *
   * `cache: 'no-store'` defeats HTTP cache layers (browser HTTP
   * cache, NSURLCache, OkHttp cache). The probe URL is always
   * `/custom`; the version we are probing lives in the
   * `K-CustomEventHash` header. An intermediary that keys cache
   * entries by URL only (no `Vary` from the server) would otherwise
   * return a stale `200` for one version when the caller probes a
   * different version, the SDK would skip a needed registration,
   * and subsequent batches would fail server-side.
   *
   * `referrerPolicy: 'no-referrer'` suppresses the `Referer` header
   * that browser-based runtimes (Expo for web) would otherwise
   * attach with the host app's origin or URL. The analytics
   * endpoint has no use for that metadata.
   *
   * After every successful `fetch` the response body is released
   * via `releaseResponseBody` so the underlying socket returns to
   * the HTTP pool. We only inspect status; an unread body would
   * keep the connection busy in `undici`/Node native fetch.
   */
  const init: RequestInit = {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers,
    ...(signal === undefined ? {} : { signal }),
  };
  let response: Response;
  try {
    response = await resolveTransportFetch().call(globalThis, url, init);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return 'error';
  }
  /*
   * Decide the result BEFORE attempting body release so a
   * regression in the best-effort release helper cannot flip a
   * real `'known'` / `'needs-registration'` into the outer
   * `'error'` path. The dedicated try / catch around the release
   * is belt-and-suspenders: even if a future change to the helper
   * let an error escape, that error must not propagate to the
   * caller and contradict the already-classified protocol result.
   */
  const result = mapStatusToCustomEventMapStatus(response.status);
  try {
    await releaseResponseBody(response);
  } catch {
    /* Best-effort cleanup only; preserve the mapped protocol result. */
  }
  return result;
}

function mapStatusToCustomEventMapStatus(status: number): CustomEventMapStatus {
  if (status === 200) {
    return 'known';
  }
  if (status === 204) {
    return 'needs-registration';
  }
  return 'error';
}

/**
 * Register a custom-events map with the server.
 *
 * `ceSet.gzipData` is sent verbatim as the HTTP body; this layer
 * does NOT gzip on the fly. `Content-Encoding: gzip` tells the
 * server the body is already compressed and should be inflated
 * before processing.
 *
 * @returns `true` on `200 OK` or `201 Created`, `false` on any other
 *   status or network error.
 * @throws TypeError when `ceSet.gzipData` is not a `Uint8Array`,
 *   when `baseUrl` is empty or otherwise malformed, or when
 *   `apiKey` is empty / whitespace-only or contains an ASCII
 *   control character. Configuration-bug throws are deliberately
 *   surfaced (not collapsed into `false`) so a permanent
 *   misconfiguration cannot masquerade as a transient retry.
 * @throws RangeError when `ceSet.version` is not a `uint32`,
 *   `ceSet.eventCount` is not a `uint16`, or `ceSet.gzipData`
 *   exceeds the maximum upload size.
 * @throws Whatever `fetch` rejected with when the caller cancels via
 *   `signal` (`Error`/`DOMException` named `'AbortError'` or
 *   `'TimeoutError'`). Both shapes propagate rather than
 *   collapsing into `false`.
 */
async function registerCustomEventMap(args: RegisterCustomEventMapArgs): Promise<boolean> {
  const { baseUrl, apiKey, ceSet, signal, extraHeaders } = args;
  assertHeaderValue({
    value: apiKey,
    fnName: 'registerCustomEventMap',
    field: 'apiKey',
    allowEmpty: false,
  });
  assertIntInRange({
    fnName: 'registerCustomEventMap: ceSet.version',
    max: LIMITS.UINT32_MAX,
    min: 0,
    n: ceSet.version,
  });
  assertIntInRange({
    fnName: 'registerCustomEventMap: ceSet.eventCount',
    max: LIMITS.UINT16_MAX,
    min: 0,
    n: ceSet.eventCount,
  });
  assertUint8Array({
    fnName: 'registerCustomEventMap: ceSet.gzipData',
    value: ceSet.gzipData,
  });
  if (ceSet.gzipData.length > REGISTER_LIMITS.MAX_GZIP_BYTES) {
    throw new RangeError('registerCustomEventMap: ceSet.gzipData too large');
  }

  const headers = mergeExtraHeaders({
    reserved: {
      'K-Token': apiKey,
      'K-CustomEventHash': String(ceSet.version),
      'K-CustomEventCount': String(ceSet.eventCount),
      'K-SDK': resolveSdkTag(),
      'Content-Encoding': 'gzip',
      'Content-Type': CONTENT_TYPE_OCTET_STREAM,
    },
    extra: extraHeaders,
    fnName: 'registerCustomEventMap',
  });
  /**
   * `BodyInit` cast: TS 5.7+ narrows `Uint8Array<ArrayBufferLike>`
   * too strictly against the `BodyInit` union, but `fetch` accepts
   * a `Uint8Array` at runtime as a `BufferSource`. The cast pins
   * the runtime contract without copying the bytes.
   */
  const url = joinEndpoint({ baseUrl, path: ENDPOINT_PATH.CUSTOM });
  /**
   * `credentials: 'omit'` suppresses ambient cookies and HTTP
   * authentication on registration too: the only authentication
   * material the server expects is `K-Token`.
   *
   * `cache: 'no-store'` mirrors the probe call. The endpoint URL
   * is the constant `/custom`; the version being registered rides
   * in `K-CustomEventHash`. A misbehaving cache (service worker,
   * intermediary proxy) keying by URL alone could replay a stale
   * `2xx` from a previous version and make the SDK believe a real
   * registration succeeded when nothing reached the server.
   *
   * `referrerPolicy: 'no-referrer'` mirrors the probe call too -
   * the `Referer` header has no place on an analytics transport.
   *
   * Response body release via `releaseResponseBody` keeps the
   * connection pool clean under load.
   */
  const init: RequestInit = {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers,
    body: ceSet.gzipData as BodyInit,
    ...(signal === undefined ? {} : { signal }),
  };
  try {
    const response = await resolveTransportFetch().call(globalThis, url, init);
    /*
     * Capture the HTTP outcome BEFORE the best-effort body release
     * so a regression in the helper cannot turn a successful
     * registration into a `false` (which the caller would retry,
     * wasting an upload of bytes the server already has). The
     * dedicated try / catch around the release is belt-and-
     * suspenders for the same invariant.
     */
    const ok = response.status === 200 || response.status === 201;
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

export { getCustomEventMapStatus, registerCustomEventMap };
