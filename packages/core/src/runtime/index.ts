/**
 * Runtime singleton + pre-init queue + the platform-agnostic runtime
 * contract the shared `report*` surface depends on. Platform facades
 * install their superset runtime via `setRuntime` and read it back,
 * typed to their own runtime, through the generic `getRuntime`.
 */

export type { KeewanoRuntime } from './types/keewanoRuntime';

export {
  clearRuntime,
  drainPreInitQueue,
  enqueuePreInit,
  getInitPromise,
  getRuntime,
  getRuntimeOrNull,
  isInitialized,
  isInitializing,
  setInitPromise,
  setRuntime,
} from './runtime';
