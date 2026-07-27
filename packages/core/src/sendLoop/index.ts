/**
 * Background send loop: the persistence-first ship / cleanup engine
 * that drives `.kwub` batches from disk to the ingress under the
 * consent gate. Platform-agnostic - depends only on core abstractions
 * plus standard timers / fetch / AbortController, so every platform
 * facade (React Native, Node) reuses it as-is.
 */

export type { PersistAccumulatedBatchArgs, RunSendLoopArgs } from './types/sendLoop';

export { persistAccumulatedBatch, runSendLoop } from './sendLoop';
