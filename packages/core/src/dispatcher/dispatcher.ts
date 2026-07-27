/**
 * Core event accumulator: receives `addEvent*` calls, validates them,
 * forwards the encoding to the active codec's `BatchBuilder`, marks
 * the wake signal when the encoded size crosses the threshold, and
 * exposes a swap + signal pair so a send loop can hand off a frozen
 * batch for persistence and HTTP delivery.
 *
 * The dispatcher is single-threaded by virtue of the JS event loop, so
 * the swap-and-clear of `inBatch` happens in one synchronous tick from
 * the caller's perspective. External readers of `sendingBatch` never
 * observe a partially-cleared accumulator.
 *
 * Scope: input validation, frame-timestamp policy, threshold
 * bookkeeping, atomic swap, signal mechanism, and identity setters.
 * Byte encoding and cut placement live in the codec's builder;
 * storage-aware behaviours (custom-event map loading, the send loop,
 * on-disk batch sizing) live in the storage / network layers.
 *
 * @example
 * ```ts
 * const dispatcher = new KEventDispatcher({
 *   installId, userId, dataSessionId,
 *   initialTimestamp: Math.floor(Date.now() / 1000),
 * });
 *
 * dispatcher.addEventString({ eventId: KEvents.BUTTON_CLICK, str: 'Play' });
 * dispatcher.addEventBool({ eventId: KEvents.GENUINITY_CHECK, flag: false });
 *
 * dispatcher.swapBatches();
 * const frozen = dispatcher.currentSendingBatch;
 * ```
 */

import type {
  AddEventBoolArgs,
  AddEventDateTimeArgs,
  AddEventNumberArgs,
  AddEventStringArgs,
  AddEventStringCharArgs,
  AddEventStringItemsArgs,
  AddEventStringItemsExchangeArgs,
  AddEventUint16x2Args,
  KEventDispatcherArgs,
  WaitForSignalArgs,
} from './types/dispatcher';
import type { Codec } from '../codec/types/codec';

import { BinaryCodec } from '../codec/binaryCodec';
import { assertIntInRange, assertNonZeroBytes, assertUint8Array } from '../encoding/assertions';
import { LIMITS } from '../encoding/limits';
import { KEvents } from '../events/kevents';
import { hasControlChar, isByteString } from '../validation';

import { KBatch } from './batch';

/**
 * Wire-protocol byte sizes referenced by `sendIfNeeded`.
 *
 * - WAKE - in-batch byte threshold that signals the send loop.
 * - CUT - byte delta since the last cut at which the builder records
 *   a cut point so the send loop can slice an oversized batch into
 *   multiple sub-batches on persistence.
 *
 * The per-event-string truncation limit (256 chars for short-string
 * events) is enforced at the public report layer, not here. The
 * dispatcher forwards whatever string it gets.
 */
const THRESHOLDS = {
  CUT: 50 * 1024,
  WAKE: 1024,
} as const;

class KEventDispatcher {
  private inBatch: KBatch;
  private sendingBatch: KBatch;
  private userId: Uint8Array;
  private frameTimestamp: number;
  private testUserName: string | null;
  private sendTestUserName: string | null;

  private signalResolver: ((value: boolean) => void) | null;
  private signalTimer: ReturnType<typeof setTimeout> | null;
  private signalPending: boolean;

  /**
   * When `true`, the idle `waitForSignal` timer is `unref`-ed so a
   * parked send loop never keeps a Node process alive. No-op where the
   * host timer is a bare number (React Native / web); only the Node
   * facade passes `true`.
   */
  private readonly unrefTimers: boolean;

  /**
   * Construct a fresh dispatcher with empty `inBatch` / `sendingBatch`
   * pair and no test-user marker. Both batches encode through builders
   * created by `codec` (the binary codec unless the host injects
   * another implementation).
   *
   * Caller owns the lifetime of the passed UUID buffers; the dispatcher
   * stores them by reference and assumes they are immutable for the
   * duration of the session. Do not mutate the underlying bytes after
   * passing them in.
   *
   * The dispatcher itself holds the test-user marker in memory only and
   * starts every session with `pendingTestUserName === null`. The host
   * persists and restores the marker across launches in its own storage
   * layer (re-applying it via `markAsTestUser` during init); the
   * dispatcher has no knowledge of that persistence.
   */
  constructor({
    installId,
    userId,
    dataSessionId,
    initialTimestamp,
    codec,
    unrefTimers = false,
  }: KEventDispatcherArgs) {
    assertIntInRange({
      fnName: 'KEventDispatcher initialTimestamp',
      max: LIMITS.UINT32_MAX,
      min: 0,
      n: initialTimestamp,
    });
    assertUint8Array({
      fnName: 'KEventDispatcher dataSessionId',
      value: dataSessionId,
      expectedLength: 16,
    });
    assertNonZeroBytes({ bytes: dataSessionId, fnName: 'KEventDispatcher dataSessionId' });
    assertUint8Array({
      fnName: 'KEventDispatcher installId',
      value: installId,
      expectedLength: 16,
    });
    /**
     * No non-zero check on installId: an all-zero id is the legitimate
     * server-relay sentinel. A device SDK validates its install id
     * non-zero at load time before it reaches here.
     */
    assertUint8Array({
      fnName: 'KEventDispatcher userId',
      value: userId,
      expectedLength: 16,
    });

    const resolvedCodec: Codec = codec ?? new BinaryCodec();
    this.sendingBatch = new KBatch({
      installId,
      userId,
      dataSessionId,
      builder: resolvedCodec.createBuilder({ cutThresholdBytes: THRESHOLDS.CUT }),
    });
    this.inBatch = new KBatch({
      installId,
      userId,
      dataSessionId,
      builder: resolvedCodec.createBuilder({ cutThresholdBytes: THRESHOLDS.CUT }),
    });
    this.userId = userId;
    this.frameTimestamp = initialTimestamp;
    this.testUserName = null;
    this.sendTestUserName = null;
    this.signalResolver = null;
    this.signalTimer = null;
    this.signalPending = false;
    this.unrefTimers = unrefTimers;
  }

  /**
   * Replace the timestamp written into every subsequent event-record
   * header. Callers typically refresh this on app-frame ticks or on
   * lifecycle transitions (e.g. AppState change) so consecutive events
   * carry monotonically advancing timestamps.
   *
   * @param unixSec - UTC Unix seconds.
   */
  setFrameTimestamp(unixSec: number): void {
    assertIntInRange({
      fnName: 'setFrameTimestamp',
      max: LIMITS.UINT32_MAX,
      min: 0,
      n: unixSec,
    });
    this.frameTimestamp = unixSec;
  }

  /**
   * Read access to the in-batch accumulator. Exposed for tests and
   * for the send loop to inspect `byteSize()` before swapping.
   */
  get currentInBatch(): KBatch {
    return this.inBatch;
  }

  /**
   * Read access to the frozen sending-side batch. Populated by
   * {@link swapBatches}; before the first swap it is an empty batch.
   */
  get currentSendingBatch(): KBatch {
    return this.sendingBatch;
  }

  /**
   * The most recently captured test-user marker that should travel
   * with the next outgoing batch, or `null` if the current user is
   * not flagged as a test user. Populated by {@link swapBatches}
   * from {@link markAsTestUser}.
   */
  get pendingTestUserName(): string | null {
    return this.sendTestUserName;
  }

  // --- addEvent overloads ---

  /**
   * Emit a no-payload event. Wire layout: `HDR (6 bytes)`.
   *
   * @param eventId - One of the {@link KEvents} values.
   */
  addEvent(eventId: number): void {
    const timestamp = this.resolveHeader(eventId);
    this.inBatch.builder.addEvent({ eventId, timestamp });
    this.sendIfNeeded();
  }

  /**
   * Emit a string-payload event. Wire layout:
   * `HDR | varint(utf8_len) | utf8_bytes`.
   *
   * The dispatcher does not truncate; the public report layer
   * pre-truncates to 256 chars for short-string events. `logError`
   * (long-string event) passes the full string without pre-truncation
   * - same wire format, no separate dispatcher method needed.
   *
   * @param args - Event ID and string payload.
   */
  addEventString({ eventId, str }: AddEventStringArgs): void {
    if (typeof str !== 'string') {
      throw new TypeError('addEventString: not a string');
    }
    const timestamp = this.resolveHeader(eventId);
    this.inBatch.builder.addEventString({ eventId, timestamp, str });
    this.sendIfNeeded();
  }

  /**
   * Emit a uint32-payload event. Wire layout: `HDR | u32_LE`.
   *
   * @param args - Event ID and uint32 value.
   */
  addEventUint32({ eventId, value }: AddEventNumberArgs): void {
    assertIntInRange({
      fnName: 'addEventUint32',
      max: LIMITS.UINT32_MAX,
      min: 0,
      n: value,
    });
    const timestamp = this.resolveHeader(eventId);
    this.inBatch.builder.addEventUint32({ eventId, timestamp, value });
    this.sendIfNeeded();
  }

  /**
   * Emit a two-uint16-payload event. Wire layout:
   * `HDR | u16_LE | u16_LE`. Used by `SCREEN_RESOLUTION` at init.
   *
   * @param args - Event ID, x, and y.
   */
  addEventUint16x2({ eventId, x, y }: AddEventUint16x2Args): void {
    assertIntInRange({
      fnName: 'addEventUint16x2 x',
      max: LIMITS.UINT16_MAX,
      min: 0,
      n: x,
    });
    assertIntInRange({
      fnName: 'addEventUint16x2 y',
      max: LIMITS.UINT16_MAX,
      min: 0,
      n: y,
    });
    const timestamp = this.resolveHeader(eventId);
    this.inBatch.builder.addEventUint16x2({ eventId, timestamp, x, y });
    this.sendIfNeeded();
  }

  /**
   * Emit a date-payload event. Wire layout: `HDR | u32_LE` where the
   * payload is the user-supplied date converted to UTC Unix seconds.
   * The event-record header timestamp is independent and reflects the
   * dispatcher's current `frameTimestamp`.
   *
   * @param args - Event ID and date (JS `Date` or Unix seconds).
   */
  addEventDateTime({ eventId, date }: AddEventDateTimeArgs): void {
    const dateUnixSec = typeof date === 'number' ? date : Math.floor(date.getTime() / 1000);
    assertIntInRange({
      fnName: 'addEventDateTime',
      max: LIMITS.UINT32_MAX,
      min: 0,
      n: dateUnixSec,
    });
    const timestamp = this.resolveHeader(eventId);
    this.inBatch.builder.addEventDateTime({ eventId, timestamp, dateUnixSec });
    this.sendIfNeeded();
  }

  /**
   * Emit an int32-payload event. Wire layout: `HDR | i32_LE`.
   *
   * @param args - Event ID and signed int32 value.
   */
  addEventInt32({ eventId, value }: AddEventNumberArgs): void {
    assertIntInRange({
      fnName: 'addEventInt32',
      max: LIMITS.INT32_MAX,
      min: LIMITS.INT32_MIN,
      n: value,
    });
    const timestamp = this.resolveHeader(eventId);
    this.inBatch.builder.addEventInt32({ eventId, timestamp, value });
    this.sendIfNeeded();
  }

  /**
   * Emit a bool-payload event. Wire layout: `HDR | bool_byte` where
   * the byte is `0x02` for true and `0x01` for false. Used by
   * `GENUINITY_CHECK` at init.
   *
   * @param args - Event ID and boolean.
   */
  addEventBool({ eventId, flag }: AddEventBoolArgs): void {
    if (typeof flag !== 'boolean') {
      throw new TypeError('addEventBool: not a boolean');
    }
    const timestamp = this.resolveHeader(eventId);
    this.inBatch.builder.addEventBool({ eventId, timestamp, flag });
    this.sendIfNeeded();
  }

  /**
   * Emit a uint8-payload event. Wire layout: `HDR | u8`. Used by
   * `AD_OFFERED_TYPE` (the ad-type ordinal).
   *
   * @param args - Event ID and byte value in [0, 255].
   */
  addEventUint8({ eventId, value }: AddEventNumberArgs): void {
    assertIntInRange({
      fnName: 'addEventUint8',
      max: 0xff,
      min: 0,
      n: value,
    });
    const timestamp = this.resolveHeader(eventId);
    this.inBatch.builder.addEventUint8({ eventId, timestamp, value });
    this.sendIfNeeded();
  }

  /**
   * Emit a float32-payload event. Wire layout: `HDR | f32_LE`. Used
   * by the localized revenue amounts. The report layer pre-clamps to
   * a non-negative finite float.
   *
   * @param args - Event ID and float value.
   */
  addEventFloat32({ eventId, value }: AddEventNumberArgs): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError('addEventFloat32: not a finite number');
    }
    const timestamp = this.resolveHeader(eventId);
    this.inBatch.builder.addEventFloat32({ eventId, timestamp, value });
    this.sendIfNeeded();
  }

  /**
   * Emit a string event with a trailing single-byte code. Wire
   * layout: `HDR | varint(utf8_len) | utf8_bytes | u8`. Used by
   * `AB_TEST_ASSIGNMENT` (test name + group letter).
   *
   * @param args - Event ID, pre-truncated string, and byte code.
   */
  addEventStringChar({ eventId, str, charCode }: AddEventStringCharArgs): void {
    if (typeof str !== 'string') {
      throw new TypeError('addEventStringChar: not a string');
    }
    assertIntInRange({
      fnName: 'addEventStringChar charCode',
      max: 0xff,
      min: 0,
      n: charCode,
    });
    const timestamp = this.resolveHeader(eventId);
    this.inBatch.builder.addEventStringChar({ eventId, timestamp, str, charCode });
    this.sendIfNeeded();
  }

  /**
   * Emit a string event with one trailing items array. Wire layout:
   * `HDR | string | int32 count | repeating(string name, u32 count)`.
   * Used by the items-granted family and `ITEMS_RESET`. The report
   * layer pre-normalizes the entries (filter / truncate / clamp).
   *
   * @param args - Event ID, pre-truncated label, normalized items.
   */
  addEventStringItems({ eventId, str, items }: AddEventStringItemsArgs): void {
    if (typeof str !== 'string') {
      throw new TypeError('addEventStringItems: not a string');
    }
    const timestamp = this.resolveHeader(eventId);
    this.inBatch.builder.addEventStringItems({ eventId, timestamp, str, items });
    this.sendIfNeeded();
  }

  /**
   * Emit a string event with two trailing items arrays (`from`, then
   * `to`). Used by `ITEMS_EXCHANGE`. The report layer pre-normalizes
   * both sides.
   *
   * @param args - Event ID, pre-truncated label, normalized sides.
   */
  addEventStringItemsExchange({ eventId, str, from, to }: AddEventStringItemsExchangeArgs): void {
    if (typeof str !== 'string') {
      throw new TypeError('addEventStringItemsExchange: not a string');
    }
    const timestamp = this.resolveHeader(eventId);
    this.inBatch.builder.addEventStringItemsExchange({ eventId, timestamp, str, from, to });
    this.sendIfNeeded();
  }

  // --- swap + signal ---

  /**
   * Atomically swap the in-batch and sending-side batch references,
   * then reset the freshly-promoted accumulator. The test-user marker,
   * if any, also moves to the send-side and is cleared on the
   * collect-side so the next batch starts without it.
   *
   * Data-loss invariant: the send loop must persist or transmit the
   * previous `sendingBatch` and clear its builder (via `resetForReuse`)
   * before calling `swapBatches` again. A second swap before
   * consumption throws rather than silently overwriting the unsent
   * snapshot.
   *
   * @throws Error when `sendingBatch.byteSize() !== 0`, i.e. the
   *   previously frozen batch has not yet been consumed by the send
   *   loop.
   */
  swapBatches(): void {
    if (this.sendingBatch.byteSize() !== 0) {
      throw new Error('swapBatches: previous batch not consumed');
    }

    const tmp = this.sendingBatch;
    this.sendingBatch = this.inBatch;
    this.inBatch = tmp;

    this.inBatch.resetForReuse();
    this.inBatch.userId = this.userId;

    if (this.testUserName !== null) {
      this.sendTestUserName = this.testUserName;
      this.testUserName = null;
    }
  }

  /**
   * Resolve any pending {@link waitForSignal} promise. If no waiter
   * is currently registered, the signal is sticky and the next
   * `waitForSignal` will resolve immediately. Behaves like a
   * single-slot AutoResetEvent: one call to `signalSend` wakes at
   * most one waiter.
   */
  signalSend(): void {
    if (this.signalResolver === null) {
      this.signalPending = true;
      return;
    }
    const resolve = this.signalResolver;
    const timer = this.signalTimer;
    this.signalResolver = null;
    this.signalTimer = null;
    if (timer !== null) {
      clearTimeout(timer);
    }
    resolve(true);
  }

  /**
   * Wait for a {@link signalSend} call or for `timeoutMs` to elapse.
   * Returns `true` on signal, `false` on timeout.
   *
   * Contract: only one waiter may be pending at a time. The send loop
   * is the sole intended caller; calling this method while a previous
   * call has not yet resolved throws because two waiters would race
   * for a single signal and the second would orphan the first's
   * timeout. If multiple consumers ever need wake-up, replace the
   * single-slot resolver with a FIFO queue, not a silent overwrite.
   *
   * @param args - Maximum wait in milliseconds.
   * @returns Promise resolving to `true` on signal or `false` on timeout.
   * @throws Error when a previous `waitForSignal` is still pending.
   */
  waitForSignal({ timeoutMs }: WaitForSignalArgs): Promise<boolean> {
    assertIntInRange({
      fnName: 'waitForSignal timeoutMs',
      max: LIMITS.INT32_MAX,
      min: 0,
      n: timeoutMs,
    });

    if (this.signalPending) {
      this.signalPending = false;
      return Promise.resolve(true);
    }

    if (this.signalResolver !== null) {
      throw new Error('waitForSignal: already pending');
    }

    return new Promise<boolean>((resolve) => {
      this.signalTimer = setTimeout(() => {
        this.signalResolver = null;
        this.signalTimer = null;
        resolve(false);
      }, timeoutMs);
      if (this.unrefTimers) {
        /** Optional-call so a host that sets the flag on a runtime whose
         * `setTimeout` returns a bare number (non-Node) is a no-op, not a crash. */
        (this.signalTimer as { unref?: () => void }).unref?.();
      }

      this.signalResolver = resolve;
    });
  }

  /**
   * Cancel a pending {@link waitForSignal}: clear its idle timer and
   * resolve the waiter with `false`. The host calls this on shutdown
   * AFTER the send loop has aborted, so the idle timer (up to the full
   * timeout, typically 30s) does not keep the dispatcher - and through
   * it both `KBatch` buffers - reachable past teardown. Idempotent and
   * safe to call when no wait is pending.
   */
  cancelPendingWait(): void {
    const resolve = this.signalResolver;
    const timer = this.signalTimer;
    this.signalResolver = null;
    this.signalTimer = null;
    this.signalPending = false;
    if (timer !== null) {
      clearTimeout(timer);
    }
    if (resolve !== null) {
      resolve(false);
    }
  }

  // --- identity + test user ---

  /**
   * Update the user-identifier UUID, propagate it into the in-batch
   * for the next on-disk write, and emit a `USER_ID_ASSIGNED` event
   * marker into the current event stream. The marker has no payload;
   * the new UUID travels via the container metadata on the next swap.
   *
   * Caller owns the passed buffer's lifetime; the dispatcher stores it
   * by reference and assumes it is immutable. Do not mutate the bytes
   * after passing them in.
   *
   * The marker is a real 6-byte event record, so it goes through the
   * same threshold bookkeeping as any other event: if it pushes the
   * in-batch past `THRESHOLDS.WAKE` the send loop is signaled, and the
   * builder records a cut before it when the cut threshold is crossed.
   *
   * @param userId - 16-byte user UUID.
   */
  setUserId(userId: Uint8Array): void {
    assertUint8Array({
      fnName: 'setUserId',
      value: userId,
      expectedLength: 16,
    });

    const timestamp = this.resolveHeader(KEvents.USER_ID_ASSIGNED);
    this.inBatch.builder.addEvent({ eventId: KEvents.USER_ID_ASSIGNED, timestamp });
    this.userId = userId;
    this.inBatch.userId = userId;
    this.sendIfNeeded();
  }

  /**
   * Tag the current dispatcher's outgoing batches as belonging to a
   * QA tester. The name surfaces on the send-side after the next
   * swap and is consumed by the HTTP transport as the `K-Tester`
   * header value.
   *
   * The dispatcher keeps the marker in memory only; the host owns
   * persisting it across launches and re-applies it here during init.
   *
   * The name lands directly in the outbound `K-Tester` HTTP header,
   * so the input is constrained to the same ByteString contract the
   * network layer enforces.
   */
  markAsTestUser(testerName: string): void {
    if (typeof testerName !== 'string' || testerName.length === 0 || hasControlChar(testerName)) {
      throw new TypeError('markAsTestUser: invalid tester name');
    }
    if (!isByteString(testerName)) {
      throw new TypeError('markAsTestUser: non-ByteString character');
    }
    this.testUserName = testerName;
  }

  // --- internal helpers ---

  /**
   * Validate the record-header pair (current frame timestamp + event
   * id) and return the timestamp the builder must stamp. Kept as the
   * single validation point for every addEvent path; the historical
   * `writeHeader` fnName is preserved in the error messages.
   */
  private resolveHeader(eventId: number): number {
    const ts = this.frameTimestamp;

    assertIntInRange({
      fnName: 'writeHeader frameTimestamp',
      max: LIMITS.UINT32_MAX,
      min: 0,
      n: ts,
    });

    assertIntInRange({
      fnName: 'writeHeader eventId',
      max: LIMITS.UINT16_MAX,
      min: 0,
      n: eventId,
    });

    return ts;
  }

  /**
   * Wake the send loop once the in-batch crosses the WAKE threshold
   * (1 KB) so it ships on its next iteration instead of waiting out the
   * idle timer. Cut-point recording lives in the builder (at event
   * boundaries), so a cut never lands mid-event.
   */
  private sendIfNeeded(): void {
    if (this.inBatch.byteSize() >= THRESHOLDS.WAKE) {
      this.signalSend();
    }
  }
}

export type {
  AddEventBoolArgs,
  AddEventDateTimeArgs,
  AddEventNumberArgs,
  AddEventStringArgs,
  AddEventStringCharArgs,
  AddEventStringItemsArgs,
  AddEventStringItemsExchangeArgs,
  AddEventUint16x2Args,
  KEventDispatcherArgs,
  WaitForSignalArgs,
} from './types/dispatcher';
export { KEventDispatcher, THRESHOLDS };
