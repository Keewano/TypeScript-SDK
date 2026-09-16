/**
 * Public SDK entrypoint. `Keewano` is the only surface host code
 * interacts with; every method is guard-wrapped so internal failures
 * are logged and never propagate (or reject) into the host page.
 */

import type { CustomEventDef, CustomEventSet, EncodedBatch, TransportResult } from '@keewano/core';

import type { WarnIfConsentUnmovedArgs, WebKeewanoApi } from './types/keewano';
import type { WebKeewanoConfig } from './types/config';
import type { WebSdkRuntime } from './types/runtime';

import {
  findCustomEventIdCollision,
  isCustomEventId,
  ConsentState,
  CustomEventType,
  JsonCodec,
  KEventDispatcher,
  RestCustomEventsRegistrar,
  RestTransport,
  configureSdkPlatform,
  consentGate,
  purgeRevokedData,
  deleteBatch,
  dropInMemoryBatches,
  hasControlChar,
  isByteString,
  listBatches,
  loadOrInitConsentState,
  loadTestUserName,
  logError,
  markAsTestUser,
  newUuid,
  uuidBytesToString,
  reportABTestGroupAssignment,
  reportAdItemsGranted,
  reportAdOffered,
  reportAdRevenue,
  reportButtonClick,
  reportCustomEvent,
  reportGameLanguage,
  reportInAppPurchase,
  reportInAppPurchaseItemsGranted,
  reportInstallCampaign,
  reportItemsExchange,
  reportItemsReset,
  reportOnboardingMilestone,
  reportSubscriptionItemsGranted,
  reportSubscriptionRevenue,
  reportWindowClose,
  reportWindowOpen,
  runSendLoop,
  setConsent as setConsentCore,
  setUserId,
  uuidToBytes,
} from '@keewano/core';

import { guardAsync, guardSync } from './guard';
import { WebIdentityStorageAdapter, createWebValueStore, loadAdoptedIdentifiers } from './identity';
import {
  allocBatchNum,
  clearRuntime,
  drainPreInitQueue,
  getInitPromise,
  getRuntime,
  getRuntimeOrNull,
  isInitialized,
  isInitializing,
  setInitPromise,
  setRuntime,
} from './runtime';
import { WEB_STORAGE_CAP_BYTES, selectWebStorageAdapter } from './storage';
import {
  BATCHES_DIR,
  adoptRecordedConsentSync,
  attachConsentSync,
  attachExitFlush,
  canSendAtExit,
  persistQueuedBatches,
  queueObservers,
  readQueueSeed,
  runAsSingleSender,
  runPersistLoop,
} from './delivery';
import { attachEnvironmentTracker, attachTrackers, detachAllTrackers } from './trackerPipeline';

/**
 * Default host of the JSON ingestion API the browser SDK delivers to.
 * The device SDKs post to a versioned data path on the same host; the
 * JSON endpoints are absolute from the host root, so the web SDK
 * carries its own base URL rather than reusing the device default.
 */
const WEB_DEFAULT_BASE_URL = 'https://api.keewano.com';

/**
 * Wire ceilings for the sanitized `customEventSet` fields: `version`
 * is the schema hash stamped on every batch (uint32) and `eventCount`
 * the declared-event count (uint16). `gzipData` is not part of the
 * browser's registration body, but an over-size blob still signals a
 * malformed set and is refused up front.
 *
 * GZIP_BYTES_MAX - sanity cap on the compressed map.
 * UINT16_MAX - `eventCount` ceiling.
 * UINT32_MAX - `version` ceiling.
 */
const CUSTOM_EVENT_SET_LIMITS = {
  GZIP_BYTES_MAX: 1024 * 1024,
  UINT16_MAX: 0xffff,
  UINT32_MAX: 0xffffffff,
} as const;

/**
 * Validate an untyped `config.customEventSet` (the snippet queue feeds
 * init from page JS). Every field the pipeline consumes is checked:
 * `version` is stamped on every batch this session persists, and the
 * declared events become the registration body, whose rejection would
 * stall every ship pass of the session. A malformed set is dropped
 * whole - init continues without custom events. Returns a snapshot
 * built from single-read bindings, so a hostile getter cannot pass
 * validation and feed the pipeline a different value later.
 */
function sanitizeCustomEventSet(value: unknown): CustomEventSet | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== 'object') {
    console.error('Keewano.init: invalid customEventSet; custom events disabled.');
    return undefined;
  }
  const { version, gzipData, eventCount, events } = value as {
    version?: unknown;
    gzipData?: unknown;
    eventCount?: unknown;
    events?: unknown;
  };
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 0 ||
    version > CUSTOM_EVENT_SET_LIMITS.UINT32_MAX
  ) {
    console.error('Keewano.init: customEventSet.version is not a uint32; custom events disabled.');
    return undefined;
  }
  if (!(gzipData instanceof Uint8Array)) {
    console.error(
      'Keewano.init: customEventSet.gzipData is not a Uint8Array; custom events disabled.',
    );
    return undefined;
  }
  if (gzipData.length > CUSTOM_EVENT_SET_LIMITS.GZIP_BYTES_MAX) {
    console.error('Keewano.init: customEventSet.gzipData is too large; custom events disabled.');
    return undefined;
  }
  if (
    typeof eventCount !== 'number' ||
    !Number.isInteger(eventCount) ||
    eventCount < 0 ||
    eventCount > CUSTOM_EVENT_SET_LIMITS.UINT16_MAX
  ) {
    console.error(
      'Keewano.init: customEventSet.eventCount is not a uint16; custom events disabled.',
    );
    return undefined;
  }
  if (events !== undefined && !Array.isArray(events)) {
    console.error('Keewano.init: customEventSet.events is not an array; custom events disabled.');
    return undefined;
  }
  /**
   * Absent entries mean an empty declaration, which only agrees with
   * a zero count. Registration builds its body from these entries, so
   * a set whose entries disagree with its own count would register a
   * map the batches' schema hash does not describe.
   */
  const entries = (events ?? []) as ReadonlyArray<unknown>;
  if (entries.length !== eventCount) {
    console.error(
      'Keewano.init: customEventSet.events does not match eventCount; custom events disabled.',
    );
    return undefined;
  }
  const sanitizedEvents = sanitizeCustomEventDefs(entries);
  if (sanitizedEvents === null) {
    return undefined;
  }
  return { version, gzipData: new Uint8Array(gzipData), eventCount, events: sanitizedEvents };
}

/** Payload-shape tags the wire understands; anything else cannot be registered or emitted. */
const KNOWN_CUSTOM_EVENT_TYPES: ReadonlySet<number> = new Set(Object.values(CustomEventType));

/**
 * Validate the declared events one by one. Registration reads `name`
 * and `type` off every entry, so a hostile or hand-built array is not
 * merely useless here: an entry that is not an object throws inside
 * the registration call, and a failed registration blocks delivery
 * for the whole session.
 *
 * @returns Owned copies of the entries, or `null` when any is
 *   malformed (the caller then disables custom events entirely).
 */
function sanitizeCustomEventDefs(entries: ReadonlyArray<unknown>): CustomEventDef[] | null {
  const out: CustomEventDef[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') {
      console.error(
        'Keewano.init: customEventSet.events has a non-object entry; custom events disabled.',
      );
      return null;
    }
    const { id, name, type } = entry as { id?: unknown; name?: unknown; type?: unknown };
    if (typeof name !== 'string' || name.length === 0) {
      console.error(
        'Keewano.init: customEventSet.events has an unnamed entry; custom events disabled.',
      );
      return null;
    }
    if (typeof type !== 'number' || !KNOWN_CUSTOM_EVENT_TYPES.has(type)) {
      console.error(
        'Keewano.init: customEventSet.events has an unknown payload type; custom events disabled.',
      );
      return null;
    }
    /**
     * The id is the entry's own, not its position: ids are allocated
     * once and a removed event leaves a hole, so the two stop agreeing
     * after the first `remove`. Copying it is what keeps a report on
     * the id the map was built with; dropping it sends the event under
     * whichever name sits at that index instead. Absent is legitimate -
     * a set built before ids were declared - and the runtime then falls
     * back to the position itself.
     *
     * Only the shape is checked here. Whether the number fits the wire
     * field is the encoder's to say, and it says it naming that field.
     */
    let declaredId: number | undefined;
    if (id !== undefined) {
      if (typeof id !== 'number' || !isCustomEventId(id)) {
        console.error(
          'Keewano.init: customEventSet.events has an id outside the custom-event range; custom events disabled.',
        );
        return null;
      }
      declaredId = id;
    }
    out.push({ id: declaredId, name, type: type as CustomEventDef['type'] });
  }
  /**
   * Checked over the whole set, after each entry passed on its own: an
   * entry with no id takes its position, and a position can be a number
   * another entry declares. Both would then report under it, and the map
   * the backend gets would name only one of them.
   */
  const collision = findCustomEventIdCollision(out);
  if (collision !== null) {
    console.error(
      `Keewano.init: customEventSet.events "${collision.names[0]}" and "${collision.names[1]}" both resolve to id ${String(collision.id)}; custom events disabled.`,
    );
    return null;
  }
  return out;
}

/** In-flight teardown; a second shutdown joins it and init() sequences behind it. */
let activeShutdownPromise: Promise<void> | null = null;

/**
 * Boot the SDK. Re-init warns and joins the in-flight promise. An
 * init during an in-flight `shutdown()` waits for the teardown first,
 * or the concluding teardown would kill the session the caller
 * believes it just started.
 */
async function init(config: WebKeewanoConfig): Promise<void> {
  /**
   * The snippet queue feeds this from untyped page JS (`['init']`
   * arrives as no args); validate shape BEFORE dereferencing.
   */
  if (config === null || typeof config !== 'object') {
    console.error('Keewano.init: invalid config; SDK will not start the send loop.');
    return;
  }
  if (activeShutdownPromise !== null) {
    try {
      await activeShutdownPromise;
    } catch {
      /** Teardown failed but the runtime is cleared; boot fresh anyway. */
    }
  }
  if (isInitialized() || isInitializing()) {
    console.warn('Keewano.init: SDK is already initialized; ignoring re-init.');
    const pending = getInitPromise();
    if (pending !== null) await pending;
    return;
  }
  if (typeof config.apiKey !== 'string' || config.apiKey.trim().length === 0) {
    console.error('Keewano.init: apiKey is empty; SDK will not start the send loop.');
    return;
  }
  /**
   * The key travels in the request URL, and the transport validates
   * it as strictly as a header value: whitespace / control /
   * non-ByteString characters fail that check on every ship attempt,
   * permanently stalling delivery.
   */
  if (
    config.apiKey !== config.apiKey.trim() ||
    hasControlChar(config.apiKey) ||
    !isByteString(config.apiKey)
  ) {
    console.error('Keewano.init: invalid apiKey; SDK will not start the send loop.');
    return;
  }
  const promise = startInit(config);
  setInitPromise(promise);
  try {
    await promise;
  } catch (err: unknown) {
    /**
     * Detach trackers that registered before the throw (their
     * listeners would leak) and clear the partial runtime so a retry
     * boots cleanly instead of awaiting a permanently-failed promise.
     * try/finally: a throwing detach must not skip clearRuntime().
     */
    const partialRuntime = getRuntimeOrNull();
    try {
      if (partialRuntime !== null) {
        /**
         * A no-op today (startInit can only throw BEFORE its last
         * step, startSendLoop); defense against a refactor that lets
         * the loop outlive a cleared runtime.
         */
        partialRuntime.sendLoopAbort.abort();
        try {
          detachAllTrackers(partialRuntime);
        } catch (error_: unknown) {
          console.error('Keewano.init: failed to detach trackers after init error.', error_);
        }
      }
    } finally {
      clearRuntime();
    }
    throw err;
  }
}

async function startInit(config: WebKeewanoConfig): Promise<void> {
  /** Tag every outbound request as Web; there is no default. */
  configureSdkPlatform('Web');
  const queueStorage = config.storage ?? (await selectWebStorageAdapter());
  /**
   * Identity AND consent persist through the localStorage -> cookie
   * -> memory ladder, NOT the queue adapter: IndexedDB can be denied
   * or evicted wholesale, and those two files must degrade
   * independently of the event queue.
   */
  const storage = new WebIdentityStorageAdapter({
    store: createWebValueStore(),
    fallback: queueStorage,
  });
  const endpoint = config.endpoint ?? WEB_DEFAULT_BASE_URL;
  /**
   * Web default: collect-and-hold. Unlike the device SDKs (which
   * default to flowing immediately), a fresh origin boots `Pending` -
   * events accumulate on the client but nothing ships until the host
   * signals `setUserConsent(true)`; a deny deletes the held data.
   */
  const requirePlayerConsent = config.requirePlayerConsent ?? true;

  const [identifiers, consentState, testUserName] = await Promise.all([
    loadAdoptedIdentifiers({ storage }),
    loadOrInitConsentState({ storage, requirePlayerConsent }),
    loadTestUserName({ storage }),
  ]);
  /**
   * A fresh DataSessionId per page load (the tab plays the role a
   * process launch plays on mobile). PENDING Q-W4: awaiting backend
   * confirmation of the per-page-load data-session policy.
   */
  const dataSessionId = uuidToBytes(newUuid());
  const initialTimestamp = Math.floor(Date.now() / 1000);
  const customEventSet = sanitizeCustomEventSet(config.customEventSet);
  /**
   * One encoding for the whole session: the accumulator that writes
   * the events, the persist that stores them, and the transport that
   * ships them. A dispatcher left on the default encoding would fill
   * its buffers in one format while the queue stored another. The
   * declared set rides along because each custom event carries its own
   * payload-type name on the wire.
   */
  const codec = new JsonCodec(customEventSet === undefined ? {} : { customEventSet });
  const dispatcher = new KEventDispatcher({
    installId: identifiers.installId,
    userId: identifiers.userId,
    dataSessionId,
    initialTimestamp,
    codec,
  });
  if (testUserName !== null) {
    try {
      dispatcher.markAsTestUser(testUserName);
    } catch {
      /** Persisted tester name was corrupted; ignore so init can complete. */
    }
  }
  if (customEventSet !== undefined) {
    /** Stamp both buffers once; `resetForReuse()` preserves `customEventsVersion`. */
    dispatcher.currentInBatch.customEventsVersion = customEventSet.version;
    dispatcher.currentSendingBatch.customEventsVersion = customEventSet.version;
  }
  const sendLoopAbort = new AbortController();
  /**
   * Read the queue a prior page load left behind before the loop
   * starts, so no allocation and no exit can race the read. It decides
   * both where batch numbering resumes - restarting at 0 would reuse
   * numbers unsent files still carry - and whether this session may
   * send at exit before its first ship pass has proved the queue
   * drained.
   */
  const queueSeed = await readQueueSeed(queueStorage);
  const runtime: WebSdkRuntime = {
    config,
    endpoint,
    storage,
    queueStorage,
    dispatcher,
    installId: identifiers.installId,
    userId: identifiers.userId,
    dataSessionId,
    consentState,
    sendLoopAbort,
    sendLoopPromise: null,
    detachFns: [],
    nextBatchNum: queueSeed.nextBatchNum,
    batchFilenameSuffix: uuidBytesToString(dataSessionId).slice(0, 8),
    codec,
    transport: new RestTransport(),
    exitSendSafe: queueSeed.queueEmpty,
    exitSendStarted: false,
    customEventsRegistered: false,
    onboardingCounters: new Map<string, number>(),
    preSdkInFlight: null,
    customEventSet,
  };
  setRuntime(runtime);
  /**
   * Refuse collection at the dispatcher, not at the report layer: the
   * auto-trackers hold the dispatcher directly, so a gate anywhere
   * above them is one an ordinary button press walks straight past.
   * Reading the state through a closure rather than copying it means
   * the gate cannot fall out of step with the consent record.
   */
  dispatcher.setCollectionGate(() => consentGate(runtime.consentState) !== 'delete');
  /**
   * Wire ordering, mirroring the device SDKs:
   *   1. the environment burst - the canonical session preamble the
   *      server expects before anything else;
   *   2. the pre-init queue - host `report*` calls that happened
   *      before init resolved, chronologically earlier than any
   *      tracker output;
   *   3. the live trackers and host plugins - a plugin may emit
   *      synchronously on attach and those events must land after
   *      the pre-init reports.
   */
  attachEnvironmentTracker(runtime);
  drainPreInitQueue();
  attachTrackers({ runtime, config });
  /**
   * After the trackers on purpose: same-phase listener order lets
   * their pagehide/visibility teardown events reach the batch before
   * the exit flush cuts it. Its detach rides the shared list, so
   * shutdown removes it together with the trackers - before the
   * shutdown flush takes over the end of the session.
   */
  runtime.detachFns.push(attachExitFlush({ flush: () => persistOnExit(runtime) }));
  runtime.detachFns.push(attachConsentSync({ runtime }));
  startSendLoop(runtime);
}

/**
 * Exit-time twin of the shutdown flush: the tab's final events would
 * otherwise die with the page, because the send loop never gets
 * another tick. Two deliveries run from here, in this order:
 *
 *   1. the exit send, started synchronously the moment the batches
 *      are identified and delivered strictly in batch order (see
 *      {@link sendBatchesAtExit});
 *   2. the ordinary persist, so the next visit ships whatever the
 *      exit send could not.
 *
 * The persist always runs. The exit send runs only when
 * {@link canSendAtExit} allows it: nothing of this session may still
 * be queued (the server DROPS a lower-numbered batch that arrives
 * after a higher one, so the freshly sealed - highest-numbered -
 * batch would get the older ones rejected on the next visit's
 * resend), and the declared custom-event schema must already be
 * registered (the server rejects a batch stamped with a hash it never
 * saw). When either fails this path persists only: the next visit
 * registers, then ships everything in order, losing nothing.
 *
 * When the send does run, nothing is deleted on its account: every
 * on-disk copy stays, and the next visit resends it under the same
 * batch number for the server to deduplicate. Denied sessions persist
 * nothing and drop what is already buffered; sessions still awaiting
 * consent persist but send nothing. The dispatcher stays fully usable
 * afterwards - the page may come back from the bfcache and keep
 * reporting.
 *
 * Consent is re-read from the record first, synchronously. This path
 * begins inside the teardown event's own task, where a continuation is
 * not guaranteed to run, so a withdrawal recorded in another tab
 * reaches the decision below no other way: the cross-tab listener
 * resolves a promise a closing page never gets to, and the `storage`
 * event it also listens for never fires at all for a record that
 * landed on the cookie rung. The send that follows outlives this task
 * and re-reads for itself; see {@link sendBatchesAtExit}.
 */
async function persistOnExit(runtime: WebSdkRuntime): Promise<void> {
  adoptRecordedConsentSync(runtime);
  const decision = consentGate(runtime.consentState);
  if (decision === 'delete') {
    /**
     * Both loops drop these buffers on their next tick, but a tab that
     * gets no further tick - closed outright, or frozen until a
     * bfcache restore that may never come - would otherwise hold what
     * the withdrawal covers for as long as it exists.
     */
    dropInMemoryBatches({ dispatcher: runtime.dispatcher });
    return;
  }
  const sendNow = decision === 'send' && canSendAtExit(runtime);
  if (runtime.dispatcher.currentInBatch.byteSize() !== 0) {
    await persistQueuedBatches({
      runtime,
      onBatchesSealed: (batches) => {
        if (!sendNow) return;
        runtime.exitSendStarted = true;
        sendBatchesAtExit(runtime, batches);
      },
    });
  }
  /**
   * Anything a previous failed pass left queued is still on disk. Wake
   * the loop for it - a backgrounded tab often lives on, and this is
   * its last cheap chance to drain before the browser starts
   * throttling its timers. The wake comes LAST on purpose: a listener
   * that wakes the loop earlier in the teardown lets it swap the
   * accumulated batch away before the code above can send it.
   *
   * Not after an exit send, though. {@link canSendAtExit} only allows
   * one when nothing else of this session is queued, so the disk then
   * holds exactly the batches just handed to the keep-alive requests -
   * which are deliberately left there for the next visit and are not
   * deleted on delivery. A tab that survives its own teardown would
   * wake the loop into shipping that same batch milliseconds later,
   * and a server deduplicating asynchronously counts both copies.
   */
  if (decision === 'send' && !runtime.exitSendStarted) {
    runtime.dispatcher.signalSend();
  }
}

/**
 * Ship the sealed batches at exit, strictly in batch order: only a
 * confirmed delivery advances the chain to the next batch, and any
 * other outcome stops it, leaving the rest persisted for the next
 * visit's in-order resend. Issuing them concurrently would not keep
 * that order - the server may process requests in any order, and it
 * drops a lower-numbered batch arriving after a higher one; on the
 * next visit that drop is indistinguishable from a duplicate, so the
 * resent batch's disk copy is deleted and its events are lost.
 *
 * The last batch has no successor to order, so it takes the keep-alive
 * exit hand-off - the only request shape that survives page teardown -
 * which keeps the single-batch exit one synchronous send. The RECORD,
 * not the cached decision, is re-read before every batch: each hop
 * awaits a network round trip, so the chain can run for seconds after
 * its caller gated, and a withdrawal made meanwhile reaches a hidden
 * tab no other way - the `storage` event is silent for a record on the
 * cookie rung, and a tab already hidden gets no further visibility
 * change. Failures are silent by contract: nothing here can act on an
 * error while the page is being torn down, and the persist that
 * follows is the safety net.
 */
function sendBatchesAtExit(runtime: WebSdkRuntime, batches: readonly EncodedBatch[]): void {
  const sendSync = runtime.transport.sendSync;
  if (sendSync === undefined) return;
  const deliverInOrder = async (): Promise<void> => {
    for (const [index, batch] of batches.entries()) {
      adoptRecordedConsentSync(runtime);
      if (consentGate(runtime.consentState) !== 'send') return;
      const ctx = {
        endpoint: runtime.endpoint,
        apiKey: runtime.config.apiKey,
        installId: runtime.installId,
        testUser: runtime.dispatcher.pendingTestUserName,
      };
      if (index === batches.length - 1) {
        sendSync.call(runtime.transport, { batch, ctx });
        return;
      }
      if (!batchLanded(await runtime.transport.send({ batch, ctx }))) return;
    }
  };
  deliverInOrder().catch(() => undefined);
}

/**
 * `true` when the next batch may follow this one out. A delivered
 * batch the server took no events from is the one outcome `ok` cannot
 * distinguish for this purpose: it means the batch was a duplicate,
 * arrived out of sequence, or held nothing parseable, and sending a
 * higher-numbered batch past it is exactly what makes the server drop
 * it on the next visit's resend. Stopping instead costs nothing - the
 * remaining batches are already on disk and ship in order next time.
 * A protocol that reports no receipt leaves both fields undefined and
 * keeps the chain moving.
 */
function batchLanded(result: TransportResult): boolean {
  if (result.kind !== 'ok') return false;
  return !((result.received ?? 0) > 0 && result.accepted === 0);
}

/**
 * The queue cap is the web-specific 10 MB budget (browser origin
 * quotas are far tighter than the mobile 50 MB default); the promise
 * is stashed so `shutdown()` can await exit.
 */
function startSendLoop(runtime: WebSdkRuntime): void {
  /** Conditional spread: `exactOptionalPropertyTypes` rejects an assigned `undefined`. */
  /**
   * The loop runs behind the origin-wide sender election: one tab
   * ships for everyone, the rest queue on the lock and inherit
   * delivery when the holder closes. A tab that loses the election
   * still drains its dispatcher to the queue on the same cadence
   * (`runWhileQueued`), so a crash costs it nothing the elected tab
   * cannot ship later. The same abort signal cancels a still-queued
   * election on shutdown and stops whichever loop is running.
   */
  runtime.sendLoopPromise = runAsSingleSender({
    signal: runtime.sendLoopAbort.signal,
    runWhileQueued: ({ signal }) => runPersistLoop({ runtime, signal }),
    runLoop: () =>
      runSendLoop({
        storage: runtime.queueStorage,
        dispatcher: runtime.dispatcher,
        endpoint: runtime.endpoint,
        apiKey: runtime.config.apiKey,
        installId: runtime.installId,
        getConsent: () => getRuntime().consentState,
        getNextBatchNum: () => allocBatchNum(getRuntime()),
        signal: runtime.sendLoopAbort.signal,
        batchesDir: BATCHES_DIR,
        filenameSuffix: runtime.batchFilenameSuffix,
        capBytes: WEB_STORAGE_CAP_BYTES,
        codec: runtime.codec,
        transport: runtime.transport,
        customEventsRegistrar: new RestCustomEventsRegistrar(),
        /** Queue bookkeeping for the exit path; see {@link queueObservers}. */
        ...queueObservers(runtime),
        ...(runtime.customEventSet === undefined ? {} : { customEventSet: runtime.customEventSet }),
      }),
  }).catch((err: unknown) => {
    /**
     * The loop body catches every expected throw, so a rejection here
     * means the sender died for the rest of the session - it must be
     * visible, not swallowed.
     */
    console.error('Keewano: send loop crashed; delivery stopped for this session.', err);
  });
}

/**
 * Wind down the SDK. Ordering matters: abort the loop, await its exit
 * (the dispatcher must not race a live tick), flush in-memory events
 * to storage, detach trackers, clear the runtime. A concurrent
 * shutdown joins the in-flight teardown - two teardowns would
 * double-swap the dispatcher buffers.
 */
async function shutdown(): Promise<void> {
  if (activeShutdownPromise !== null) {
    return activeShutdownPromise;
  }
  const promise = performShutdown();
  activeShutdownPromise = promise;
  try {
    await promise;
  } finally {
    activeShutdownPromise = null;
  }
}

async function performShutdown(): Promise<void> {
  /**
   * Wait for an in-flight init() to install the runtime (or fail);
   * otherwise shutdown returns early while startInit() finishes
   * asynchronously and leaves the loop running.
   */
  const pending = getInitPromise();
  if (pending !== null) {
    try {
      await pending;
    } catch {
      /** Init rejected; nothing was installed so there is nothing to tear down. */
    }
  }
  const runtime = getRuntimeOrNull();
  if (runtime === null) {
    return;
  }
  runtime.sendLoopAbort.abort();
  if (runtime.sendLoopPromise !== null) {
    await runtime.sendLoopPromise;
  }
  /**
   * The loop's last `waitForSignal` may have armed the dispatcher's
   * idle timer (up to 30s); aborting the loop does not clear it, and
   * the dispatcher plus both buffers stay reachable until it fires.
   */
  runtime.dispatcher.cancelPendingWait();
  /**
   * Detach trackers BEFORE the final flush - the reverse of the
   * device SDKs, and deliberate: web trackers emit final events on
   * detach (the navigation tracker's teardown WINDOW_CLOSE), and only
   * a pre-flush emission reaches the sealed batch. The runtime is
   * still installed here, so those events land in the in-batch the
   * flush is about to persist. A throwing detach must not skip the
   * flush.
   */
  try {
    detachAllTrackers(runtime);
  } catch (err: unknown) {
    console.error('Keewano.shutdown: failed to detach trackers.', err);
  }
  /**
   * Revoked consent means in-memory events MUST be dropped here, not
   * given one last chance to land in storage. try/finally: cleanup
   * must run even if the flush throws, or re-init blocks.
   */
  try {
    await flushOrDropOnShutdown(runtime);
  } finally {
    clearRuntime();
  }
}

/**
 * Revoked consent leaves nothing behind: in-memory buffers dropped
 * AND queued `.kwub` files deleted, never given a last flush.
 */
async function flushOrDropOnShutdown(runtime: WebSdkRuntime): Promise<void> {
  if (consentGate(runtime.consentState) === 'delete') {
    await purgeRevokedData({
      dispatcher: runtime.dispatcher,
      deleteQueued: () => deleteQueuedBatches(runtime),
    });
    return;
  }
  await persistQueuedBatches({ runtime });
}

/**
 * Best-effort delete of every batch file: a transient storage
 * failure must not block shutdown; the next page load retries.
 */
async function deleteQueuedBatches(runtime: WebSdkRuntime): Promise<void> {
  try {
    const files = await listBatches({ storage: runtime.queueStorage, dir: BATCHES_DIR });
    for (const file of files) {
      try {
        await deleteBatch({ storage: runtime.queueStorage, path: file.path });
      } catch {
        /** Per-file failure; skip and let the next page load retry. */
      }
    }
  } catch {
    /** Listing failed (denied / evicted); the next page load will retry. */
  }
}

/** `true` when {@link init} has resolved at least once and `shutdown` has not run since. */
function isReady(): boolean {
  return isInitialized();
}

/**
 * Report a consent call that could not move the recorded decision.
 *
 * The record is one-shot, so a second call is a no-op by design. A
 * host wiring a "withdraw consent" control to this method would
 * otherwise get silence and ship a button that does nothing, which is
 * the one failure mode a consent API must not have. The guides say
 * the same thing, in the place people read after shipping rather than
 * before.
 */
/** Console-facing names of the recorded consent states, as the warning below spells them. */
const CONSENT_STATE_NAME = {
  [ConsentState.NotRequired]: 'not required',
  [ConsentState.Pending]: 'pending',
  [ConsentState.Granted]: 'granted',
  [ConsentState.Denied]: 'denied',
} as const;
function warnIfConsentUnmoved({ granted, recorded }: WarnIfConsentUnmovedArgs): void {
  const requested = granted ? ConsentState.Granted : ConsentState.Denied;
  if (recorded === requested) return;
  /**
   * Pending is the one non-requested outcome that is NOT terminal: it
   * means the transition did not land (the caller held a stale
   * in-memory state over a Pending record), so "cannot be changed"
   * would be false - the right move is to call again.
   */
  if (recorded === ConsentState.Pending) {
    console.warn(
      'Keewano.setUserConsent: consent is still pending and this call did not take effect; call setUserConsent again.',
    );
    return;
  }
  const state = CONSENT_STATE_NAME[recorded];
  console.warn(
    `Keewano.setUserConsent: consent is already recorded as ${state} and cannot be changed; this call did nothing. A withdrawal control must not be wired to this method alone - see the consent section of the browser guide.`,
  );
}

/**
 * No event is emitted - consent is dispatcher-private state, not a
 * wire event.
 */
async function setUserConsent(granted: boolean): Promise<void> {
  /**
   * Best-effort sequencing behind a shutdown ALREADY in flight at
   * call time; a shutdown starting during the awaits below is not
   * joined, so its final flush can still persist a batch this revoke
   * meant to drop. Bounded: the revoke lands durably first, the dead
   * session ships nothing, and the next boot's first consent pass
   * deletes the stray file before any send.
   */
  if (activeShutdownPromise !== null) {
    try {
      await activeShutdownPromise;
    } catch {
      /** Teardown failed but the runtime is cleared; the no-runtime branch below reports it. */
    }
  }
  const pending = getInitPromise();
  if (pending !== null) {
    try {
      await pending;
    } catch {
      /** Init rejected; fall through - the consent decision must not be discarded with an unrelated boot failure. */
    }
  }
  const runtime = getRuntimeOrNull();
  if (runtime === null) {
    console.error('Keewano.setUserConsent: no runtime; consent not recorded.');
    return;
  }
  const next = await setConsentCore({
    storage: runtime.storage,
    current: runtime.consentState,
    granted,
  });
  warnIfConsentUnmoved({ granted, recorded: next });
  runtime.consentState = next;
  /**
   * Privacy gap: a revoke must not leave events in the buffers or
   * `.kwub` files in storage until the loop's next tick (up to its
   * idle window). Purge both layers here, but keep the send loop
   * RUNNING: its per-tick `'delete'` decision keeps dropping whatever
   * lands after this call (post-revoke reports would otherwise grow
   * `currentInBatch` without bound), and a loop left alive re-checks
   * consent before every POST, so a later re-granted gate resumes
   * delivery without any restart plumbing.
   */
  const decision = consentGate(next);
  if (decision === 'delete') {
    try {
      await purgeRevokedData({
        dispatcher: runtime.dispatcher,
        deleteQueued: () => deleteQueuedBatches(runtime),
      });
    } catch {
      /** Best-effort buffer reset; the disk delete inside the purge handles its own failures. */
    }
    return;
  }
  /**
   * Delivery is open after this call - a fresh grant (the main path
   * of the web collect-and-hold default) or a no-op on an already-
   * open state. Wake the loop so held data ships now instead of
   * waiting out the idle window: the visitor may close the tab
   * seconds after the banner click. Waking can never ship gated
   * data - the loop re-reads the gate before every pass.
   */
  if (decision === 'send') {
    runtime.dispatcher.signalSend();
  }
}

/** The single host-facing facade; see {@link WebKeewanoApi} for the method contract. */
const Keewano: WebKeewanoApi = {
  init: guardAsync({ name: 'init', fn: init }),
  shutdown: guardAsync({ name: 'shutdown', fn: shutdown }),
  isReady,
  setUserId: guardSync({ name: 'setUserId', fn: setUserId }),
  setUserConsent: guardAsync({ name: 'setUserConsent', fn: setUserConsent }),
  markAsTestUser: guardSync({ name: 'markAsTestUser', fn: markAsTestUser }),
  reportButtonClick: guardSync({ name: 'reportButtonClick', fn: reportButtonClick }),
  reportWindowOpen: guardSync({ name: 'reportWindowOpen', fn: reportWindowOpen }),
  reportWindowClose: guardSync({ name: 'reportWindowClose', fn: reportWindowClose }),
  reportOnboardingMilestone: guardSync({
    name: 'reportOnboardingMilestone',
    fn: reportOnboardingMilestone,
  }),
  reportABTestGroupAssignment: guardSync({
    name: 'reportABTestGroupAssignment',
    fn: reportABTestGroupAssignment,
  }),
  reportInAppPurchase: guardSync({ name: 'reportInAppPurchase', fn: reportInAppPurchase }),
  reportInAppPurchaseItemsGranted: guardSync({
    name: 'reportInAppPurchaseItemsGranted',
    fn: reportInAppPurchaseItemsGranted,
  }),
  reportAdOffered: guardSync({ name: 'reportAdOffered', fn: reportAdOffered }),
  reportAdRevenue: guardSync({ name: 'reportAdRevenue', fn: reportAdRevenue }),
  reportAdItemsGranted: guardSync({ name: 'reportAdItemsGranted', fn: reportAdItemsGranted }),
  reportSubscriptionRevenue: guardSync({
    name: 'reportSubscriptionRevenue',
    fn: reportSubscriptionRevenue,
  }),
  reportSubscriptionItemsGranted: guardSync({
    name: 'reportSubscriptionItemsGranted',
    fn: reportSubscriptionItemsGranted,
  }),
  reportItemsExchange: guardSync({ name: 'reportItemsExchange', fn: reportItemsExchange }),
  reportItemsReset: guardSync({ name: 'reportItemsReset', fn: reportItemsReset }),
  reportInstallCampaign: guardSync({ name: 'reportInstallCampaign', fn: reportInstallCampaign }),
  reportGameLanguage: guardSync({ name: 'reportGameLanguage', fn: reportGameLanguage }),
  reportCustomEvent: guardSync({ name: 'reportCustomEvent', fn: reportCustomEvent }),
  logError: guardSync({ name: 'logError', fn: logError }),
};

export type { WebKeewanoApi } from './types/keewano';
export { Keewano };
