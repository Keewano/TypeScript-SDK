/** Args types for the ladder-backed identity storage adapter. */

import type { StorageAdapter } from '@keewano/core';

import type { WebValueStore } from './webValueStore';

/**
 * store - Value store (durability ladder) the identifiers and consent
 *   files are rerouted through.
 * fallback - Storage adapter every other path passes through to
 *   (test-user marker, and any other SDK state file).
 */
interface WebIdentityStorageAdapterArgs {
  store: WebValueStore;
  fallback: StorageAdapter;
}

export type { WebIdentityStorageAdapterArgs };
