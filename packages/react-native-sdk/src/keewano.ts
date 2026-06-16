/**
 * Public SDK entrypoint. The `Keewano` object below is the only
 * surface end users interact with; everything else in this
 * package is an implementation detail.
 *
 * Lifecycle:
 *   `Keewano.init(config)` is fire-and-forget but returns a
 *   Promise so test setups can await the post-init state. Re-init
 *   warns and no-ops (Fast Refresh tolerance). `Keewano.shutdown()`
 *   performs a final swap + save + abort + cleanup before resolving.
 */

import type { KeewanoApi } from './types/keewano';
import type { KeewanoConfig } from './types/config';
import type { SdkRuntime } from './types/runtime';

import {
  KEEWANO_DEFAULT_BASE_URL,
  KEventDispatcher,
  consentGate,
  deleteBatch,
  guidToBytes,
  listBatches,
  loadOrInitConsentState,
  loadOrInitIdentifiers,
  loadTestUserName,
  newGuid,
  setConsent as setConsentCore,
} from '@keewano/core';

import { defaultPlatformAdapter } from './platformDefaults';
import { resetSceneCursor } from './navigation/sceneCursor';
import { persistAccumulatedBatch, runSendLoop } from './sendLoop';
import { attachInitialEventsTracker, attachTrackers, detachAllTrackers } from './trackerPipeline';
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
import { BareRNStorageAdapter } from './storage';
import {
  logError,
  reportAdItemsGranted,
  reportAdOffered,
  reportAdRevenue,
  reportGameLanguage,
  reportInAppPurchase,
  reportInAppPurchaseItemsGranted,
  reportInstallCampaign,
  reportItemsExchange,
  reportItemsReset,
  reportSubscriptionItemsGranted,
  reportSubscriptionRevenue,
} from './api/monetization';
import { reportCustomEvent } from './api/customEvents';
import {
  reportABTestGroupAssignment,
  reportButtonClick,
  reportOnboardingMilestone,
  reportSceneLoaded,
  reportSceneUnloaded,
  reportWindowClose,
  reportWindowOpen,
} from './api/ui';
import {
  getInstallId,
  markAsTestUser,
  reportUserRegisteredBeforeSDKIntegration,
  setUserId,
} from './api/identity';

/** Directory name (relative to the storage adapter root) under which `.kwub` batch files live. */
const BATCHES_DIR = 'keewano';

/**
 * Boot the SDK. Resolves once the runtime is installed and the
 * background send loop has been kicked off. Re-init is tolerated:
 * a duplicate call logs a warning and awaits the in-flight promise.
 * An empty `apiKey` short-circuits with `console.error` so the
 * misconfiguration is visible and the loop never starts.
 */
async function init(config: KeewanoConfig): Promise<void> {
  if (isInitialized() || isInitializing()) {
    console.warn('Keewano.init: SDK is already initialized; ignoring re-init.');
    const pending = getInitPromise();
    if (pending !== null) await pending;
    return;
  }
  if (typeof config.apiKey !== 'string' || config.apiKey.trim().length === 0) {
    console.error('Keewano.init: apiKey is empty; SDK will not start the send loop.');
    /**
     * This branch returns BEFORE startInit, so the catch/finally that
     * clears the module-scope scene buffer never runs. Clear it here
     * too: a pre-init `writeSceneCursor` would otherwise survive this
     * failed init and hydrate the next session's cursor on its first
     * read, emitting a phantom SCENE_UNLOADED for a scene this session
     * never loaded.
     */
    resetSceneCursor();
    return;
  }
  const promise = startInit(config);
  setInitPromise(promise);
  try {
    await promise;
  } catch (err: unknown) {
    /**
     * startInit() rejected (transient storage error, bad platform
     * adapter, critical-path tracker attach failure, etc.). Detach
     * any trackers that did register before the throw - otherwise
     * their listeners leak across a failed init - then reset the
     * tracked init promise + any partial runtime so a later
     * Keewano.init() call can retry cleanly instead of getting stuck
     * awaiting a permanently-failed promise from the previous attempt.
     */
    const partialRuntime = getRuntimeOrNull();
    /**
     * Wrap detach in try/finally so a throwing tracker cleanup cannot
     * skip `clearRuntime()` and leave the SDK stuck in a partial state
     * that a retry could not recover from. The original init failure
     * is still propagated (the throw at the end of the catch).
     */
    try {
      if (partialRuntime !== null) {
        /**
         * Abort the send-loop signal FIRST. In current code `startInit`
         * calls `startSendLoop` as its last step, so an init throw can
         * only land BEFORE the loop kicks off - the abort is a no-op
         * in that path. The call is kept for symmetry with
         * `Keewano.shutdown()` (which also aborts) and as defense
         * against a future refactor that inserts a throwing step
         * after `startSendLoop`: without the abort, the captured
         * runtime in the loop's closure would keep running against
         * a cleared global runtime and race a subsequent init().
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
      /**
       * Drop the module-scope pre-init scene buffer on the failed-init
       * path too. Otherwise a `writeSceneCursor()` from a pre-init
       * render survives `clearRuntime()` and hydrates the runtime
       * cursor of the NEXT (successful) init on its first read,
       * producing a phantom SCENE_UNLOADED for a scene the new
       * session never loaded. Mirrors the equivalent reset in
       * `Keewano.shutdown()` (both teardown paths).
       */
      resetSceneCursor();
    }
    throw err;
  }
}

/**
 * Internal boot sequence. Resolves dependencies (storage, platform,
 * endpoint), loads identifiers + consent from disk, creates the
 * dispatcher, emits the seven init events, and kicks off the
 * background send loop. The loop is fire-and-forget: it runs until
 * shutdown aborts its signal.
 */
async function startInit(config: KeewanoConfig): Promise<void> {
  const storage = config.storage ?? new BareRNStorageAdapter();
  const platform = config.platform ?? defaultPlatformAdapter();
  const endpoint = config.endpoint ?? KEEWANO_DEFAULT_BASE_URL;
  const requirePlayerConsent = config.requirePlayerConsent ?? false;

  /**
   * Identity, consent, and the QA test-user marker live on
   * independent files; load in parallel so cold-start latency is
   * `max(t_id, t_consent, t_tester)` instead of sum.
   */
  const [identifiers, consentState, testUserName] = await Promise.all([
    loadOrInitIdentifiers({ storage }),
    loadOrInitConsentState({ storage, requirePlayerConsent }),
    loadTestUserName({ storage }),
  ]);
  const dataSessionId = guidToBytes(newGuid());
  const initialTimestamp = Math.floor(Date.now() / 1000);
  const dispatcher = new KEventDispatcher({
    installId: identifiers.installId,
    userId: identifiers.userId,
    dataSessionId,
    initialTimestamp,
  });
  if (testUserName !== null) {
    /**
     * Restore the persisted QA marker so the next batch ship picks
     * it up as `K-Tester` without the host having to re-call
     * `markAsTestUser`. Wrapped because the load layer already
     * validates the persisted value (round-5 hardening), but a
     * future regression or a manually-edited marker file could
     * still feed corrupt input to dispatcher.markAsTestUser which
     * would otherwise throw out of init() and prevent the SDK from
     * booting. Defense-in-depth: silently drop the marker on
     * throw; the host can re-flag via the public API.
     */
    try {
      dispatcher.markAsTestUser(testUserName);
    } catch {
      /** Persisted tester name was corrupted; ignore so init can complete. */
    }
  }
  const customEventSet = config.customEventSet;
  if (customEventSet !== undefined) {
    /**
     * Stamp both batches at construction time so every batch the
     * dispatcher emits - and every swap-on-empty - carries the
     * schema version. `resetForReuse()` deliberately preserves
     * `customEventsVersion`, so the value only needs to be written
     * once per init.
     */
    dispatcher.currentInBatch.customEventsVersion = customEventSet.version;
    dispatcher.currentSendingBatch.customEventsVersion = customEventSet.version;
  }
  const sendLoopAbort = new AbortController();
  const runtime: SdkRuntime = {
    config,
    endpoint,
    storage,
    platform,
    dispatcher,
    installId: identifiers.installId,
    userId: identifiers.userId,
    dataSessionId,
    consentState,
    sendLoopAbort,
    sendLoopPromise: null,
    detachFns: [],
    nextBatchNum: 0,
    onboardingCounters: new Map<string, number>(),
    preSdkInFlight: null,
    lastSceneName: undefined,
    customEventSet,
  };
  setRuntime(runtime);
  /**
   * Three-step ordering, preserved on the wire:
   *   1. `attachInitialEventsTracker` emits the canonical APP_LAUNCH /
   *      PLATFORM / ... burst synchronously into the in-batch buffer.
   *   2. `drainPreInitQueue` replays any host `report*` calls that
   *      landed BEFORE init resolved, in arrival order.
   *   3. `attachTrackers` installs the live listener trackers and host
   *      plugins. A plugin (or a NetInfo build that fires its
   *      subscriber synchronously with current state) may emit on
   *      attach - those events MUST land after the host's pre-init
   *      reports, which were chronologically earlier than the plugin
   *      attach.
   */
  attachInitialEventsTracker(runtime);
  drainPreInitQueue();
  attachTrackers(runtime, config);
  startSendLoop(runtime);
}

/**
 * Build and start the send loop against `runtime`. Reads all loop
 * args from runtime fields (storage / dispatcher / endpoint /
 * installId / apiKey via config) and the live `sendLoopAbort` so
 * the loop's signal stays in sync with the runtime's controller.
 * Stashes the resulting promise on `runtime.sendLoopPromise` so
 * `shutdown()` can await it before tearing down.
 *
 * Called from `startInit` on the original boot. The revoke path in
 * `setUserConsent` deliberately does NOT call this helper - the
 * loop is aborted and `sendLoopPromise` is nulled, but no fresh
 * loop is built (Denied is terminal under the current state
 * machine; restarting would just spin in the 'delete' branch and
 * would race a concurrent `shutdown()` that clears the runtime
 * between the revoke's await points).
 *
 * Centralizing the loop config here means any future config knob
 * (idleMs, batchesPerCycle, capBytes) lands in one place and a
 * future re-init path can call this helper directly.
 *
 * The loop's own helpers wrap every storage / HTTP call, so the
 * outer promise should never reject under normal operation; the
 * `.catch` is a defensive safety net that swallows regressions
 * instead of surfacing an unhandled-rejection warning.
 */
function startSendLoop(runtime: SdkRuntime): void {
  /**
   * `customEventSet` is spread conditionally because the field is
   * declared optional on `RunSendLoopArgs` and the project is on
   * `exactOptionalPropertyTypes: true` - assigning `undefined` to an
   * `T | undefined` slot trips the compiler.
   */
  runtime.sendLoopPromise = runSendLoop({
    storage: runtime.storage,
    dispatcher: runtime.dispatcher,
    endpoint: runtime.endpoint,
    apiKey: runtime.config.apiKey,
    installId: runtime.installId,
    getConsent: () => getRuntime().consentState,
    getNextBatchNum: () => allocBatchNum(getRuntime()),
    signal: runtime.sendLoopAbort.signal,
    batchesDir: BATCHES_DIR,
    ...(runtime.customEventSet === undefined ? {} : { customEventSet: runtime.customEventSet }),
    ...(runtime.config.getExtraHeaders === undefined
      ? {}
      : { getExtraHeaders: runtime.config.getExtraHeaders }),
  }).catch(() => {
    /** Defensive; loop body already catches every expected throw. */
  });
}

/**
 * Wind down the SDK. Ordering matters: abort the loop first, await
 * its exit so the dispatcher is no longer racing a live tick, then
 * flush any in-memory events to disk, then detach trackers, then
 * clear the runtime singleton. Idempotent - shutdown without a
 * prior init is a no-op.
 *
 * Persisting in-memory events on shutdown (instead of dropping them
 * with the dispatcher) is what keeps the last events of a session
 * from being lost when the host quits.
 */
async function shutdown(): Promise<void> {
  /**
   * If an init() is in flight, wait for it to install the runtime
   * (or fail) before reading state. Otherwise shutdown can return
   * early while startInit() finishes asynchronously, leaving the
   * send loop running after teardown was already requested.
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
    /**
     * Even with no runtime to tear down, the module-scope pre-init
     * scene buffer may still hold a stale `writeSceneCursor` value
     * from a pre-init render. Clear it so the next init() does not
     * observe a leftover that would emit a phantom SCENE_UNLOADED
     * on the first nav transition.
     */
    resetSceneCursor();
    return;
  }
  runtime.sendLoopAbort.abort();
  if (runtime.sendLoopPromise !== null) {
    await runtime.sendLoopPromise;
  }
  /**
   * The send loop's last `waitForSignal` may have armed the dispatcher's
   * idle timer (up to 30s). Aborting the loop wins its own race but does
   * not reach into the dispatcher to clear that timer, so without this
   * call the dispatcher and both batch buffers stay reachable until the
   * timer fires. Cancel it now that the loop has provably exited.
   */
  runtime.dispatcher.cancelPendingWait();
  /**
   * Wait for the one-shot pre-SDK registration to finish before the
   * final flush. The flow does an async `isPreSdkRegistered` read,
   * then `markPreSdkRegistered` write, then `addEventDateTime` on
   * the dispatcher. If shutdown landed in the middle, the marker
   * would be written to disk but the event would never reach a live
   * dispatcher (runtime gets cleared in the finally below), so the
   * one-shot slot would be burned with no wire output - permanently
   * losing the registration. Best-effort catch: a rejection here is
   * already documented as a no-op on the next launch.
   */
  if (runtime.preSdkInFlight !== null) {
    try {
      await runtime.preSdkInFlight;
    } catch {
      /** Best-effort: the one-shot pre-SDK registration failed before teardown. */
    }
  }
  /**
   * Honour the same consent gate the send loop applies: if the user
   * has revoked consent, the in-memory events MUST be dropped on
   * shutdown instead of getting one last chance to land on disk.
   * Otherwise denied-consent data would persist across the kill /
   * relaunch boundary.
   *
   * Wrapped in try / finally so the tracker detach + runtime
   * cleanup ALWAYS run, even if persistAccumulatedBatch ever
   * regresses and throws. A half-shutdown state (loop aborted but
   * trackers still attached, runtime still set) would otherwise
   * leak listeners and block a clean re-init.
   */
  try {
    await flushOrDropOnShutdown(runtime);
  } finally {
    detachAllTrackers(runtime);
    clearRuntime();
    /**
     * Drop the module-scope pre-init scene buffer too. Without this,
     * a pre-init `writeSceneCursor` that landed in the buffer (and
     * was already hydrated into the runtime's cursor on the first
     * post-init read) could survive `clearRuntime()` if a later
     * pre-shutdown nav write re-populated the buffer - leaking a
     * stale name into the next session's first transition.
     */
    resetSceneCursor();
  }
}

/**
 * Apply the consent gate to the in-memory + on-disk state at shutdown.
 * Denied consent drops the in-memory buffers AND deletes any .kwub
 * files the loop already persisted, so revoked consent leaves nothing
 * behind across the kill / relaunch boundary. Granted consent runs the
 * final persist of in-memory events instead.
 *
 * Best-effort cleanup on the denied path: listing or per-file delete
 * failures fall through silently and the next launch's send-loop
 * cleanup pass picks them up.
 */
async function flushOrDropOnShutdown(runtime: SdkRuntime): Promise<void> {
  if (consentGate(runtime.consentState) === 'delete') {
    /**
     * Isolate the two resets so a throw from the in-batch reset
     * does NOT skip the sending-batch reset (which would leave
     * denied-consent data in the other in-memory buffer). The
     * first reset error is captured and rethrown only AFTER
     * deleteQueuedBatches has run, so the on-disk cleanup
     * cannot be skipped by a tangled in-memory buffer either.
     * The rethrown error propagates to the outer try / finally
     * in shutdown so trackers detach and the runtime clears.
     */
    let resetError: unknown = null;
    try {
      runtime.dispatcher.currentInBatch.resetForReuse();
    } catch (err: unknown) {
      resetError = err;
    }
    try {
      runtime.dispatcher.currentSendingBatch.resetForReuse();
    } catch (err: unknown) {
      if (resetError === null) resetError = err;
    }
    await deleteQueuedBatches(runtime);
    if (resetError !== null) throw resetError;
    return;
  }
  await persistAccumulatedBatch({
    storage: runtime.storage,
    dispatcher: runtime.dispatcher,
    dir: BATCHES_DIR,
    allocBatchNum: () => allocBatchNum(runtime),
  });
}

/**
 * Best-effort delete every `.kwub` file under `BATCHES_DIR`. Listing
 * and per-file delete errors are swallowed so a transient storage
 * failure cannot block shutdown; the next launch's send-loop sweep
 * picks up anything left behind.
 */
async function deleteQueuedBatches(runtime: SdkRuntime): Promise<void> {
  try {
    const files = await listBatches({ storage: runtime.storage, dir: BATCHES_DIR });
    for (const file of files) {
      try {
        await deleteBatch({ storage: runtime.storage, path: file.path });
      } catch {
        /** Per-file failure; skip and let the next launch retry. */
      }
    }
  } catch {
    /** Listing failed (permissions / I/O); next launch will retry. */
  }
}

/** `true` when {@link init} has resolved at least once and `shutdown` has not run since. */
function isReady(): boolean {
  return isInitialized();
}

/**
 * Transition the consent state machine. Persists the new state.
 * No event is emitted into the dispatcher stream - consent is
 * dispatcher-private state, not a wire event.
 */
async function setUserConsent(granted: boolean): Promise<void> {
  const pending = getInitPromise();
  if (pending !== null) await pending;
  const runtime = getRuntime();
  const next = await setConsentCore({
    storage: runtime.storage,
    current: runtime.consentState,
    granted,
  });
  runtime.consentState = next;
  /**
   * Privacy gap regression: revoking consent used to only flip the
   * in-memory state machine and leave the cleanup to the send loop's
   * next iteration. That left a window where:
   *   - accumulated in-memory events sat in `currentInBatch` /
   *     `currentSendingBatch`
   *   - queued `.kwub` files sat on disk
   *   - an already-issued `sendBatch` POST kept running and could
   *     deliver data AFTER the revoke returned
   * until the next loop tick (up to `idleMs`) or until `shutdown()`.
   * Purge both layers AND abort the in-flight send the moment the
   * gate flips to `'delete'` so the privacy promise is observable
   * as soon as the call returns. The loop is then restarted with a
   * fresh AbortController so a later opt-in via consent flipping
   * back to a sendable state (within the same install / session)
   * still has a live sender. Best-effort: reset throws cannot mask
   * the disk cleanup; a disk failure is handled internally by
   * `deleteQueuedBatches`.
   */
  if (consentGate(next) === 'delete') {
    /**
     * Abort the live loop first: that cancels any in-flight
     * `sendBatch` via the shared signal so an already-issued POST
     * does not race the cleanup. Wait for the loop to exit so the
     * dispatcher is no longer racing us before resetting buffers.
     */
    runtime.sendLoopAbort.abort();
    if (runtime.sendLoopPromise !== null) {
      await runtime.sendLoopPromise;
    }
    try {
      runtime.dispatcher.currentInBatch.resetForReuse();
    } catch {
      /** Best-effort cleanup; disk delete still runs below. */
    }
    try {
      runtime.dispatcher.currentSendingBatch.resetForReuse();
    } catch {
      /** Best-effort cleanup; disk delete still runs below. */
    }
    await deleteQueuedBatches(runtime);
    /**
     * Do NOT restart the loop here. `Denied` is terminal under the
     * current consent state machine, so a restarted loop would just
     * sit in the `'delete'` branch on every iteration with no real
     * benefit. Restarting also creates a lifecycle race with
     * `shutdown()`: between `await deleteQueuedBatches` and the
     * sync replacement of `sendLoopAbort`, `shutdown()` can run
     * (abort old loop, await its exit, flush, clearRuntime).
     * Resuming setUserConsent would then build a fresh loop against
     * a now-null `activeRuntime`; the loop's `() => getRuntime()`
     * lookups would throw, `readConsentSafely` would catch and fall
     * back to `'keep'`, and the loop would spin indefinitely with
     * no abort signal ever firing. Null out `sendLoopPromise` so a
     * subsequent `shutdown()` no-ops the await without restarting.
     */
    runtime.sendLoopPromise = null;
  }
}

/**
 * The single facade end users interact with. Implements
 * {@link KeewanoApi}; the method surface is described in that
 * interface's header documentation.
 */
const Keewano: KeewanoApi = {
  init,
  shutdown,
  isReady,
  getInstallId,
  setUserId,
  setUserConsent,
  markAsTestUser,
  reportUserRegisteredBeforeSDKIntegration,
  reportButtonClick,
  reportWindowOpen,
  reportWindowClose,
  reportSceneLoaded,
  reportSceneUnloaded,
  reportOnboardingMilestone,
  reportABTestGroupAssignment,
  reportInAppPurchase,
  reportInAppPurchaseItemsGranted,
  reportAdOffered,
  reportAdRevenue,
  reportAdItemsGranted,
  reportSubscriptionRevenue,
  reportSubscriptionItemsGranted,
  reportItemsExchange,
  reportItemsReset,
  reportInstallCampaign,
  reportGameLanguage,
  reportCustomEvent,
  logError,
};

export type { KeewanoApi } from './types/keewano';
export { Keewano };
