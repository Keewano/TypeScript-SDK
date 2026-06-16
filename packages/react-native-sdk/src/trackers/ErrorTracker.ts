/**
 * Uncaught-exception auto-tracker. Chains a handler onto the global
 * `ErrorUtils` so every uncaught throw emits an ERROR_MSG event
 * before the host's pre-existing handler runs. The original handler
 * is preserved end-to-end: services like Sentry / Bugsnag that
 * registered before our `attach()` still receive every error.
 *
 * Detach is "polite": it only restores the previous handler when the
 * current global is still THIS tracker's wrapper. Another tracker
 * (foreign, or a second ErrorTracker instance) that chained on top
 * after us keeps its patch in place - we never reach past it.
 *
 * Message format is `"Caught exception {message} at {stack}"` (see
 * `formatErrorMessage.ts`). Long error messages and stack traces pass
 * through unchanged - the dispatcher's string event has no length cap
 * and ERROR_MSG bypasses the 256-char truncation so crash context
 * survives intact.
 */

import type { KeewanoTracker } from '../types/config';
import type { ErrorHandler, ErrorTrackerArgs } from './types/ErrorTracker';

import { KEvents } from '@keewano/core';

import { defaultErrorHandler, defaultLoadErrorUtils } from './errorUtilsHelpers';
import { formatErrorMessage } from './formatErrorMessage';
import { noopDetach } from './noopDetach';
import { stampNowOnDispatcher } from './stampNow';

class ErrorTracker implements KeewanoTracker {
  readonly name = 'ErrorTracker';

  private readonly args: ErrorTrackerArgs;

  constructor(args: ErrorTrackerArgs) {
    this.args = args;
  }

  /**
   * Chain a handler onto the global ErrorUtils. Returns a no-op
   * detach when ErrorUtils is absent (web host / Node test runner
   * without the RN global).
   */
  attach(): () => void {
    const load = this.args.loadErrorUtils ?? defaultLoadErrorUtils;
    /**
     * A custom `loadErrorUtils` shim can throw at resolve time
     * (require() failure, lazy peer with side-effecting init).
     * Treat a throwing loader the same as a missing peer so SDK
     * boot never depends on this tracker succeeding.
     */
    let errorUtils: ReturnType<typeof load>;
    try {
      errorUtils = load();
    } catch {
      return noopDetach;
    }
    /**
     * `defaultLoadErrorUtils` already validates this shape on the
     * standard RN path, but a custom `loadErrorUtils` arg can return
     * any value - re-check at attach time so a malformed shim cannot
     * crash `getGlobalHandler()` / `setGlobalHandler()` calls below.
     */
    if (
      errorUtils == null ||
      typeof errorUtils.getGlobalHandler !== 'function' ||
      typeof errorUtils.setGlobalHandler !== 'function'
    ) {
      return noopDetach;
    }

    let previous: ErrorHandler | null;
    const ourHandler: ErrorHandler = (error: Error, isFatal?: boolean) => {
      this.emitErrorEvent(error);
      if (typeof previous === 'function') {
        previous(error, isFatal);
      } else {
        /**
         * No prior handler was installed at attach time. Mimic RN's
         * own fallback (log to console.error) so we do not silently
         * swallow the uncaught throw - either while our handler is
         * the active global or after detach (see detach below).
         */
        defaultErrorHandler(error);
      }
    };
    /**
     * A throwing `getGlobalHandler` / `setGlobalHandler` from a custom
     * shim must not crash SDK init - degrade to no-op detach.
     */
    try {
      previous = errorUtils.getGlobalHandler() ?? null;
      errorUtils.setGlobalHandler(ourHandler);
    } catch {
      return noopDetach;
    }

    return () => {
      try {
        if (errorUtils.getGlobalHandler() === ourHandler) {
          /**
           * Restore the prior handler iff the current global is still
           * exactly this tracker's wrapper. If another ErrorTracker (or
           * a foreign handler) chained on top after us, leaving the
           * global alone preserves their patch - ripping it out would
           * silently break their crash-reporter chain.
           *
           * When `previous` was null, restore `defaultErrorHandler`
           * (which logs to console.error) instead of a captive noop -
           * a true noop would swallow every uncaught throw the host
           * raises post-shutdown.
           */
          errorUtils.setGlobalHandler(previous ?? defaultErrorHandler);
        }
      } catch {
        /** Best-effort tracker cleanup. */
      }
    };
  }

  /**
   * Stamp the dispatcher frame timestamp with wall-clock seconds and
   * emit a single ERROR_MSG event carrying the formatted exception.
   * Any throw from the dispatcher path is swallowed so a misbehaving
   * dispatcher cannot break the host's crash-reporter chain.
   */
  private emitErrorEvent(error: unknown): void {
    try {
      stampNowOnDispatcher(this.args.dispatcher);
      this.args.dispatcher.addEventString({
        eventId: KEvents.ERROR_MSG,
        str: formatErrorMessage(error),
      });
    } catch {
      /** A throw from the dispatcher must not break the host's crash reporter. */
    }
  }
}

export type { ErrorTrackerArgs } from './types/ErrorTracker';
export { formatErrorMessage } from './formatErrorMessage';
export { ErrorTracker };
