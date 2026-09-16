/**
 * Navigation tracker: WINDOW_OPEN / WINDOW_CLOSE for classic pages and
 * SPAs. The initial page opens on attach; route changes close the
 * previous window and open the next one; the final close fires on
 * `pagehide` so the pairing invariant holds for the whole page life:
 * every OPEN has exactly one CLOSE before the next OPEN.
 *
 * SPA routing is observed by patching `history.pushState` /
 * `replaceState` (originals kept and restored on detach) plus the
 * `popstate` and `hashchange` events. Every signal funnels into one
 * name comparison: a change only emits when the RESOLVED name
 * differs, so `replaceState` to the same path and hash-only changes
 * under the default resolver (which ignores the hash) emit nothing.
 *
 * The window name is `location.pathname` by default; hosts with
 * dynamic segments override it via `resolveWindowName` in init
 * config. A throwing resolver falls back to the pathname rather than
 * breaking navigation.
 *
 * One live instance per page: the history patch belongs to the first
 * attach (the patched flag is deliberately cross-bundle via
 * `Symbol.for`). A second concurrent instance would see only
 * popstate / hashchange, not pushState - the lifecycle pipeline never
 * creates two, and plugin authors should not either.
 */
import type { KeewanoTracker } from '../types/config';
import type {
  HistoryLike,
  NavigationTrackerArgs,
  NavigationWindowLike,
  WindowLocationLike,
} from './types/navigation';

import { reportWindowClose, reportWindowOpen } from '@keewano/core';

import { EVENT_TARGET_METHODS, probeGlobal } from '../probeGlobal';
import { noopDetach } from './noopDetach';

/** Marks a history object whose methods this tracker already patched (double-init guard). */
const HISTORY_PATCHED = Symbol.for('keewano.navigation.patched');

function defaultResolveWindowName(location: WindowLocationLike): string {
  return location.pathname;
}

class NavigationTracker implements KeewanoTracker {
  readonly name = 'NavigationTracker';

  private readonly args: NavigationTrackerArgs;
  /** Name of the currently-open window; `null` when none is open (pre-attach / after final close). */
  private currentName: string | null = null;

  constructor(args: NavigationTrackerArgs = {}) {
    this.args = args;
  }

  attach(): () => void {
    const win =
      this.args.win ??
      probeGlobal<NavigationWindowLike>({
        methods: EVENT_TARGET_METHODS,
        accept: (candidate) => candidate.history !== undefined && candidate.location !== undefined,
      });
    if (win === null) return noopDetach;
    const report = this.args.report ?? {
      open: reportWindowOpen,
      close: reportWindowClose,
    };
    const resolve = this.makeSafeResolver(win);

    /**
     * Kill switch for the patch closures. When a later tool re-wraps
     * history over our patch, detach cannot uninstall it - the stale
     * wrapper must then become an inert pass-through instead of
     * emitting into a torn-down SDK (a post-shutdown emit would throw
     * out of the host's own `pushState` call).
     */
    let detached = false;

    const handleChange = (): void => {
      if (detached) return;
      const next = resolve();
      if (next === this.currentName) return;
      /**
       * These calls run inside the host's own pushState / popstate
       * frames: a throw must never escape into the page (the same
       * containment every other tracker applies). `currentName`
       * advances only after a successful emit so the pairing gate
       * mirrors what actually reached the dispatcher.
       */
      try {
        if (this.currentName !== null) report.close(this.currentName);
        report.open(next);
        this.currentName = next;
      } catch {
        /** Tracking must never break the host's navigation. */
      }
    };
    const handlePageHide = (): void => {
      if (detached) return;
      if (this.currentName === null) return;
      try {
        report.close(this.currentName);
        this.currentName = null;
      } catch {
        /** Tracking must never break page teardown. */
      }
    };
    /**
     * bfcache resurrection: the page comes back alive after the
     * `pagehide` close, so the session would otherwise run windowless
     * (unattributed clicks / errors) until the next route change.
     */
    const handlePageShow = (): void => {
      if (detached) return;
      if (this.currentName === null) handleChange();
    };

    /** Initial page. */
    handleChange();

    const history = win.history;
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    /**
     * Patch only when the methods are not already ours: if a stale
     * patch survived (double init without detach), re-wrapping would
     * stack emitters and double-report every route change.
     */
    const alreadyPatched = (history as { [HISTORY_PATCHED]?: boolean })[HISTORY_PATCHED] === true;
    /**
     * Wrapper references kept for the identity comparison in detach.
     * Identity survives minification; a `Function.name` check would
     * not (the shipped IIFE strips function names), and a broken
     * restore guard leaves the patch installed forever.
     */
    let patchedPush: HistoryLike['pushState'] | null = null;
    let patchedReplace: HistoryLike['replaceState'] | null = null;
    if (!alreadyPatched) {
      /**
       * Call the original FIRST so `location` reflects the new entry
       * when the resolver reads it inside `handleChange`.
       */
      patchedPush = function patchedPushState(...pushArgs: unknown[]): unknown {
        const result = originalPush.apply(history, pushArgs);
        handleChange();
        return result;
      };
      patchedReplace = function patchedReplaceState(...replaceArgs: unknown[]): unknown {
        const result = originalReplace.apply(history, replaceArgs);
        handleChange();
        return result;
      };
      history.pushState = patchedPush;
      history.replaceState = patchedReplace;
      (history as { [HISTORY_PATCHED]?: boolean })[HISTORY_PATCHED] = true;
    }

    win.addEventListener('popstate', handleChange);
    win.addEventListener('hashchange', handleChange);
    win.addEventListener('pagehide', handlePageHide);
    win.addEventListener('pageshow', handlePageShow);

    return () => {
      try {
        detached = true;
        win.removeEventListener('popstate', handleChange);
        win.removeEventListener('hashchange', handleChange);
        win.removeEventListener('pagehide', handlePageHide);
        win.removeEventListener('pageshow', handlePageShow);
        if (!alreadyPatched) {
          /**
           * Restore only when the current methods are still OUR
           * wrappers (identity check): a later patcher would be
           * silently uninstalled by a blind restore. When restore is
           * declined, the patched flag stays set - a re-init must NOT
           * stack a second live patch on top of the stale one.
           */
          const pushIsOurs = history.pushState === patchedPush;
          const replaceIsOurs = history.replaceState === patchedReplace;
          if (pushIsOurs) history.pushState = originalPush;
          if (replaceIsOurs) history.replaceState = originalReplace;
          if (pushIsOurs && replaceIsOurs) {
            (history as { [HISTORY_PATCHED]?: boolean })[HISTORY_PATCHED] = false;
          }
        }
        /**
         * Close the open window so the OPEN / CLOSE pairing survives
         * teardown; shutdown detaches trackers BEFORE the final flush
         * so this event still ships.
         */
        if (this.currentName !== null) {
          report.close(this.currentName);
          this.currentName = null;
        }
      } catch {
        /** Best-effort tracker cleanup. */
      }
    };
  }

  /** Resolver wrapper: a throwing host resolver degrades to the pathname default. */
  private makeSafeResolver(win: NavigationWindowLike): () => string {
    const custom = this.args.resolveWindowName;
    return () => {
      const location = win.location;
      if (custom !== undefined) {
        try {
          const name = custom(location);
          if (typeof name === 'string' && name.length > 0) return name;
        } catch {
          /* Fall through to the default below. */
        }
      }
      return defaultResolveWindowName(location);
    };
  }
}

export type { NavigationTrackerArgs, ResolveWindowName } from './types/navigation';
export { NavigationTracker };
