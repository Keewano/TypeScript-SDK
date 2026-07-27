/**
 * Runtime singleton + pre-init queue: the platform-agnostic lifecycle
 * state holder the shared `report*` surface reads through. The state
 * is module-scoped so the facade can read it without threading a
 * context object through every call site.
 *
 * The singleton stores the base {@link KeewanoRuntime} contract.
 * `getRuntime` / `getRuntimeOrNull` are generic so a platform facade
 * that installed its own superset runtime can read it back at its own
 * type without a cast at every call site - the platform is the single
 * owner of the install-then-read invariant.
 */

import type { KeewanoRuntime } from './types/keewanoRuntime';

import { assertSdkPlatformConfigured } from '../network/helpers/sdkTag';

/**
 * Active runtime singleton. Populated by {@link setRuntime} after a
 * successful init, cleared by {@link clearRuntime} on shutdown.
 */
let activeRuntime: KeewanoRuntime | null = null;

/**
 * Pending init promise. Tracks the in-flight init while it runs so a
 * concurrent second call can await the same promise instead of
 * starting a duplicate boot.
 */
let activeInitPromise: Promise<void> | null = null;

/**
 * Operations queued by report methods called before init resolved.
 * Drained in FIFO order by {@link drainPreInitQueue} once the runtime
 * is set.
 */
let preInitQueue: Array<() => void> = [];

/** `true` when {@link setRuntime} has landed (init completed). */
function isInitialized(): boolean {
  return activeRuntime !== null;
}

/**
 * `true` when an init promise is mid-flight but the runtime has not
 * landed yet. Used by the facade to short-circuit re-init.
 */
function isInitializing(): boolean {
  return activeInitPromise !== null && activeRuntime === null;
}

/**
 * Return the active runtime, or throw when called before init. The
 * generic `T` lets a platform read its own superset runtime back at
 * the type it installed; the active runtime is always the value the
 * platform passed to {@link setRuntime}.
 *
 * @throws Error when no runtime is active.
 */
function getRuntime<T extends KeewanoRuntime = KeewanoRuntime>(): T {
  if (activeRuntime === null) {
    throw new Error('Keewano: SDK not initialized. Call Keewano.init() first.');
  }
  return activeRuntime as T;
}

/**
 * Non-throwing variant of {@link getRuntime}. Returns `null` when no
 * runtime is active. Used by shutdown so idempotent shutdowns do not
 * surface a "not initialized" error.
 */
function getRuntimeOrNull<T extends KeewanoRuntime = KeewanoRuntime>(): T | null {
  return activeRuntime as T | null;
}

/**
 * Install a fresh runtime singleton. Called once per successful init.
 * Validates that the owning SDK declared its platform (every SDK calls
 * `configureSdkPlatform` during init); a forgetful SDK fails the
 * initialization here rather than mis-tagging traffic at send time.
 */
function setRuntime(runtime: KeewanoRuntime): void {
  assertSdkPlatformConfigured();
  activeRuntime = runtime;
}

/**
 * Reset the singleton to its pre-init state: drop the runtime, the
 * init promise, and any pending pre-init ops. Called by shutdown
 * (after abort + detach) so a subsequent init boots cleanly.
 */
function clearRuntime(): void {
  activeRuntime = null;
  activeInitPromise = null;
  /**
   * Drain rather than discard the pre-init queue. A
   * `runWhenReadyAsync` op enqueued while init was in flight holds the
   * resolve / reject of an awaited promise; silently dropping it would
   * leave that promise pending forever when init fails or shutdown
   * runs mid-flight. With the runtime now null every op's `getRuntime`
   * throws: async ops route that to their `reject` (settling the
   * awaiter), sync ops drop via `drainPreInitQueue`'s catch (they
   * returned void, so there is no awaiter to settle).
   */
  drainPreInitQueue();
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
 * called before init resolves so the event order is preserved once
 * {@link drainPreInitQueue} runs.
 */
function enqueuePreInit(op: () => void): void {
  preInitQueue.push(op);
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

export {
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
