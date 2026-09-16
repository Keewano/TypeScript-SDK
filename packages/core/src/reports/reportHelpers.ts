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

/** TextEncoder/TextDecoder are stateless; allocate once at module load. */
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

const NOT_INITIALIZED_MESSAGE = 'Keewano: SDK not initialized. Call Keewano.init() first.';

/**
 * Maximum UTF-16 code-unit length for short-string report payloads.
 * Strings longer than this are truncated by {@link truncateString}
 * before they reach the dispatcher so the wire payload stays bounded
 * and server-side indexing remains efficient.
 */
const MAX_STRING_LENGTH = 256;

/**
 * Drop a trailing lone high surrogate.
 *
 * Every cut in this file operates on UTF-16 code units, so a non-BMP
 * code point (any character outside the Basic Multilingual Plane -
 * such as the CJK extension blocks) is two units: a high
 * surrogate followed by a low one. A cut can land between them, and
 * the UTF-8 encoder in the wire layer writes U+FFFD for the orphan,
 * corrupting the character. Backing off one unit lands the cut on a
 * character boundary instead.
 *
 * Every code unit that shortens a string headed for the wire goes
 * through here. A caller doing its own `.slice` afterwards reopens the
 * hole: the suffix reservation in `reportOnboardingMilestone` did, and
 * corrupted the label on every repeat.
 */
function dropDanglingSurrogate(value: string): string {
  if (value.length === 0) return value;
  /**
   * At the end of `value` there is no following code unit, so
   * `codePointAt` at the last index returns the raw code-unit
   * value (the high surrogate itself, in the 0xD800-0xDBFF range)
   * instead of folding it into a paired code point - which is
   * exactly what we want to detect a lone high surrogate.
   */
  const lastCode = value.codePointAt(value.length - 1) ?? 0;
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    return value.slice(0, -1);
  }
  return value;
}

/**
 * Truncate `value` to {@link MAX_STRING_LENGTH} characters. Returns
 * the input unchanged when it is already short enough. Long strings
 * (e.g. `logError` payloads) bypass this helper and pass through the
 * dispatcher's string-event method directly so debug detail survives.
 */
function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return dropDanglingSurrogate(value.slice(0, MAX_STRING_LENGTH));
}

/**
 * Ceiling for an error payload. Error text is deliberately allowed to
 * be far longer than {@link MAX_STRING_LENGTH} so a stack survives,
 * but it cannot be unbounded: an event is appended to whichever batch
 * slice is open, and the cut that would start a new one is decided
 * from the size BEFORE it. A single oversized message therefore joins
 * the real events already accumulated and pushes the whole slice past
 * what the server accepts, and a rejection on those grounds is
 * permanent - the batch is dropped, taking those events with it. 8 KB
 * holds a message plus a deep stack.
 *
 * The budget this protects is measured in bytes, so this one is too -
 * unlike {@link MAX_STRING_LENGTH}, which is a limit on how long a
 * label may be and is therefore counted in characters. Counting code
 * units here would leave the real ceiling three times higher than the
 * number says, since a character outside Latin encodes to up to three
 * UTF-8 bytes.
 */
const MAX_ERROR_MESSAGE_BYTES = 8 * 1024;

/**
 * Truncate an error payload to {@link MAX_ERROR_MESSAGE_BYTES} of
 * UTF-8, landing on a character boundary.
 *
 * Encoding once and cutting the bytes is what makes the bound exact.
 * Searching for the longest string that fits would re-encode a
 * candidate on every step, and this runs on the error path, which a
 * failing page can drive in a loop.
 */
function truncateErrorMessage(value: string): string {
  const bytes = utf8Encoder.encode(value);
  if (bytes.length <= MAX_ERROR_MESSAGE_BYTES) return value;
  let end = MAX_ERROR_MESSAGE_BYTES;
  /**
   * A UTF-8 continuation byte is 10xxxxxx. While the cut lands on one,
   * it is inside a character; walking back leaves `end` on that
   * character's lead byte, and cutting there drops it whole rather
   * than handing the decoder a partial sequence it would replace with
   * U+FFFD.
   */
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return utf8Decoder.decode(bytes.subarray(0, end));
}

/** Sample current Unix seconds (UTC). Single source of truth for wire timestamps. */
function nowUnixSec(): number {
  return Math.floor(Date.now() / 1000);
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
  const ts = nowUnixSec();
  const op = (runtime: T): void => {
    /**
     * Asked here as well as in the dispatcher, and the two are not
     * redundant: the dispatcher stops the trackers, which hold it
     * directly, while this stops the work a report method does around
     * its emit. A method that writes a one-shot marker or advances a
     * counter and only then emits would otherwise spend that side
     * effect on an event the dispatcher is about to drop.
     */
    if (!runtime.dispatcher.collecting) return;
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
  const ts = nowUnixSec();
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
          if (!live.dispatcher.collecting) {
            resolve();
            return;
          }
          live.dispatcher.setFrameTimestamp(ts);
          Promise.resolve(fn(live)).then(resolve, reject);
        } catch (err: unknown) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }
  const runtime = getRuntime<T>();
  if (!runtime.dispatcher.collecting) return Promise.resolve();
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

export {
  MAX_ERROR_MESSAGE_BYTES,
  MAX_STRING_LENGTH,
  dropDanglingSurrogate,
  nowUnixSec,
  runWhenReady,
  runWhenReadyAsync,
  truncateErrorMessage,
  truncateString,
};
