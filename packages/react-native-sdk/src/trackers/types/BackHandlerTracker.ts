/**
 * dispatcher - Live event accumulator. Emits a BUTTON_CLICK event
 *   with the payload `"Android Device Back Button"` per back-press.
 * loadRn - Optional injection point for tests. Defaults to the lazy
 *   `require('react-native')` loader.
 */
import type { KEventDispatcher } from '@keewano/core';

import type { LoadRn } from './rn';

interface BackHandlerTrackerArgs {
  dispatcher: KEventDispatcher;
  loadRn?: LoadRn;
}

export type { BackHandlerTrackerArgs };
