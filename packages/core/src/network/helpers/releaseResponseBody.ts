/**
 * Cancel the response body so the underlying socket returns to the
 * HTTP connection pool. Called from every transport `fetch` success
 * path: the SDK only inspects status / `ok` and never reads the
 * response payload, but in `undici` / Node native fetch a `Response`
 * whose body is neither consumed nor cancelled keeps its socket
 * busy until garbage collection. Under load that can stall later
 * batch uploads behind connection-pool exhaustion.
 *
 * Best-effort by contract: no exception ever escapes this function.
 * A `Response` from a fetch polyfill may expose `body` as `null`,
 * `undefined`, or as an object without a `cancel` method; `cancel()`
 * itself may also throw synchronously or reject. In every one of
 * those shapes the helper returns silently so the surrounding
 * transport never turns a successful HTTP call into a thrown
 * release error (which the orchestration layer would map to a
 * retry of an already-delivered batch).
 */
async function releaseResponseBody(response: Response): Promise<void> {
  /*
   * Read `body` through a narrow structural type covering exactly the
   * one property this helper touches (`cancel`). A fetch polyfill may
   * expose `body` as `null`, `undefined`, or an object whose `cancel`
   * is missing; duck-typing on `cancel` handles every shape without an
   * `as` cast that silently widens the declared `ReadableStream` type.
   */
  const { body } = response as { body?: { cancel?: () => Promise<void> } | null };
  if (body === null || body === undefined || typeof body.cancel !== 'function') {
    return;
  }
  try {
    await body.cancel();
  } catch {
    return;
  }
}

export { releaseResponseBody };
