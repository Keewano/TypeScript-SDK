/**
 * Node runtime singleton state. Extends the platform-agnostic
 * `KeewanoRuntime` contract (dispatcher, storage, installId, userId,
 * customEventSet, onboardingCounters, preSdkInFlight) with the Node relay
 * lifecycle fields below. Produced by `Keewano.init`, cleared by
 * `Keewano.shutdown`.
 *
 * The relay SDK keeps no self-telemetry, so several base fields are inert:
 * `dispatcher` is an empty send-loop dispatcher that never accumulates
 * (every user's events go to a per-batch dispatcher inside
 * `reportUserBatch`); `installId` exists only to construct that dispatcher
 * and never reaches the wire (the send loop ships with no `K-InstallId`)
 * or disk; `userId` is the all-zero "no user" marker; `onboardingCounters`
 * is swapped for a fresh per-batch map during each `reportUserBatch`.
 *
 * config - the caller-supplied config (re-init checks, send-loop wiring).
 * endpoint - resolved ingress URL (config override or library default).
 * dataSessionId - 16-byte UUID, freshly generated once per init and shared
 *   by every batch this process ships.
 * sendLoopAbort - AbortController that stops the background send loop on
 *   shutdown.
 * sendLoopPromise - resolves when the send loop has exited; `null` before
 *   the loop starts. Shutdown awaits it before clearing the runtime.
 * nextBatchNum - monotonic counter for the next `.kwub` file's batchNum;
 *   seeded at init from the highest on-disk batchNum + 1 (0 on a fresh
 *   dataDir) so a restart never reuses a number an unsent batch carries.
 */

import type { KeewanoRuntime } from '@keewano/core';

import type { NodeKeewanoConfig } from './config';

interface NodeRuntime extends KeewanoRuntime {
  config: NodeKeewanoConfig;
  endpoint: string;
  dataSessionId: Uint8Array;
  sendLoopAbort: AbortController;
  sendLoopPromise: Promise<void> | null;
  nextBatchNum: number;
}

export type { NodeRuntime };
