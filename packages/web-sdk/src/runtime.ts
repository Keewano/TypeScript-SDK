/**
 * Web runtime access: a thin platform binding over the runtime
 * singleton in `@keewano/core`, with `getRuntime` / `getRuntimeOrNull`
 * narrowed to the web `WebSdkRuntime` superset.
 */

import type { WebSdkRuntime } from './types/runtime';

import {
  getRuntime as getCoreRuntime,
  getRuntimeOrNull as getCoreRuntimeOrNull,
} from '@keewano/core';

/** Narrow the active runtime to `WebSdkRuntime`; init always installs one. */
function getRuntime(): WebSdkRuntime {
  return getCoreRuntime<WebSdkRuntime>();
}

/** Non-throwing narrowing variant; `null` before init. */
function getRuntimeOrNull(): WebSdkRuntime | null {
  return getCoreRuntimeOrNull<WebSdkRuntime>();
}

/**
 * Allocate the next monotonic `batchNum` (returns the pre-increment
 * value). One source shared by the send-loop tick and the shutdown
 * flush.
 */
function allocBatchNum(runtime: WebSdkRuntime): number {
  const n = runtime.nextBatchNum;
  runtime.nextBatchNum = n + 1;
  return n;
}

export type { WebSdkRuntime } from './types/runtime';
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
