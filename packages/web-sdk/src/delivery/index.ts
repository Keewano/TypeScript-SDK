/**
 * Web delivery layer: the batch queue's write bookkeeping, the
 * single-sender election with its persist-only loop for queued tabs,
 * exit-time persistence, and cross-tab consent propagation (the ship
 * pass itself is the shared core loop, wired in the facade).
 */

export type { PersistQueuedBatchesArgs, QueueObservers } from './types/batchQueue';
export type {
  AttachConsentSyncArgs,
  ConsentSyncDocumentLike,
  ConsentSyncWindowLike,
} from './types/consentSync';
export type {
  AttachExitFlushArgs,
  ExitFlushDocumentLike,
  ExitFlushWindowLike,
} from './types/exitFlush';
export type { RunPersistLoopArgs } from './types/persistLoop';
export type {
  LockManagerLike,
  QueuedLoop,
  QueuedLoopArgs,
  RunAsSingleSenderArgs,
} from './types/senderLock';
export {
  BATCHES_DIR,
  canSendAtExit,
  persistQueuedBatches,
  queueObservers,
  readQueueSeed,
} from './batchQueue';
export { adoptRecordedConsentSync, attachConsentSync } from './consentSync';
export { attachExitFlush } from './exitFlush';
export { runPersistLoop } from './persistLoop';
export { SENDER_LOCK_NAME, runAsSingleSender } from './senderLock';
