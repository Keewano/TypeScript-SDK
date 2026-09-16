/**
 * Tracker lifecycle pipeline: build the built-in set, append host
 * plugins, attach each defensively, tear them all down on shutdown.
 * `config.plugins` and each plugin's `attach()` / detach handle can
 * come from untyped page JS, so every read and call is hardened - one
 * malformed plugin must not crash `init()` or leak listeners.
 */

import type { KeewanoTracker, WebKeewanoConfig } from './types/config';
import type {
  AttachOneTrackerArgs,
  AttachTrackersArgs,
  BuildBuiltInsArgs,
  BuiltInGates,
  NormalizeDetachArgs,
} from './types/trackerPipeline';
import type { WebSdkRuntime } from './types/runtime';

import {
  ClickTracker,
  ConnectivityTracker,
  EnvironmentTracker,
  ErrorTracker,
  NavigationTracker,
  VisibilityTracker,
} from './trackers';

/**
 * Guarded read of the host app version, mirroring `readBuiltInGates`:
 * the value can arrive from untyped page JS, and the environment burst
 * is criticalPath, so a hostile getter or a non-string must degrade to
 * the tracker's "undefined" fallback rather than fail init.
 */
function readAppVersion(config: WebKeewanoConfig): string | undefined {
  try {
    const value = config.appVersion;
    return typeof value === 'string' && value !== '' ? value : undefined;
  } catch (err: unknown) {
    console.error('Keewano.init: failed to read appVersion; reporting "undefined".', err);
    return undefined;
  }
}

/**
 * Attach the environment-burst tracker ALONE, before the pre-init
 * queue drains: its events are the session preamble the server
 * expects first, ahead of any host report that queued before init.
 * criticalPath semantics apply - a failed burst fails init.
 */
function attachEnvironmentTracker(runtime: WebSdkRuntime): void {
  const base = { dispatcher: runtime.dispatcher };
  const appVersion = readAppVersion(runtime.config);
  attachOneTracker({
    runtime,
    tracker: new EnvironmentTracker(appVersion === undefined ? base : { ...base, appVersion }),
  });
}

/**
 * Guarded snapshot of the gating config fields, mirroring the
 * hardened `plugins` read: a hostile getter on a flag must degrade
 * that one field to its default (tracker enabled) rather than abort
 * init after the environment burst and pre-init drain have already
 * emitted.
 */
function readBuiltInGates(config: WebKeewanoConfig): BuiltInGates {
  const gates: BuiltInGates = {
    navigation: true,
    button: true,
    error: true,
    appState: true,
    network: true,
  };
  try {
    gates.navigation = config.disableNavigationTracking !== true;
    gates.button = config.disableButtonTracking !== true;
    gates.error = config.disableErrorTracking !== true;
    gates.appState = config.disableAppStateTracking !== true;
    gates.network = config.disableNetworkTracking !== true;
    const resolver = config.resolveWindowName;
    if (typeof resolver === 'function') gates.resolveWindowName = resolver;
  } catch (err: unknown) {
    console.error('Keewano.init: failed to read tracker config; using defaults.', err);
  }
  return gates;
}

/**
 * The live built-in auto-tracker set, in attach order. Runs AFTER
 * the environment burst and the pre-init drain, so the navigation
 * tracker's initial WINDOW_OPEN lands after both. Every tracker here
 * is gated by its `disable*` config flag.
 */
function buildBuiltIns({ runtime, config }: BuildBuiltInsArgs): KeewanoTracker[] {
  const gates = readBuiltInGates(config);
  const trackers: KeewanoTracker[] = [];
  if (gates.navigation) {
    trackers.push(
      new NavigationTracker(
        gates.resolveWindowName === undefined ? {} : { resolveWindowName: gates.resolveWindowName },
      ),
    );
  }
  if (gates.button) {
    trackers.push(new ClickTracker());
  }
  if (gates.error) {
    trackers.push(new ErrorTracker());
  }
  if (gates.appState) {
    trackers.push(new VisibilityTracker({ dispatcher: runtime.dispatcher }));
  }
  if (gates.network) {
    trackers.push(new ConnectivityTracker({ dispatcher: runtime.dispatcher }));
  }
  return trackers;
}

/** A failing non-critical `attach()` is logged but does NOT block the rest. */
function attachTrackers({ runtime, config }: AttachTrackersArgs): void {
  const builtIns = buildBuiltIns({ runtime, config });
  /**
   * Read `config.plugins` exactly once through a try/catch: a hostile
   * Proxy / throwing getter would otherwise crash attachTrackers
   * BEFORE any built-in attaches.
   */
  let plugins: readonly KeewanoTracker[] = [];
  try {
    const rawPlugins = config.plugins;
    if (rawPlugins == null) {
      plugins = [];
    } else if (Array.isArray(rawPlugins)) {
      /**
       * Shallow-copy: a plugin's `attach()` could mutate the original
       * array mid-init (skip later plugins, double-attach, inject
       * entries). The snapshot freezes the attach order.
       */
      plugins = rawPlugins.slice();
    } else {
      console.error('Keewano.init: ignoring malformed `plugins`; expected an array.');
    }
  } catch (err: unknown) {
    console.error('Keewano.init: ignoring malformed `plugins`; failed to read config.', err);
  }
  for (const tracker of builtIns) {
    attachOneTracker({ runtime, tracker });
  }
  for (const tracker of plugins) {
    attachOneTracker({ runtime, tracker });
  }
}

/**
 * A non-criticalPath failure is logged and swallowed; a criticalPath
 * failure (including a malformed entry) propagates out of `init()` so
 * the host learns about the misconfiguration instead of booting a
 * partial session record.
 */
function attachOneTracker({ runtime, tracker }: AttachOneTrackerArgs): void {
  const attach = getTrackerAttach(tracker);
  if (attach === null) {
    if (isCriticalTracker(tracker)) {
      throw new Error('Keewano.init: malformed critical tracker/plugin entry.');
    }
    console.error('Keewano.init: ignoring malformed tracker/plugin entry.');
    return;
  }
  try {
    const detach = attach.call(tracker);
    /**
     * `unshift` so detachAllTrackers (array order) tears down in
     * LIFO / reverse-attach order: a later plugin that captured a
     * built-in's wrapper as its "previous" reference cannot restore a
     * stale wrapper during shutdown.
     */
    runtime.detachFns.unshift(normalizeDetach({ value: detach, tracker }));
  } catch (err: unknown) {
    if (isCriticalTracker(tracker)) {
      throw err;
    }
    console.error(`Keewano.init: tracker "${safeTrackerName(tracker)}" attach failed.`, err);
  }
}

/**
 * Normalize a tracker's `attach()` return into a callable
 * `() => void`: a bare detach function, or a subscription object with
 * `.remove()`. A contract-violating return (not a function, no
 * callable `remove`) collapses to a no-op detach with one
 * `console.error` naming the tracker - the plugin's listeners will
 * outlive shutdown and that must be visible. The returned closure
 * swallows (and logs) a throwing detach so one broken plugin cannot
 * block the rest of teardown.
 */
function normalizeDetach({ value, tracker }: NormalizeDetachArgs): () => void {
  if (typeof value === 'function') {
    return () => {
      try {
        (value as () => void)();
      } catch (err: unknown) {
        console.error('Keewano.shutdown: tracker detach failed.', err);
      }
    };
  }
  if (value !== null && typeof value === 'object') {
    /**
     * `.remove` access can throw on a hostile Proxy; the throw would
     * propagate BEFORE a detach is pushed onto runtime.detachFns,
     * leaving the plugin's listeners installed with no removal path.
     */
    let remove: unknown;
    try {
      remove = (value as { remove?: unknown }).remove;
    } catch (err: unknown) {
      console.error(
        `Keewano.init: tracker "${safeTrackerName(tracker)}" detach handle was malformed.`,
        err,
      );
      return () => {};
    }
    if (typeof remove === 'function') {
      return () => {
        try {
          (remove as () => void).call(value);
        } catch (err: unknown) {
          console.error('Keewano.shutdown: tracker remove() failed.', err);
        }
      };
    }
  }
  console.error(
    `Keewano.init: tracker "${safeTrackerName(tracker)}" attach() returned an invalid detach; its listeners cannot be removed on shutdown.`,
  );
  return () => {};
}

/**
 * Pull a callable `attach` off `entry`; reading it directly could
 * throw on a Proxy / throwing-getter plugin.
 */
function getTrackerAttach(entry: unknown): (() => unknown) | null {
  try {
    if (entry == null) return null;
    if (typeof entry !== 'object' && typeof entry !== 'function') return null;
    const attach = (entry as { attach?: unknown }).attach;
    return typeof attach === 'function' ? (attach as () => unknown) : null;
  } catch {
    return null;
  }
}

/** `true` when `entry.criticalPath` strictly equals `true`; a throwing getter reads as `false`. */
function isCriticalTracker(entry: unknown): boolean {
  try {
    return (entry as { criticalPath?: unknown })?.criticalPath === true;
  } catch {
    return false;
  }
}

/** Best-effort read of `entry.name`; a throwing getter must not crash the console.error path. */
function safeTrackerName(entry: unknown): string {
  try {
    const name = (entry as { name?: unknown })?.name;
    return typeof name === 'string' && name.length > 0 ? name : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Run every queued detach once and clear the list. Snapshot-and-clear
 * up front so a re-entrant call cannot run a detach twice.
 */
function detachAllTrackers(runtime: WebSdkRuntime): void {
  const detachFns = runtime.detachFns.slice();
  runtime.detachFns.length = 0;
  for (const detach of detachFns) {
    try {
      detach();
    } catch {
      /** Best-effort tracker cleanup. */
    }
  }
}

export { attachEnvironmentTracker, attachTrackers, detachAllTrackers };
