/**
 * Tracker lifecycle pipeline for the public facade: build the built-in
 * tracker set from the `disable*` config flags, append host plugins,
 * attach each defensively, and tear them all down on shutdown. Split
 * out of `keewano.ts` so the facade file keeps to boot / teardown
 * orchestration while this module owns the (security-sensitive)
 * plugin-attach plumbing.
 *
 * Every entry point is hostile-input-hardened: `config.plugins` and
 * each plugin's `attach()` / detach handle can come from untyped JS,
 * so reads and calls are wrapped so one malformed plugin cannot crash
 * `init()` or leak listeners across a failed boot.
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
 * Attach the InitialEventsTracker before anything else can emit. The
 * tracker's `attach()` is intentionally synchronous: it writes the
 * canonical APP_LAUNCH / PLATFORM / OS / DEVICE_TYPE / RAM_SIZE /
 * SCREEN_RESOLUTION / SYSTEM_LANG burst into the in-batch buffer
 * during this call, BEFORE `drainPreInitQueue` replays the host's
 * pre-init reports and BEFORE the runtime trackers install their
 * listeners. The fixed order keeps the wire stream identifiable
 * across sessions: every session starts with the same 7-event
 * environment frame.
 *
 * `criticalPath: true` on the tracker means an attach failure rejects
 * `init()` instead of silently booting without the burst -
 * `attachOneTracker` rethrows when the failed tracker is critical.
 */
function attachInitialEventsTracker(runtime: SdkRuntime): void {
  const tracker = new InitialEventsTracker({
    dispatcher: runtime.dispatcher,
    platform: runtime.platform,
  });
  attachOneTracker(runtime, tracker);
}

/**
 * Build the runtime tracker set per the `disable*` flags on `config`,
 * append the host-supplied `plugins`, and attach every entry. Each
 * successful `attach()` pushes its detach onto `runtime.detachFns` so
 * `shutdown()` can tear them down.
 *
 * The InitialEventsTracker is attached separately by
 * `attachInitialEventsTracker` BEFORE this function runs (and before
 * the pre-init queue drains) so the canonical burst always leads the
 * wire stream and the host's pre-init reports drain ahead of any
 * plugin sync-emit on attach. A single failing `attach()` is logged
 * but does NOT block the rest of the pipeline.
 */
function attachTrackers(runtime: SdkRuntime, config: KeewanoConfig): void {
  const builtIns: KeewanoTracker[] = [];
  if (config.disableButtonTracking !== true) {
    builtIns.push(new PressableTracker({ dispatcher: runtime.dispatcher }));
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
  /**
   * Network tracking is opt-IN, not opt-out like the trackers above.
   * It is the only built-in that needs an optional native peer
   * (`@react-native-community/netinfo`); auto-attaching it would make
   * the SDK probe for a module the host never installed, which fails
   * loudly on bare runtimes (Metro reports the missing module). The
   * host enables it deliberately once the peer is in place.
   */
  if (config.enableNetworkTracking === true) {
    builtIns.push(new NetworkTracker({ dispatcher: runtime.dispatcher }));
  }
  /**
   * Snapshot `config.plugins` exactly once through a try/catch: a
   * hostile Proxy / revoked Proxy / throwing getter on `config` would
   * otherwise crash `attachTrackers` BEFORE any built-in attaches.
   * Reading twice (once for the type check, once for the iteration)
   * doubled that risk - one safe snapshot serves both.
   */
  let plugins: readonly KeewanoTracker[] = [];
  try {
    const rawPlugins = config.plugins;
    if (rawPlugins == null) {
      plugins = [];
    } else if (Array.isArray(rawPlugins)) {
      /**
       * Shallow-copy: a plugin's `attach()` could mutate the original
       * `config.plugins` array (push, splice, reassign elements). A
       * live reference would then skip later plugins, double-attach
       * existing ones, or inject new entries mid-init. The snapshot
       * frozes the attach-order at init time.
       */
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
  /**
   * Iterate plugins index-by-index instead of spreading. A custom
   * `Array`-like with a throwing iterator / element getter would
   * otherwise crash the whole pipeline AFTER builtIns have attached,
   * leaking their detach pointers across a failed init. `length`
   * itself is read defensively too: `Array.isArray` only checks the
   * internal `[[Class]]` tag, so a Proxy passing the check can still
   * throw from its `length` getter.
   */
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
 * Validate the supplied entry, run its `attach()`, and route the
 * returned detach onto `runtime.detachFns`. Extracted from
 * `attachTrackers` so each function stays under the cognitive
 * complexity cap and so plugin-validation lives in one place.
 *
 * `config.plugins` can come from plain JS without compile-time type
 * checks; a `null` / malformed entry must not crash `attachTrackers`.
 * A non-criticalPath attach failure is logged and swallowed; a
 * criticalPath failure propagates out of `init()` so the host learns
 * about the misconfiguration.
 */
function attachOneTracker(runtime: SdkRuntime, tracker: unknown): void {
  const attach = getTrackerAttach(tracker);
  if (attach === null) {
    /**
     * A plugin marked `criticalPath: true` must NOT be silently
     * skipped: by contract, the host depends on it for the session
     * to be valid (currently only InitialEventsTracker uses this).
     * Throw so the host learns about the misconfiguration instead of
     * booting into a partial session record.
     */
    if (isCriticalTracker(tracker)) {
      throw new Error('Keewano.init: malformed critical tracker/plugin entry.');
    }
    console.error('Keewano.init: ignoring malformed tracker/plugin entry.');
    return;
  }
  try {
    const detach = attach.call(tracker);
    /**
     * A plugin that violates the `() => () => void` contract at
     * runtime (returns `undefined`, a Promise, etc.) would otherwise
     * crash teardown. Normalize to a no-op so `runtime.detachFns`
     * is always callable end-to-end.
     *
     * Many RN listener APIs (AppState, BackHandler, NetInfo) return
     * subscription objects with `.remove()` instead of a bare function.
     * Plugin authors who mirror that pattern should not silently leak
     * their listeners across shutdown - wrap a `.remove()` call so it
     * still tears down.
     *
     * `unshift` so detachAllTrackers (which iterates in array order)
     * tears down in LIFO / reverse-attach order: a later plugin that
     * captured a built-in's wrapper as its "previous" reference cannot
     * restore a stale wrapper during shutdown, since the built-in's
     * detach runs after the plugin's.
     */
    runtime.detachFns.unshift(normalizeDetach(detach));
  } catch (err: unknown) {
    if (isCriticalTracker(tracker)) {
      throw err;
    }
    console.error(`Keewano.init: tracker "${safeTrackerName(tracker)}" attach failed.`, err);
  }
}

/**
 * Normalize a tracker's `attach()` return value into a callable
 * `() => void`. Accepts a bare detach function or an RN-style
 * subscription object exposing `.remove()`; anything else collapses
 * to a no-op so `runtime.detachFns` stays callable end-to-end. The
 * returned closure swallows a throwing detach at the boundary so one
 * broken plugin cannot block the rest of teardown.
 */
function normalizeDetach(value: unknown): () => void {
  if (typeof value === 'function') {
    /**
     * Wrap the call so a throwing detach is logged AT THE BOUNDARY
     * instead of relying on detachAllTrackers' outer catch to swallow
     * it silently. The throw still gets contained either way, but
     * surfacing it via console.error makes a broken plugin debuggable.
     */
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
     * `.remove` access can throw on a hostile Proxy. Without this
     * guard the throw would propagate out of `attachOneTracker` BEFORE
     * a detach is pushed onto runtime.detachFns - leaving the plugin's
     * listeners installed with no path to remove them later (a real
     * leak past shutdown). Catching here returns a no-op so cleanup
     * stays callable end-to-end.
     */
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
  return () => {};
}

/**
 * Pull a callable `attach` off `entry` defensively. A JS-only plugin
 * can be a Proxy / object-with-throwing-getter; reading `entry.attach`
 * directly could throw and propagate out of attachTrackers. The
 * try/catch keeps the validation step itself safe.
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

/**
 * `true` when `entry.criticalPath` strictly equals `true`. Wrapped in
 * try/catch because the getter on a hostile plugin could throw and
 * would otherwise surface from the catch handler that is meant to
 * isolate plugin failures.
 */
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
 * Run every queued detach once and clear the list. Each detach is
 * wrapped so one throwing teardown cannot block the rest; the list is
 * snapshotted-and-cleared up front so a re-entrant call cannot run a
 * detach twice across a single shutdown.
 */
function detachAllTrackers(runtime: SdkRuntime): void {
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

export { attachInitialEventsTracker, attachTrackers, detachAllTrackers };
