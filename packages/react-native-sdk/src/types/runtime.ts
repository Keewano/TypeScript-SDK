/**
 * React Native runtime singleton state. Extends the platform-agnostic
 * {@link KeewanoRuntime} contract (dispatcher, storage, installId,
 * userId, customEventSet, onboardingCounters, preSdkInFlight) with the
 * React-Native-specific lifecycle and tracking fields below. Produced
 * by `Keewano.init`, cleared by `Keewano.shutdown`, held by the
 * runtime module's module-scoped pointer so the facade can read it
 * without threading a context object through every call site.
 *
 * config - The full caller-supplied config (re-init checks, plugins).
 * endpoint - Resolved ingress URL (config override or library default).
 * platform - Resolved platform adapter (source for the initial-event burst).
 * dataSessionId - 16-byte UUID, freshly generated on every init so each
 *   launch is a distinct session.
 * consentState - Current GDPR / CCPA gate value.
 * sendLoopAbort - AbortController that stops the background send loop on
 *   shutdown.
 * sendLoopPromise - Resolves when the send loop has exited (after abort);
 *   `null` in unit-test runtimes that never start the loop. Shutdown
 *   awaits it before flushing so the final swap cannot race a live tick.
 * detachFns - Tracker cleanup callbacks accumulated by the plugin
 *   pipeline; invoked best-effort on shutdown.
 * nextBatchNum - Monotonic counter for the next `.kwub` file's batchNum;
 *   resets to 0 per init.
 * lastSceneName - Last route name the navigation hooks successfully
 *   emitted a SCENE_LOADED for. Held on the runtime so React Strict Mode
 *   remounts survive while shutdown cleanly resets it. `undefined` when
 *   no scene has been emitted yet.
 */

import type { ConsentState, KeewanoRuntime } from '@keewano/core';

import type { KeewanoConfig } from './config';
import type { PlatformAdapter } from './platformAdapter';

interface SdkRuntime extends KeewanoRuntime {
  config: KeewanoConfig;
  endpoint: string;
  platform: PlatformAdapter;
  dataSessionId: Uint8Array;
  consentState: ConsentState;
  sendLoopAbort: AbortController;
  sendLoopPromise: Promise<void> | null;
  detachFns: Array<() => void>;
  nextBatchNum: number;
  lastSceneName: string | undefined;
}

export type { SdkRuntime };
