/**
 * Facade identity + marker operations: the developer-supplied user id,
 * the QA test-user marker, the install id read, and the one-shot
 * pre-SDK registration report. Split out of `keewano.ts` so the facade
 * file keeps to lifecycle (init / shutdown / consent-gated send-loop
 * control) while these caller-to-runtime operations live alongside the
 * other `report*` surfaces in `api/`.
 *
 * None of these control the send loop, so unlike `setUserConsent` they
 * carry no lifecycle coupling; they only read or mutate runtime
 * identity state and persist it best-effort.
 */

import {
  GUID_SIZE,
  KEvents,
  guidBytesToString,
  guidToBytes,
  hasControlChar,
  isByteString,
  isPreSdkRegistered,
  markPreSdkRegistered,
  persistIdentifiers,
  persistTestUserName,
} from '@keewano/core';

import {
  enqueuePreInit,
  getInitPromise,
  getRuntime,
  isInitialized,
  isInitializing,
} from '../runtime';

/**
 * Return the persisted install GUID. Awaits the in-flight init
 * promise so callers that race the boot do not see an empty buffer.
 *
 * @returns Lowercase hyphenated `"D"` format string
 *   (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
 */
async function getInstallId(): Promise<string> {
  const pending = getInitPromise();
  if (pending !== null) await pending;
  const runtime = getRuntime();
  return guidBytesToString(runtime.installId);
}

/**
 * Assign the developer-supplied user identity. Accepts either a
 * lowercase hyphenated GUID string or a `bigint` (packed into the
 * last 8 bytes via {@link bigintToGuidBytes}). Queued when called
 * before init.
 *
 * In-memory state (dispatcher + `runtime.userId`) is updated
 * synchronously so callers can rely on subsequent reads. Disk
 * persistence is async and fire-and-forget so the call does not
 * block the host; persistence failure is logged via
 * `console.error` (the host can re-call `setUserId` to retry).
 *
 * GUID parse errors are surfaced eagerly: the parse runs in the
 * caller frame BEFORE any queueing, so an invalid string variant
 * throws synchronously regardless of init state.
 *
 * @throws RangeError when the string variant is not a 36-char
 *   hyphenated GUID.
 */
function setUserId(userId: string | bigint): void {
  const bytes = typeof userId === 'bigint' ? bigintToGuidBytes(userId) : guidToBytes(userId);
  const op = (): void => {
    const runtime = getRuntime();
    runtime.dispatcher.setUserId(bytes);
    runtime.userId = bytes;
    persistIdentifiers({
      storage: runtime.storage,
      identifiers: { installId: runtime.installId, userId: bytes },
    }).catch((err: unknown) => {
      console.error('Keewano.setUserId: persistence failed.', err);
    });
  };
  if (!isInitialized()) {
    /**
     * Only buffer while an init() is actually in flight. A call
     * made BEFORE init() ever started OR AFTER shutdown() would
     * otherwise sit in the pre-init queue forever and leak into a
     * future session's init(). Match the runWhenReady gate so the
     * host learns about the misuse synchronously instead of seeing
     * apparent success followed by a stale identity applied during
     * a later launch.
     */
    if (!isInitializing()) {
      throw new Error('Keewano.setUserId: SDK not initialized. Call Keewano.init() first.');
    }
    enqueuePreInit(op);
    return;
  }
  op();
}

/**
 * Tag the current session's outgoing batches with a QA-tester name.
 * The dispatcher stores it and promotes it to `pendingTestUserName`
 * on the next swap; the send loop reads that getter live per ship,
 * so the name lands in `K-Tester` HTTP header on every subsequent
 * batch. Queued when called before init resolves.
 *
 * The name is also written through to disk so it survives an app
 * restart. Persistence is fire-and-forget; failures surface via
 * `console.error` and do not block the call.
 *
 * Validation runs in the caller's frame BEFORE any pre-init
 * queueing, so an invalid name throws synchronously regardless of
 * init state - otherwise the queued op would only fail later inside
 * `drainPreInitQueue`, where the throw is swallowed and the host
 * sees apparent success followed by a silent drop.
 *
 * @throws TypeError when `name` is empty, contains any HTTP-header
 *   control character (C0 controls U+0000-U+001F plus DEL U+007F),
 *   or contains a code point above 0xFF.
 */
function markAsTestUser(name: string): void {
  /**
   * Reject the full set of HTTP-header control characters, not
   * just CR/LF. NUL terminates many native header parsers; tab is
   * structural in folded headers; the rest of the C0 range plus
   * DEL fail the Fetch ByteString-with-value-token contract.
   * Catching them here surfaces the misuse synchronously instead
   * of letting it crash inside the request constructor later.
   */
  if (typeof name !== 'string' || name.length === 0 || hasControlChar(name)) {
    throw new TypeError('Keewano.markAsTestUser: invalid tester name.');
  }
  if (!isByteString(name)) {
    throw new TypeError('Keewano.markAsTestUser: non-ByteString character.');
  }
  const op = (): void => {
    const runtime = getRuntime();
    runtime.dispatcher.markAsTestUser(name);
    persistTestUserName({ storage: runtime.storage, testUserName: name }).catch((err: unknown) => {
      console.error('Keewano.markAsTestUser: persistence failed.', err);
    });
  };
  if (!isInitialized()) {
    /**
     * Same isInitializing gate as setUserId / runWhenReady. A call
     * made before init() ever started OR after shutdown() would
     * otherwise queue forever and leak the tester marker into a
     * future session's init().
     */
    if (!isInitializing()) {
      throw new Error('Keewano.markAsTestUser: SDK not initialized. Call Keewano.init() first.');
    }
    enqueuePreInit(op);
    return;
  }
  op();
}

/**
 * One-shot report of the date a user registered before this SDK was
 * integrated into the host app. The pre-SDK marker is written to
 * disk BEFORE the event is dispatched so a storage failure between
 * the two does NOT leave the event-emitted-but-marker-missing state
 * (which would re-emit on the next launch).
 */
async function reportUserRegisteredBeforeSDKIntegration(date: Date): Promise<void> {
  /**
   * Reject non-Date / invalid (NaN) / future inputs. Non-Date
   * inputs (null, string, plain object) can reach this method from
   * JS-only callers that bypass the TS signature; calling .getTime()
   * on them would throw and surface as an unhandled rejection
   * instead of the silent-drop the JSDoc above promises. NaN slips
   * past a naive `> Date.now()` check (every comparison with NaN is
   * false), and a future registration timestamp is always a host
   * bug. The event is one-shot - a bad emission would burn the
   * marker irreversibly - so silent drop is the right policy.
   */
  if (!(date instanceof Date)) {
    return;
  }
  const timestampMs = date.getTime();
  if (!Number.isFinite(timestampMs) || timestampMs > Date.now()) {
    return;
  }
  const pending = getInitPromise();
  if (pending !== null) await pending;
  const runtime = getRuntime();
  /**
   * Serialize concurrent callers via an in-flight Promise on the
   * runtime. Without this latch, two parallel calls both observe
   * `isPreSdkRegistered === false` (the check happens before
   * either has had a chance to mark) and both emit the event,
   * burning the one-shot slot with a duplicate. The second caller
   * now awaits the first's check/mark/emit sequence, then
   * re-checks `isPreSdkRegistered()` (which is now `true`) and
   * silently no-ops. The latch lives on the runtime so
   * `shutdown()` clears it - module-scope storage would survive
   * shutdown + re-init and corrupt the one-shot contract across
   * sessions.
   */
  if (runtime.preSdkInFlight !== null) {
    await runtime.preSdkInFlight;
    if (await isPreSdkRegistered({ storage: runtime.storage })) return;
  }
  const inFlight = (async (): Promise<void> => {
    if (await isPreSdkRegistered({ storage: runtime.storage })) return;
    await markPreSdkRegistered({ storage: runtime.storage });
    runtime.dispatcher.addEventDateTime({
      eventId: KEvents.PRE_SDK_REGISTRATION_DATE,
      date,
    });
  })();
  runtime.preSdkInFlight = inFlight;
  try {
    await inFlight;
  } finally {
    /** Clear only if the slot still points at this invocation's promise. */
    if (runtime.preSdkInFlight === inFlight) {
      runtime.preSdkInFlight = null;
    }
  }
}

/**
 * Pack a bigint into the last 8 bytes of an otherwise-zero 16-byte
 * GUID buffer. The first 8 bytes remain zero; the server treats this
 * layout as a "compact integer userId" rather than a regular GUID,
 * per the documented compact-integer userId layout.
 *
 * Rejects out-of-range bigints up front instead of silently wrapping
 * via `BigInt.asUintN(64, value)`. Wrapping would alias distinct
 * caller IDs onto the same persisted userId (a negative bigint and
 * its `mod 2^64` positive counterpart collapse to identical bytes),
 * which produces hard-to-debug identity collisions across restarts.
 *
 * @returns 16-byte buffer with bytes 0..7 = 0 and bytes 8..15 = the
 *   bigint encoded as uint64 little-endian.
 * @throws RangeError when `value` is negative or above uint64 max.
 */
function bigintToGuidBytes(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new RangeError('Keewano.setUserId: bigint must fit in uint64.');
  }
  const bytes = new Uint8Array(GUID_SIZE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setBigUint64(GUID_SIZE / 2, value, true);
  return bytes;
}

export { getInstallId, markAsTestUser, reportUserRegisteredBeforeSDKIntegration, setUserId };
