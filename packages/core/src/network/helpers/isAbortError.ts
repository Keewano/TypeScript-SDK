/**
 * `true` when `error` looks like a caller-initiated cancellation
 * signal (any object whose `name` is `'AbortError'` or
 * `'TimeoutError'`). Used in transport `catch` blocks to
 * distinguish a deliberate stop from a real transport failure:
 *
 * - Caller-initiated abort or timeout -> propagate (the caller
 *   asked to stop, either explicitly via `controller.abort()` or
 *   implicitly via `AbortSignal.timeout(ms)`).
 * - Network error / HTTP failure -> collapse into the function's
 *   "request failed" sentinel (`false` or `'error'`) so the
 *   orchestration layer can retry on the next cycle.
 *
 * Both `AbortError` and `TimeoutError` are documented WHATWG
 * cancellation names; `AbortSignal.timeout(ms)` rejects fetches
 * with `name === 'TimeoutError'`, while `controller.abort()`
 * (with no reason) rejects with `name === 'AbortError'`. Both
 * mean "caller asked us to stop" - collapsing either into the
 * failure sentinel would trigger pointless retry attempts.
 *
 * The check is structural rather than `instanceof Error` because
 * some React Native versions and `fetch` polyfills reject with
 * plain objects or non-`Error` `DOMException` shapes that still
 * carry the canonical `name` marker.
 */
function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return false;
  }
  const { name } = error;
  return name === 'AbortError' || name === 'TimeoutError';
}

export { isAbortError };
