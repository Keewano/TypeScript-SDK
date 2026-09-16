/**
 * Types for the error tracker.
 *
 * ErrorEventLike - the fields read from a global `error` event:
 *   `error` is the thrown value (absent for cross-origin scripts),
 *   `message` the browser-formatted fallback text.
 *
 * RejectionEventLike - the field read from `unhandledrejection`.
 *
 * ErrorWindowLike - the window seam the listeners attach to.
 *
 * ErrorTrackerArgs - optional window seam and report function;
 *   defaults to the live `window` and the core ERROR_MSG reporter.
 */

interface ErrorEventLike {
  error?: unknown;
  message?: unknown;
}

interface RejectionEventLike {
  reason?: unknown;
}

interface ErrorWindowLike {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

interface ErrorTrackerArgs {
  win?: ErrorWindowLike;
  report?: (message: string) => void;
}

export type { ErrorEventLike, ErrorTrackerArgs, ErrorWindowLike, RejectionEventLike };
