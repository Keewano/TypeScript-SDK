/**
 * Coerce an `unknown` throw value into a readable string for terse
 * error messages. `Error` -> its `.message`; plain object -> JSON if
 * possible, else `Object.prototype.toString` fallback; everything
 * else -> `String(value)`.
 *
 * Shared between `parse.ts` and `cli.ts` so the two catch sites
 * produce identical diagnostics for the same input shape.
 */
function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      return Object.prototype.toString.call(err);
    }
  }
  return String(err);
}

export { stringifyError };
