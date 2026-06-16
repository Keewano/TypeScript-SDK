/**
 * dispatcher - Live event accumulator the tracker emits into when
 *   `attach()` runs.
 * platform - Resolved `PlatformAdapter` whose fields populate the
 *   init burst (PLATFORM / OS / OS_VERSION / DEVICE_TYPE / RAM_SIZE_MB
 *   / SCREEN_WIDTH / SCREEN_HEIGHT / SYSTEM_LANGUAGE / APP_VERSION).
 *   Held as a field so a future `detach() / re-attach()` cycle could
 *   re-emit without the facade re-resolving deps.
 */
import type { KEventDispatcher } from '@keewano/core';

import type { PlatformAdapter } from '../../types/platformAdapter';

interface InitialEventsTrackerArgs {
  dispatcher: KEventDispatcher;
  platform: PlatformAdapter;
}

export type { InitialEventsTrackerArgs };
