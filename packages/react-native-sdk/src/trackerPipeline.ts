/**
 * Tracker lifecycle: build built-ins from the `disable*` flags, append
 * host plugins, attach each, and tear them down on shutdown. Every
 * entry point is hostile-input-hardened - `config.plugins` and each
 * plugin's `attach()`/detach handle come from untyped JS, so one
 * malformed plugin must not crash `init()` or leak listeners.
 */

import type { KeewanoConfig, KeewanoTracker } from './types/config';
import type { SdkRuntime } from './types/runtime';

import {
  AppStateTracker,
  BackHandlerTracker,
  ErrorTracker,
  InitialEventsTracker,
  LinkingTracker,
  NetworkTracker,
  PressableTracker,
} from './trackers';

/**
 * Attach the InitialEventsTracker first. Its `attach()` is synchronous:
 * it writes the canonical 7-event environment burst into the in-batch
 * before pre-init reports drain and before runtime trackers install, so
 * every session's wire stream starts with the same frame. `criticalPath`
 * makes an attach failure reject `init()` rather than boot without it.
 */
function attachInitialEventsTracker(runtime: SdkRuntime): void {
  const tracker = new InitialEventsTracker({
    dispatcher: runtime.dispatcher,
    platform: runtime.platform,
  });
  attachOneTracker(runtime, tracker);
}

/**
 * Build the runtime tracker set per the `disable*` flags, append host
 * `plugins`, and attach every entry (each detach lands on
 * `runtime.detachFns`). A single failing `attach()` is logged, not
 * fatal. The InitialEventsTracker is attached earlier, separately.
 */
function attachTrackers(runtime: SdkRuntime, config: KeewanoConfig): void {
  const builtIns: KeewanoTracker[] = [];
  if (config.disableButtonTracking !== true) {
    // No dispatcher is handed over: its wrappers stay in the element trees of already-mounted
    // screens after this runtime is torn down, so they resolve the live one per press instead.
    builtIns.push(new PressableTracker());
  }
  if (config.disableAppStateTracking !== true) {
    builtIns.push(new AppStateTracker({ dispatcher: runtime.dispatcher }));
  }
  if (config.disableBackHandlerTracking !== true) {
    builtIns.push(new BackHandlerTracker({ dispatcher: runtime.dispatcher }));
  }
  if (config.disableLinkingTracking !== true) {
    builtIns.push(new LinkingTracker({ dispatcher: runtime.dispatcher }));
  }
  if (config.disableErrorTracking !== true) {
    builtIns.push(new ErrorTracker({ dispatcher: runtime.dispatcher }));
  }
  // Opt-IN (not opt-out): the only built-in needing an optional native peer (netinfo);
  // auto-attaching would probe a module the host never installed and fail loudly on bare RN.
  if (config.enableNetworkTracking === true) {
    builtIns.push(new NetworkTracker({ dispatcher: runtime.dispatcher }));
  }
  // Read config.plugins once through a try/catch: a hostile/throwing getter must not crash
  // attachTrackers before any built-in attaches.
  let plugins: readonly KeewanoTracker[] = [];
  try {
    const rawPlugins = config.plugins;
    if (rawPlugins == null) {
      plugins = [];
    } else if (Array.isArray(rawPlugins)) {
      // Shallow-copy to freeze attach order: a plugin's attach() could mutate the source array
      // and skip/double-attach/inject entries mid-init.
      plugins = rawPlugins.slice();
    } else {
      console.error('Keewano.init: ignoring malformed `plugins`; expected an array.');
    }
  } catch (err: unknown) {
    console.error('Keewano.init: ignoring malformed `plugins`; failed to read config.', err);
  }
  for (const tracker of builtIns) {
    attachOneTracker(runtime, tracker);
  }
  // Index-by-index (not spread), with length read defensively: a Proxy passing Array.isArray can
  // still throw from its iterator/element/length getter and leak the built-ins' detach pointers.
  let pluginCount: number;
  try {
    pluginCount = plugins.length;
  } catch (err: unknown) {
    console.error('Keewano.init: ignoring malformed `plugins`; failed to read array length.', err);
    return;
  }
  for (let i = 0; i < pluginCount; i += 1) {
    let tracker: unknown;
    try {
      tracker = plugins[i];
    } catch (err: unknown) {
      console.error(`Keewano.init: ignoring malformed plugin at index ${String(i)}.`, err);
      continue;
    }
    attachOneTracker(runtime, tracker);
  }
}

/**
 * Validate the entry, run its `attach()`, route the detach onto
 * `runtime.detachFns`. A malformed entry must not crash the pipeline;
 * a non-critical attach failure is logged, a `criticalPath` failure
 * propagates out of `init()`.
 */
function attachOneTracker(runtime: SdkRuntime, tracker: unknown): void {
  const attach = getTrackerAttach(tracker);
  if (attach === null) {
    // A criticalPath entry must not be silently skipped - the host depends on it for a valid
    // session, so throw rather than boot into a partial record.
    if (isCriticalTracker(tracker)) {
      throw new Error('Keewano.init: malformed critical tracker/plugin entry.');
    }
    console.error('Keewano.init: ignoring malformed tracker/plugin entry.');
    return;
  }
  try {
    const detach = attach.call(tracker);
    // unshift so teardown runs LIFO (reverse-attach): a later plugin that captured a built-in's
    // wrapper cannot restore a stale one, since the built-in's detach runs after it.
    runtime.detachFns.unshift(normalizeDetach(detach));
  } catch (err: unknown) {
    if (isCriticalTracker(tracker)) {
      throw err;
    }
    console.error(`Keewano.init: tracker "${safeTrackerName(tracker)}" attach failed.`, err);
  }
}

/**
 * Normalize `attach()`'s return into a callable `() => void`: a bare
 * detach function or an RN-style `.remove()` subscription; anything
 * else becomes a no-op. The closure swallows a throwing detach so one
 * broken plugin cannot block the rest of teardown.
 */
function normalizeDetach(value: unknown): () => void {
  if (typeof value === 'function') {
    // Log a throwing detach at the boundary (not just the outer catch) so a broken plugin is debuggable.
    return () => {
      try {
        (value as () => void)();
      } catch (err: unknown) {
        console.error('Keewano.shutdown: tracker detach failed.', err);
      }
    };
  }
  if (value !== null && typeof value === 'object') {
    // A hostile .remove getter that throws here would escape before a detach is registered,
    // leaking the plugin's listeners past shutdown; catch and no-op instead.
    let remove: unknown;
    try {
      remove = (value as { remove?: unknown }).remove;
    } catch (err: unknown) {
      console.error('Keewano.init: tracker detach handle was malformed.', err);
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
    'Keewano.init: tracker attach() returned an invalid detach; its listeners cannot be removed on shutdown.',
  );
  return () => {};
}

/** Pull a callable `attach` off `entry`, defended against a throwing getter on a hostile plugin. */
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

/** `true` when `entry.criticalPath === true`, defended against a throwing getter. */
function isCriticalTracker(entry: unknown): boolean {
  try {
    return (entry as { criticalPath?: unknown })?.criticalPath === true;
  } catch {
    return false;
  }
}

/**
 * Best-effort read of `entry.name`; falls back to `'unknown'` so a
 * throwing-getter plugin cannot crash the console.error path.
 */
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
function detachAllTrackers(runtime: SdkRuntime): void {
  const detachFns = runtime.detachFns.slice();
  runtime.detachFns.length = 0;
  for (const detach of detachFns) {
    try {
      detach();
    } catch {
      // Best-effort.
    }
  }
}

export { attachInitialEventsTracker, attachTrackers, detachAllTrackers };
