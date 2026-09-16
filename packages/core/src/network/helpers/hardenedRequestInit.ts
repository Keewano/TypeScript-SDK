/**
 * The single `RequestInit` factory every Keewano HTTP call goes
 * through. Each request carries authentication material - `K-Token` in
 * a header on the binary protocol, `k-token` on the JSON one, in the
 * query on the ingestion route and in a header on the custom-events
 * pair - plus install / user / data-session identifiers. Four
 * flags keep that material where it belongs, and they live here rather
 * than at each call site so the posture cannot drift as call sites are
 * added:
 *
 * `redirect: 'error'` rejects any 3xx instead of forwarding the
 * credentials to whatever URL the response advertises; the caller sees
 * the rejection as an ordinary transport failure.
 *
 * `credentials: 'omit'` keeps ambient cookies and platform-level HTTP
 * authentication off the request. The endpoints authenticate on the
 * API key alone; anything else the runtime has stored is unrelated
 * session material.
 *
 * `cache: 'no-store'` defeats HTTP caches, service workers and native
 * cache layers (NSURLCache, OkHttp). Every endpoint URL is a constant
 * while the request identity rides in headers, query or body, so a
 * URL-keyed cache could otherwise replay an earlier 2xx and make the
 * SDK believe a never-sent request succeeded.
 *
 * `referrerPolicy: 'no-referrer'` drops the `Referer` header that
 * browser runtimes would otherwise attach with the host page's URL.
 * The analytics endpoints have no use for that metadata.
 */

/**
 * Args for {@link hardenedRequestInit}.
 *
 * method - HTTP method of the request.
 * headers - Header set the transport built, extras already merged in.
 * body - Request body; omitted for a body-less GET.
 * signal - Caller cancellation signal, or `undefined` for none.
 *   Required rather than optional so every call site states the
 *   choice under `exactOptionalPropertyTypes`.
 * keepalive - `true` only on the exit path, where the request has to
 *   outlive the page. Omitted elsewhere: keep-alive requests share a
 *   small per-page byte quota.
 */
interface HardenedRequestInitArgs {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: NonNullable<RequestInit['body']>;
  signal: AbortSignal | undefined;
  keepalive?: boolean;
}

/**
 * The optional fields are spread rather than assigned because
 * `exactOptionalPropertyTypes` forbids handing `undefined` to `fetch`'s
 * `signal: AbortSignal | null`, and because an assigned `body:
 * undefined` would still make a GET look like it carries one.
 */
function hardenedRequestInit({
  method,
  headers,
  body,
  signal,
  keepalive,
}: HardenedRequestInitArgs): RequestInit {
  return {
    method,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers,
    ...(body === undefined ? {} : { body }),
    ...(signal === undefined ? {} : { signal }),
    ...(keepalive === undefined ? {} : { keepalive }),
  };
}

export type { HardenedRequestInitArgs };
export { hardenedRequestInit };
