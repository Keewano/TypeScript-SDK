/**
 * Built-in auto-tracker barrel. Each class implements `KeewanoTracker`
 * (a `name` + an `attach()` returning a detach) and owns one telemetry
 * source:
 *
 *   - AppStateTracker      - APP_PAUSE / APP_RESUME from RN AppState.
 *   - BackHandlerTracker   - BUTTON_CLICK from the Android hardware back.
 *   - ErrorTracker         - ERROR_MSG from the global error handler.
 *   - InitialEventsTracker - the init-burst environment events.
 *   - LinkingTracker       - DEEP_LINK_ACTIVATED from RN Linking.
 *   - NetworkTracker       - INTERNET_CONNECTED / _DISCONNECTED (NetInfo).
 *   - PressableTracker      - BUTTON_CLICK via the Pressable / Touchable
 *     monkey-patch; `pickButtonName` is the shared label resolver.
 *
 * Trackers are wired up internally by `Keewano.init`; this barrel
 * exists for host plugins and tests that compose them directly.
 */
export type { AppStateTrackerArgs } from './AppStateTracker';
export type { BackHandlerTrackerArgs } from './BackHandlerTracker';
export type { ErrorTrackerArgs } from './ErrorTracker';
export type { InitialEventsTrackerArgs } from './InitialEventsTracker';
export type { LinkingTrackerArgs } from './LinkingTracker';
export type { NetworkTrackerArgs } from './NetworkTracker';
export type { PressableTrackerArgs } from './PressableTracker';

export { AppStateTracker } from './AppStateTracker';
export { BackHandlerTracker } from './BackHandlerTracker';
export { ErrorTracker } from './ErrorTracker';
export { InitialEventsTracker } from './InitialEventsTracker';
export { LinkingTracker } from './LinkingTracker';
export { NetworkTracker } from './NetworkTracker';
export { pickButtonName, PressableTracker } from './PressableTracker';
