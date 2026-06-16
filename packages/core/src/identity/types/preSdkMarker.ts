import type { StorageAdapter } from '../../storage';

/**
 * Args bag for `isPreSdkRegistered` and `markPreSdkRegistered`.
 *
 * storage - Storage adapter that backs the marker file. Both
 *   read-side (`isPreSdkRegistered`) and write-side
 *   (`markPreSdkRegistered`) operations go through it.
 */
interface PreSdkMarkerArgs {
  storage: StorageAdapter;
}

export type { PreSdkMarkerArgs };
