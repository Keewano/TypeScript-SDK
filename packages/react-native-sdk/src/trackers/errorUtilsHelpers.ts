/**
 * Helpers for the global `ErrorUtils` integration used by
 * `ErrorTracker`. Pulled into its own module so the tracker file
 * stays under the 150-line cap.
 */

import type { ErrorUtilsLike } from './types/ErrorTracker';

/**
 * Fallback handler installed when no previous ErrorUtils handler
 * existed at attach time. Mirrors RN's own minimum-viable behaviour
 * (log to console.error) so the global path never becomes a silent
 * swallow point.
 *
 * Use `console.error` so dev tools / RN red-box pick the throw up.
 * Avoid re-throwing: `ErrorUtils.setGlobalHandler` is the host's
 * last line of defence; throwing from inside it crashes the JS
 * runtime in some RN versions.
 */
function defaultErrorHandler(error: unknown): void {
  console.error(error);
}

/**
 * Default loader for the global `ErrorUtils`. React Native exposes
 * it on the global object; node test runners do not, in which case
 * `null` is returned and the tracker degrades to no-op. Treats
 * `null` and `undefined` alike so RN shims that signal "unavailable"
 * with an explicit null do not crash on the property dereference.
 */
function defaultLoadErrorUtils(): ErrorUtilsLike | null {
  const candidate = (globalThis as unknown as { ErrorUtils?: ErrorUtilsLike | null }).ErrorUtils;
  if (candidate === undefined || candidate === null) return null;
  if (
    typeof candidate.getGlobalHandler !== 'function' ||
    typeof candidate.setGlobalHandler !== 'function'
  ) {
    return null;
  }
  return candidate;
}

export { defaultErrorHandler, defaultLoadErrorUtils };
