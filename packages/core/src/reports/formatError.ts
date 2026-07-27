/**
 * Format an uncaught throw value into the canonical wire payload string
 * `"Caught exception {message} at {stack}"`. Shared by every platform's
 * error hook so the same throw produces a byte-identical ERROR_MSG event
 * everywhere.
 *
 * Reads `message` / `stack` structurally rather than via `instanceof
 * Error`: cross-realm Errors, native exceptions, and other error-like
 * objects expose those fields without inheriting from the local Error
 * constructor, and their crash detail still belongs on the wire.
 *
 * Long error messages and stack traces pass through unchanged: the
 * dispatcher's string event has no length cap, and the report-layer
 * 256-char truncation is intentionally bypassed for ERROR_MSG so crash
 * context survives intact.
 */

/**
 * Read a `message` or `stack` string off an unknown throw value,
 * defending against hostile Proxies / objects with throwing getters.
 * The error formatter runs inside the global crash path, so a throw here
 * would propagate out of the host's crash reporter. The try/catch
 * contains that risk so the caller always sees `undefined` on a bad read.
 */
function readStringField(error: unknown, key: 'message' | 'stack'): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  try {
    const value = (error as Record<string, unknown>)[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function formatErrorMessage(error: unknown): string {
  const message = pickMessage(error);
  const stack = readStringField(error, 'stack') ?? '';
  if (stack.length > 0) return `Caught exception ${message} at ${stack}`;
  return `Caught exception ${message}`;
}

/**
 * Pull a non-empty message string off the throw value. Resolution order:
 *   1. A non-empty `.message` string on any object - covers Error,
 *      cross-realm Error, and error-like objects from native modules.
 *   2. The value's own `String(...)` coercion when it is a primitive
 *      (string / number / boolean / bigint / symbol) - covers non-Error
 *      throws like `throw 42` or `throw 'oops'`.
 *   3. `JSON.stringify(value)` for plain objects so the payload carries
 *      structured detail instead of the useless `'[object Object]'`.
 *   4. The sentinel `'unknown error'` when stringification fails
 *      (circular reference, broken `toJSON`, etc.).
 */
function pickMessage(error: unknown): string {
  const message = readStringField(error, 'message');
  if (message !== undefined) return message;
  if (error === null) return 'null';
  if (error === undefined) return 'undefined';
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return error.toString();
  }
  if (typeof error === 'symbol') return error.toString();
  try {
    return JSON.stringify(error) ?? 'unknown error';
  } catch {
    return 'unknown error';
  }
}

export { formatErrorMessage };
