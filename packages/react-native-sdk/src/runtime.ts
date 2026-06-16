/**
 * Internal singleton state for the SDK lifecycle. Holds the
 * dispatcher, storage adapter, identifiers, consent state, and
 * send-loop abort controller produced by `Keewano.init`. Cleared
 * by `Keewano.shutdown`.
 *
 * The state is module-scoped so the `Keewano.*` facade can read
 * it without threading a context object through every call site.
 * `getRuntime` throws when called before init; report-style
 * methods are expected to queue via `enqueuePreInit` when init
 * has not resolved yet.
 */

import type { SdkRuntime } from './types/runtime';

/**
 * Active runtime singleton. Populated by {@link setRuntime} after a
 * successful init, cleared by {@link clearRuntime} on shutdown.
 */
let activeRuntime: SdkRuntime | null = null;

/**
 * Pending init promise. Tracks the `Keewano.init(...)` invocation
 * while it is mid-flight so a concurrent second call can await the
 * same promise instead of starting a duplicate boot.
 */
let activeInitPromise: Promise<void> | null = null;

/**
 * Operations queued by report methods that were called before
 * `Keewano.init` resolved. Drained in FIFO order by
 * {@link drainPreInitQueue} once the runtime is set.
 */
let preInitQueue: Array<() => void> = [];

/** `true` when {@link setRuntime} has landed (init completed). */
function isInitialized(): boolean {
  return activeRuntime !== null;
}

/**
 * `true` when an init promise is mid-flight but the runtime has not
 * landed yet. Used by `Keewano.init` to short-circuit re-init.
 */
function isInitializing(): boolean {
  return activeInitPromise !== null && activeRuntime === null;
}

/**
 * Return the active runtime, or throw when called before init. Public
 * report methods that bypass `runWhenReady` use this; they are
 * expected to have observed `isInitialized() === true` first.
 *
 * @throws Error when no runtime is active.
 */
function getRuntime(): SdkRuntime {
  if (activeRuntime === null) {
    throw new Error('Keewano: SDK not initialized. Call Keewano.init() first.');
  }
  return activeRuntime;
}

/**
 * Non-throwing variant of {@link getRuntime}. Returns `null` when no
 * runtime is active. Used by `shutdown` so idempotent shutdowns do
 * not surface a "not initialized" error.
 */
function getRuntimeOrNull(): SdkRuntime | null {
  return activeRuntime;
}

/** Install a fresh runtime singleton. Called once per successful init. */
function setRuntime(runtime: SdkRuntime): void {
  activeRuntime = runtime;
}

/**
 * Reset the singleton to its pre-init state: drop the runtime, the
 * init promise, and any pending pre-init ops. Called by `shutdown`
 * (after abort + detach) so a subsequent `init` boots cleanly.
 */
function clearRuntime(): void {
  activeRuntime = null;
  activeInitPromise = null;
  preInitQueue = [];
}

/** Register the in-flight init promise so concurrent inits can await it. */
function setInitPromise(promise: Promise<void>): void {
  activeInitPromise = promise;
}

/**
 * Return the in-flight init promise, or `null` when no init is
 * running. Awaited by report methods that need to block on init.
 */
function getInitPromise(): Promise<void> | null {
  return activeInitPromise;
}

/**
 * Append `op` to the FIFO pre-init queue. Used by report methods
 * called before init resolves so the event order is preserved
 * once `drainPreInitQueue` runs.
 */
function enqueuePreInit(op: () => void): void {
  preInitQueue.push(op);
}

/**
 * Allocate the next monotonic `batchNum` for a `.kwub` file and
 * advance the runtime's counter. Centralized here so every code
 * path that writes a batch goes through one place (avoids drift
 * between the send-loop's tick and the shutdown flush).
 *
 * @returns The pre-increment counter value; the next call returns
 *   the value after.
 */
function allocBatchNum(runtime: SdkRuntime): number {
  const n = runtime.nextBatchNum;
  runtime.nextBatchNum = n + 1;
  return n;
}

/**
 * Run every queued pre-init operation in FIFO order and clear the
 * queue. A single bad op cannot block the rest: each invocation is
 * wrapped in `try / catch` so a throwing report drops silently
 * instead of unwinding the boot path.
 */
function drainPreInitQueue(): void {
  const ops = preInitQueue;
  preInitQueue = [];
  for (const op of ops) {
    try {
      op();
    } catch {
      /** Best-effort drain; one bad queued report must not block the rest. */
    }
  }
}

export type { SdkRuntime } from './types/runtime';
export {
  allocBatchNum,
  clearRuntime,
  drainPreInitQueue,
  enqueuePreInit,
  getInitPromise,
  getRuntime,
  getRuntimeOrNull,
  isInitialized,
  isInitializing,
  setInitPromise,
  setRuntime,
};
