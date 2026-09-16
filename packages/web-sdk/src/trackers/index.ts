/**
 * Built-in web auto-trackers. Each is a `KeewanoTracker` class the
 * lifecycle pipeline attaches at init (gated by its config flag) and
 * detaches at shutdown; hosts can also instantiate them manually as
 * plugins with custom seams.
 */

export type { EnvironmentLike, EnvironmentTrackerArgs } from './environment';
export type { NavigationTrackerArgs, ResolveWindowName } from './navigation';
export type { ClickTrackerArgs } from './clicks';
export type { ErrorTrackerArgs } from './errors';
export type { VisibilityTrackerArgs } from './lifecycle';
export type { ConnectivityTrackerArgs } from './connectivity';

export { EnvironmentTracker } from './environment';
export { NavigationTracker } from './navigation';
export { ClickTracker } from './clicks';
export { ErrorTracker } from './errors';
export { VisibilityTracker } from './lifecycle';
export { ConnectivityTracker } from './connectivity';
