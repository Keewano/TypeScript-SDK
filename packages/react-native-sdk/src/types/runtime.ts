/**
 * Internal SDK runtime singleton state. Produced by `Keewano.init`,
 * cleared by `Keewano.shutdown`. Held by the runtime module's
 * module-scoped pointer so the public facade can read it without
 * threading a context object through every call site.
 *
 * config - The full caller-supplied config (kept for re-init checks
 *   and for future plugin lifecycle).
 * endpoint - Resolved ingress URL (config override or library default).
 * storage - Resolved storage adapter (config override or platform default).
 * platform - Resolved platform adapter (config override or platform default).
 * dispatcher - Event accumulator + swap signal owner.
 * installId - 16-byte mixed-endian GUID; persisted across launches.
 * userId - 16-byte mixed-endian GUID; all-zero until host calls
 *   `setUserId` with a real identity.
 * dataSessionId - 16-byte mixed-endian GUID; freshly generated on
 *   every init so each launch is a distinct session.
 * consentState - Current GDPR / CCPA gate value.
 * sendLoopAbort - AbortController that stops the background send
 *   loop on `shutdown()`.
 * sendLoopPromise - Resolves when the send loop has exited (after
 *   abort). `null` in unit-test runtimes that never start the loop.
 *   `shutdown()` awaits it before flushing the dispatcher so the
 *   final swap+save cannot race a still-running loop iteration.
 * detachFns - Tracker cleanup callbacks accumulated by the plugin
 *   pipeline; invoked best-effort on shutdown.
 * nextBatchNum - Monotonic counter for the next `.kwub` file's
 *   `batchNum`. Resets to 0 per init.
 * onboardingCounters - Dedup counter for `reportOnboardingMilestone`.
 *   Lives in the runtime so `shutdown()` clears it; module-scope
 *   storage would survive shutdown + re-init and corrupt dedup.
 * preSdkInFlight - Latch for the one-shot
 *   `reportUserRegisteredBeforeSDKIntegration` flow. Holds the
 *   currently-running invocation's promise so concurrent callers
 *   await the same in-flight check/mark/emit sequence instead of
 *   racing past `isPreSdkRegistered()` and emitting duplicates.
 *   `null` when no call is in flight.
 * lastSceneName - Last route name the navigation hooks
 *   (`useKeewanoNavigation`) successfully emitted a SCENE_LOADED for.
 *   Held on the runtime - not in module scope - so React Strict Mode
 *   remounts survive (cursor outlives the hook lifecycle) while
 *   `Keewano.shutdown()` cleanly resets the cursor along with the
 *   runtime (no phantom SCENE_UNLOADED with a stale name into a
 *   re-init session). `undefined` when no scene has been emitted yet.
 * customEventSet - Schema declared via `Keewano.init({ customEventSet })`,
 *   or `undefined` when the host did not declare one. The send loop
 *   probes `GET /custom` once per session and, on `204`, uploads
 *   `customEventSet.gzipData` via `POST /custom` before any batch
 *   reaches `POST /in`.
 */

import type { ConsentState, CustomEventSet, KEventDispatcher, StorageAdapter } from '@keewano/core';

import type { KeewanoConfig } from './config';
import type { PlatformAdapter } from './platformAdapter';

interface SdkRuntime {
  config: KeewanoConfig;
  endpoint: string;
  storage: StorageAdapter;
  platform: PlatformAdapter;
  dispatcher: KEventDispatcher;
  installId: Uint8Array;
  userId: Uint8Array;
  dataSessionId: Uint8Array;
  consentState: ConsentState;
  sendLoopAbort: AbortController;
  sendLoopPromise: Promise<void> | null;
  detachFns: Array<() => void>;
  nextBatchNum: number;
  onboardingCounters: Map<string, number>;
  preSdkInFlight: Promise<void> | null;
  lastSceneName: string | undefined;
  customEventSet: CustomEventSet | undefined;
}

export type { SdkRuntime };
