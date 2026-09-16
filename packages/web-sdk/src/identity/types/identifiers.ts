/** Args types for the web identity load flow. */

import type { StorageAdapter } from '@keewano/core';

/**
 * storage - Ladder-backed identity storage adapter the core
 *   load-or-init flow runs against.
 */
interface LoadAdoptedIdentifiersArgs {
  storage: StorageAdapter;
}

export type { LoadAdoptedIdentifiersArgs };
