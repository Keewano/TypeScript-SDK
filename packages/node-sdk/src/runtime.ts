/**
 * Node runtime access: a thin binding over the platform-agnostic runtime
 * singleton in `@keewano/core`. The core singleton stores and returns
 * the base `KeewanoRuntime`; the lifecycle accessors are re-exported
 * unchanged, while `getRuntime` / `getRuntimeOrNull` are narrowed to the
 * Node `NodeRuntime` superset (init always installs a `NodeRuntime`, so
 * the narrow is sound). `allocBatchNum` lives here because `nextBatchNum`
 * is a Node runtime field, not part of the shared contract.
 */

import type { NodeRuntime } from './types/runtime';

import {
  getRuntime as getCoreRuntime,
  getRuntimeOrNull as getCoreRuntimeOrNull,
} from '@keewano/core';

/** Narrow the active runtime to `NodeRuntime`; init always installs one. */
function getRuntime(): NodeRuntime {
  return getCoreRuntime<NodeRuntime>();
}

/** Non-throwing narrowing variant; `null` before init. */
function getRuntimeOrNull(): NodeRuntime | null {
  return getCoreRuntimeOrNull<NodeRuntime>();
}

/**
 * Allocate the next monotonic `batchNum` and advance the runtime's
 * counter. Centralized so the send-loop tick and the shutdown flush
 * share one source.
 *
 * @returns The pre-increment counter value; the next call returns the
 *   value after.
 */
function allocBatchNum(runtime: NodeRuntime): number {
  const n = runtime.nextBatchNum;
  runtime.nextBatchNum = n + 1;
  return n;
}

export type { NodeRuntime } from './types/runtime';
export {
  clearRuntime,
  drainPreInitQueue,
  getInitPromise,
  isInitialized,
  isInitializing,
  setInitPromise,
  setRuntime,
} from '@keewano/core';
export { allocBatchNum, getRuntime, getRuntimeOrNull };
