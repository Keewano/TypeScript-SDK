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

import { bigintToUuidBytes, uuidBytesToString, uuidToBytes } from '../encoding';
import { KEvents } from '../events';
import {
  isPreSdkRegistered,
  markPreSdkRegistered,
  persistIdentifiers,
  persistTestUserName,
  TEST_USER_MAX_LENGTH,
} from '../identity';
import {
  enqueuePreInit,
  getInitPromise,
  getRuntime,
  isInitialized,
  isInitializing,
} from '../runtime';
import { hasControlChar, isByteString } from '../validation';

/**
 * Return the persisted install UUID. Awaits the in-flight init
 * promise so callers that race the boot do not see an empty buffer.
 *
 * @returns Lowercase hyphenated `"D"` format string
 *   (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
 */
async function getInstallId(): Promise<string> {
  const pending = getInitPromise();
  if (pending !== null) await pending;
  const runtime = getRuntime();
  return uuidBytesToString(runtime.installId);
}

/**
 * Assign the developer-supplied user identity. Accepts either a
 * lowercase hyphenated UUID string or a `bigint` (packed into the
 * last 8 bytes via {@link bigintToUuidBytes}). Queued when called
 * before init.
 *
 * In-memory state (dispatcher + `runtime.userId`) is updated
 * synchronously so callers can rely on subsequent reads. Disk
 * persistence is async and fire-and-forget so the call does not
 * block the host; persistence failure is logged via
 * `console.error` (the host can re-call `setUserId` to retry).
 *
 * UUID parse errors are surfaced eagerly: the parse runs in the
 * caller frame BEFORE any queueing, so an invalid string variant
 * throws synchronously regardless of init state.
 *
 * @throws TypeError when the string variant is not a 36-char
 *   hyphenated UUID.
 * @throws RangeError when the bigint variant is negative or
 *   exceeds uint64.
 * @throws Error when the id resolves to the all-zero UUID, the
 *   "no user" sentinel the install starts with.
 */
function setUserId(userId: string | bigint): void {
  const bytes = typeof userId === 'bigint' ? bigintToUuidBytes(userId) : uuidToBytes(userId);
  /**
   * Reject the all-zero UUID. It is the "user not set" sentinel the
   * install starts with, so assigning it would silently demote a real
   * user back to anonymous with no error. The relay surface rejects
   * the same value; this mirrors that guard. Runs in the caller frame
   * (before any queueing) so the misuse throws synchronously.
   */
  if (bytes.every((byte) => byte === 0)) {
    throw new Error('Keewano.setUserId: userId is the empty UUID.');
  }
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
 * @throws TypeError when `name` is empty, longer than
 *   `TEST_USER_MAX_LENGTH`, contains any HTTP-header control
 *   character (C0 controls U+0000-U+001F plus DEL U+007F), or
 *   contains a code point above 0xFF.
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
  /**
   * Bound the length to the same ceiling the persistence layer
   * enforces. Without this the dispatcher would hold an oversized name
   * and ship it in the K-Tester header for the whole session, while
   * persistTestUserName silently drops it on disk - so the marker
   * would vanish on the next launch and a huge header value would
   * travel until then. Rejecting here keeps the in-memory and on-disk
   * views in agreement.
   */
  if (name.length > TEST_USER_MAX_LENGTH) {
    throw new TypeError('Keewano.markAsTestUser: tester name too long.');
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
   * bug. A pre-1970 date (negative epoch) is rejected too: the event
   * serializes to a uint32 Unix-seconds field, so a negative value
   * would make addEventDateTime throw AFTER the one-shot marker is
   * already on disk, permanently losing the report. The event is
   * one-shot - a bad emission would burn the marker irreversibly - so
   * silent drop is the right policy.
   */
  if (!(date instanceof Date)) {
    return;
  }
  const timestampMs = date.getTime();
  if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs > Date.now()) {
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

export { getInstallId, markAsTestUser, reportUserRegisteredBeforeSDKIntegration, setUserId };
