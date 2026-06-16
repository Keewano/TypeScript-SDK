/**
 * dispatcher - Live event accumulator. Emits DEEP_LINK_ACTIVATED
 *   with the activation URL as payload per Linking 'url' event.
 * loadRn - Optional injection point for tests. Defaults to the lazy
 *   `require('react-native')` loader.
 */
import type { KEventDispatcher } from '@keewano/core';

import type { LoadRn } from './rn';

interface LinkingTrackerArgs {
  dispatcher: KEventDispatcher;
  loadRn?: LoadRn;
}

export type { LinkingTrackerArgs };
