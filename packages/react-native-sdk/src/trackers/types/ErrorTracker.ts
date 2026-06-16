/**
 * dispatcher - Live event accumulator. Emits ERROR_MSG with the
 *   error's string form on every uncaught exception forwarded
 *   through RN's `ErrorUtils.setGlobalHandler`.
 * loadErrorUtils - Optional injection point for tests. Returns the
 *   host's ErrorUtils-shaped global, or `null` when absent. Defaults
 *   to `(globalThis as { ErrorUtils? }).ErrorUtils ?? null`.
 */
import type { KEventDispatcher } from '@keewano/core';

interface ErrorUtilsLike {
  getGlobalHandler: () => ErrorHandler | null | undefined;
  setGlobalHandler: (handler: ErrorHandler) => void;
}

type ErrorHandler = (error: Error, isFatal?: boolean) => void;

interface ErrorTrackerArgs {
  dispatcher: KEventDispatcher;
  loadErrorUtils?: () => ErrorUtilsLike | null;
}

export type { ErrorHandler, ErrorTrackerArgs, ErrorUtilsLike };
