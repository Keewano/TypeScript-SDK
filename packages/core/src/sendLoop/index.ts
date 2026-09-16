/**
 * Background send loop: the persistence-first ship / cleanup engine
 * that drives `.kwub` batches from disk to the ingress under the
 * consent gate. Platform-agnostic - depends only on core abstractions
 * plus standard timers / fetch / AbortController, so every platform
 * facade (React Native, Node) reuses it as-is.
 */

export type {
  DropInMemoryBatchesArgs,
  OnShipPassArgs,
  PurgeRevokedDataArgs,
  PersistAccumulatedBatchArgs,
  RunSendLoopArgs,
  WaitForSignalOrTimeoutArgs,
} from './types/sendLoop';

/**
 * The idle cadence, the wake race, and the consent-revoke buffer reset
 * are exported alongside the loop itself: a platform whose delivery is
 * split across processes (the browser elects one tab to ship, while
 * every other tab must still persist on the same cadence) runs a
 * partial loop of its own, and a second copy of these would be free to
 * drift from the behaviour the ship path assumes.
 */
export {
  DEFAULT_IDLE_MS,
  dropInMemoryBatches,
  persistAccumulatedBatch,
  purgeRevokedData,
  runSendLoop,
  waitForSignalOrTimeout,
} from './sendLoop';
