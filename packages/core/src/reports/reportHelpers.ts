/**
 * Shared helpers for the `Keewano.report*` family. Every method
 * follows the same template:
 *   1. Truncate string args to 256 chars.
 *   2. Look up the active runtime (or queue the call if init has
 *      not resolved yet).
 *   3. Emit one or more events via the dispatcher.
 *
 * `runWhenReady` centralizes the runtime lookup / pre-init queue
 * branch so individual report methods stay tiny. Both helpers are
 * generic over the runtime type so a platform facade can read its own
 * superset runtime back while the shared report methods read only the
 * base {@link KeewanoRuntime}.
 */

import type { KeewanoRuntime } from '../runtime';

import { enqueuePreInit, getRuntime, isInitialized, isInitializing } from '../runtime';

const NOT_INITIALIZED_MESSAGE = 'Keewano: SDK not initialized. Call Keewano.init() first.';

/**
 * Maximum UTF-16 code-unit length for short-string report payloads.
 * Strings longer than this are truncated by {@link truncateString}
 * before they reach the dispatcher so the wire payload stays bounded
 * and server-side indexing remains efficient.
 */
const MAX_STRING_LENGTH = 256;

/**
 * Truncate `value` to {@link MAX_STRING_LENGTH} characters. Returns
 * the input unchanged when it is already short enough. Long strings
 * (e.g. `logError` payloads) bypass this helper and pass through the
 * dispatcher's string-event method directly so debug detail survives.
 *
 * The slice operates on UTF-16 code units, so a non-BMP code point
 * (any character outside the Basic Multilingual Plane - emojis,
 * many CJK extension characters, etc.) is two code units (a high
 * surrogate followed by a low surrogate). A naive `.slice(0, 256)`
 * can land between those two units and leave a trailing lone high
 * surrogate; the UTF-8 encoder used by the wire layer then writes
 * U+FFFD for that orphan, corrupting the character. We back off by
 * one code unit when the slice ends on a high surrogate so the
 * truncation always lands on a character boundary.
 */
function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  const sliced = value.slice(0, MAX_STRING_LENGTH);
  /**
   * At the end of `sliced` there is no following code unit, so
   * `codePointAt` at the last index returns the raw code-unit
   * value (the high surrogate itself, in the 0xD800-0xDBFF range)
   * instead of folding it into a paired code point - which is
   * exactly what we want to detect a lone high surrogate.
   */
  const lastCode = sliced.codePointAt(sliced.length - 1) ?? 0;
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    return sliced.slice(0, -1);
  }
  return sliced;
}

/**
 * Run `fn` against the active runtime, or queue it on the pre-init
 * FIFO when no runtime is set yet. Queued ops execute in order on
 * `drainPreInitQueue` once init resolves, so events emitted before
 * init survive intact and land in the right session.
 *
 * The wall-clock timestamp is captured at CALL time (not at drain
 * time) and applied as the dispatcher's frame timestamp before `fn`
 * runs. This means a `reportButtonClick` invoked before init still
 * lands with the actual click time on the wire instead of the
 * drain-time stamp. Composite reports that need a shared timestamp
 * across multiple events overwrite this with their own sample
 * inside `fn`, so the per-burst contract still holds.
 */
function runWhenReady<T extends KeewanoRuntime = KeewanoRuntime>(fn: (runtime: T) => void): void {
  const ts = Math.floor(Date.now() / 1000);
  const op = (runtime: T): void => {
    runtime.dispatcher.setFrameTimestamp(ts);
    fn(runtime);
  };
  if (!isInitialized()) {
    /**
     * Only buffer reports while an init() is actually in flight. A
     * call before init() ever started OR after shutdown() would
     * otherwise sit in the pre-init queue forever (or leak across
     * sessions if init() runs later in the same JS context). Throw
     * immediately so the host learns about the misuse instead of
     * seeing apparent success followed by silent data loss.
     */
    if (!isInitializing()) {
      throw new Error(NOT_INITIALIZED_MESSAGE);
    }
    enqueuePreInit(() => op(getRuntime<T>()));
    return;
  }
  op(getRuntime<T>());
}

/**
 * Async variant of {@link runWhenReady}. Captures the call-time
 * timestamp the same way so a pre-init queued async report still
 * stamps its events with the action time, not the drain time.
 *
 * @returns Promise that resolves when `fn` resolves.
 * @throws Propagates whatever `fn` rejects with, so callers awaiting
 *   the returned promise see the same failure mode they would have
 *   seen had the runtime been ready when they called.
 */
function runWhenReadyAsync<T extends KeewanoRuntime = KeewanoRuntime>(
  fn: (runtime: T) => Promise<void>,
): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  if (!isInitialized()) {
    /**
     * Mirror the sync guard: a queued op that never drains would
     * leave the returned promise pending forever. Reject up front
     * when no init() is actually in flight so callers cannot hang.
     */
    if (!isInitializing()) {
      return Promise.reject(new Error(NOT_INITIALIZED_MESSAGE));
    }
    return new Promise<void>((resolve, reject) => {
      enqueuePreInit(() => {
        /**
         * `getRuntime` throws when the runtime was cleared between
         * the enqueue and the drain (e.g. shutdown ran while init
         * was still mid-flight). drainPreInitQueue catches throws
         * silently, so without this guard the outer promise would
         * pend forever. Route the throw to `reject` instead.
         *
         * Call `setFrameTimestamp(ts)` and `fn(live)` SYNCHRONOUSLY
         * inside this try block (no extra `.then`) so the events
         * emitted by `fn` land in the dispatcher in the same task
         * the queued op runs in - preserving the pre-init FIFO
         * ordering. A `.then(() => fn(...))` defers `fn` to the next
         * microtask, letting a later SYNC `runWhenReady` overtake
         * this async report and reorder emissions on the wire. The
         * `Promise.resolve(fn(live))` wrap promotes a sync throw
         * from `fn` to a rejection while leaving an async-returning
         * `fn` value unwrapped, so the rejection contract still
         * holds without trading order for it.
         */
        try {
          const live = getRuntime<T>();
          live.dispatcher.setFrameTimestamp(ts);
          Promise.resolve(fn(live)).then(resolve, reject);
        } catch (err: unknown) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }
  const runtime = getRuntime<T>();
  /**
   * Immediate path: setFrameTimestamp(ts) + fn(runtime) run in the
   * caller's task synchronously, preserving emission order against
   * concurrent sync reports. `Promise.resolve(fn(runtime))` keeps
   * the rejection contract for sync throws without introducing the
   * extra microtask hop that a `.then(() => fn(...))` would (which
   * lets later sync reports overtake this one in dispatcher order).
   */
  try {
    runtime.dispatcher.setFrameTimestamp(ts);
    return Promise.resolve(fn(runtime));
  } catch (err: unknown) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

export { MAX_STRING_LENGTH, runWhenReady, runWhenReadyAsync, truncateString };
