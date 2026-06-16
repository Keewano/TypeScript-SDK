/**
 * dispatcher - Live event accumulator. The tracker emits APP_PAUSE
 *   when the host enters `'background'` / `'inactive'` and APP_RESUME
 *   when it returns to `'active'`.
 * loadRn - Optional injection point for tests. Defaults to the lazy
 *   `require('react-native')` loader.
 * signalSend - Optional hook called after APP_PAUSE so the send loop
 *   wakes immediately. Defaults to `dispatcher.signalSend()`; tests
 *   inject a spy to assert the wake without owning the dispatcher
 *   internals.
 * now - Optional clock injection. Defaults to `() => new Date()`.
 *   Tests inject a fixed clock so the emitted Date payload is
 *   deterministic.
 */
import type { KEventDispatcher } from '@keewano/core';

import type { LoadRn } from './rn';

interface AppStateTrackerArgs {
  dispatcher: KEventDispatcher;
  loadRn?: LoadRn;
  signalSend?: () => void;
  now?: () => Date;
}

export type { AppStateTrackerArgs };
