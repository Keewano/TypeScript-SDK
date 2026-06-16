/**
 * Initial-events tracker. Emits the canonical environment burst
 * (APP_LAUNCH -> PLATFORM -> DEVICE_TYPE -> OS -> RAM_SIZE ->
 * SCREEN_RESOLUTION -> SYSTEM_LANG) on `attach()`. The emit is a
 * one-shot snapshot of host metadata; `detach()` is a no-op because
 * there is nothing to unsubscribe.
 *
 * The tracker exists so the auto-tracker lifecycle is uniform:
 * every built-in component goes through the same instantiate-then-
 * attach pipeline. A host that wants a different init burst can opt
 * out of every other tracker but still implement a custom
 * `KeewanoTracker` that emits a host-specific set of initial events.
 */

import type { KeewanoTracker } from '../types/config';
import type { InitialEventsTrackerArgs } from './types/InitialEventsTracker';

import { emitInitialEvents } from '../initialEvents';

import { noopDetach } from './noopDetach';

class InitialEventsTracker implements KeewanoTracker {
  readonly name = 'InitialEventsTracker';

  /**
   * The init-burst is the canonical first 7 events of every session;
   * server-side analytics rely on the burst being present. If
   * `emitInitialEvents` throws (typically a misconfigured
   * PlatformAdapter), surface the error by rejecting `Keewano.init()`
   * rather than booting silently into a session with missing
   * environment metadata.
   */
  readonly criticalPath = true;

  private readonly args: InitialEventsTrackerArgs;

  constructor(args: InitialEventsTrackerArgs) {
    this.args = args;
  }

  /**
   * Emit the canonical init-burst into the dispatcher and return a
   * no-op detach. The emit runs in the caller's frame so the events
   * appear in the in-batch before the send loop's first wake.
   */
  attach(): () => void {
    emitInitialEvents({ dispatcher: this.args.dispatcher, platform: this.args.platform });
    return noopDetach;
  }
}

export type { InitialEventsTrackerArgs } from './types/InitialEventsTracker';
export { InitialEventsTracker };
