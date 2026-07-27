/**
 * React Native runtime access: a thin platform binding over the
 * platform-agnostic runtime singleton in `@keewano/core`. The core
 * singleton stores and returns the base `KeewanoRuntime`; the
 * lifecycle accessors are re-exported unchanged, while `getRuntime` /
 * `getRuntimeOrNull` are narrowed to the React Native `SdkRuntime`
 * superset (init always installs an `SdkRuntime`, so the narrow is
 * sound). `allocBatchNum` lives here because `nextBatchNum` is a
 * React Native runtime field, not part of the shared contract.
 */

import type { SdkRuntime } from './types/runtime';

import {
  getRuntime as getCoreRuntime,
  getRuntimeOrNull as getCoreRuntimeOrNull,
} from '@keewano/core';

/** Narrow the active runtime to `SdkRuntime`; init always installs one. */
function getRuntime(): SdkRuntime {
  return getCoreRuntime<SdkRuntime>();
}

/** Non-throwing narrowing variant; `null` before init. */
function getRuntimeOrNull(): SdkRuntime | null {
  return getCoreRuntimeOrNull<SdkRuntime>();
}

/**
 * Allocate the next monotonic `batchNum` and advance the runtime's
 * counter. Centralized so the send-loop tick and the shutdown flush
 * share one source. `nextBatchNum` is a React Native runtime field
 * (send-loop wiring), so this stays in the platform layer.
 *
 * @returns The pre-increment counter value; the next call returns the
 *   value after.
 */
function allocBatchNum(runtime: SdkRuntime): number {
  const n = runtime.nextBatchNum;
  runtime.nextBatchNum = n + 1;
  return n;
}

export type { SdkRuntime } from './types/runtime';
export {
  clearRuntime,
  drainPreInitQueue,
  enqueuePreInit,
  getInitPromise,
  isInitialized,
  isInitializing,
  setInitPromise,
  setRuntime,
} from '@keewano/core';
export { allocBatchNum, getRuntime, getRuntimeOrNull };
