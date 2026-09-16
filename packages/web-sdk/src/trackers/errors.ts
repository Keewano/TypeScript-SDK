/**
 * Error tracker: ERROR_MSG from uncaught throws and unhandled promise
 * rejections. Listens via `addEventListener('error')` and
 * `('unhandledrejection')` and never touches `window.onerror`, so it
 * coexists with any other error tooling on the page.
 *
 * The payload goes through the shared `formatErrorMessage`, so the
 * same throw produces a byte-identical ERROR_MSG on every platform,
 * uncapped (crash context beats the 256-char report limit).
 *
 * Cross-origin scripts surface as the browser's opaque
 * "Script error." with no `error` object - reported as-is, a
 * documented platform limitation.
 *
 * A re-entrancy guard drops errors thrown WHILE reporting an error:
 * without it, an SDK-internal failure inside the emit path would
 * re-enter this tracker and loop.
 */
import type { KeewanoTracker } from '../types/config';
import type {
  ErrorEventLike,
  ErrorTrackerArgs,
  ErrorWindowLike,
  RejectionEventLike,
} from './types/errors';

import { formatErrorMessage, logError } from '@keewano/core';

import { EVENT_TARGET_METHODS, probeGlobal } from '../probeGlobal';
import { noopDetach } from './noopDetach';

class ErrorTracker implements KeewanoTracker {
  readonly name = 'ErrorTracker';

  private readonly args: ErrorTrackerArgs;
  /** Re-entrancy latch; `true` while a report is being emitted. */
  private reporting = false;

  constructor(args: ErrorTrackerArgs = {}) {
    this.args = args;
  }

  attach(): () => void {
    const win = this.args.win ?? probeGlobal<ErrorWindowLike>({ methods: EVENT_TARGET_METHODS });
    if (win === null) return noopDetach;
    const report = this.args.report ?? logError;

    const emit = (value: unknown): void => {
      if (this.reporting) return;
      this.reporting = true;
      try {
        report(formatErrorMessage(value));
      } catch {
        /** The crash path must never throw back into the page. */
      } finally {
        this.reporting = false;
      }
    };

    const onError = (event: ErrorEventLike): void => {
      /** Cross-origin events carry no `error`; the message string is all there is. */
      emit(event.error ?? event.message);
    };
    const onRejection = (event: RejectionEventLike): void => {
      emit(event.reason);
    };

    win.addEventListener('error', onError as (event: unknown) => void);
    win.addEventListener('unhandledrejection', onRejection as (event: unknown) => void);
    return () => {
      try {
        win.removeEventListener('error', onError as (event: unknown) => void);
        win.removeEventListener('unhandledrejection', onRejection as (event: unknown) => void);
      } catch {
        /** Best-effort tracker cleanup. */
      }
    };
  }
}

export type { ErrorTrackerArgs } from './types/errors';
export { ErrorTracker };
