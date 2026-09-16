/**
 * Exit-time persistence hook: the tab's last events (the final
 * WINDOW_CLOSE, APP_PAUSE, trailing clicks) otherwise die with the
 * page because the send loop never gets another tick. `pagehide` is
 * the primary trigger (`unload` is unreliable, especially on mobile);
 * `visibilitychange` to hidden is the secondary one - it fires
 * earlier and survives process kills that skip `pagehide` entirely.
 *
 * Both triggers funnel into one guarded flush. An in-flight latch
 * keeps them from running two flushes at once; a trigger that lands
 * while one is in flight queues exactly one follow-up instead of
 * being dropped, because in a real close both triggers fire in the
 * same synchronous unload sequence and the events the second one
 * emits would otherwise die in the buffer. That follow-up does swap
 * again - deliberately, since it has new events to carry - it just
 * cannot overlap the first. Only triggers queue it, so a flush can
 * never re-arm itself, and the flush callback skips when nothing
 * accumulated.
 *
 * The hook must be attached AFTER the built-in trackers: same-phase
 * listeners fire in registration order, which is what lets the
 * trackers' own teardown events reach the batch before the cut.
 * Completion is best-effort by design - nothing can await inside a
 * closing page.
 */
import type { AttachExitFlushArgs, ExitFlushWindowLike } from './types/exitFlush';

import { EVENT_TARGET_METHODS, probeGlobal } from '../probeGlobal';
import { noopDetach } from '../trackers/noopDetach';

function attachExitFlush(args: AttachExitFlushArgs): () => void {
  const win = args.win ?? probeGlobal<ExitFlushWindowLike>({ methods: EVENT_TARGET_METHODS });
  if (win === null) return noopDetach;

  let inFlight = false;
  let pendingRerun = false;
  const runFlush = (): void => {
    if (inFlight) {
      pendingRerun = true;
      return;
    }
    inFlight = true;
    /**
     * The latch is already raised, so a flush that fails before it
     * returns a promise must still reach the handlers that lower it -
     * otherwise every later trigger returns early and this tab loses
     * exit-time persistence for the rest of its life. The async frame
     * turns that failure into a rejection, and it also keeps the throw
     * out of the host page, since this runs from a raw listener.
     */
    (async () => args.flush())()
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        if (pendingRerun) {
          pendingRerun = false;
          runFlush();
        }
      });
  };
  const onVisibilityChange = (): void => {
    if (win.document?.visibilityState === 'hidden') runFlush();
  };

  win.addEventListener('pagehide', runFlush);
  win.document?.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    /** A queued follow-up must not outlive the hook: after detach the shutdown flush owns the tail of the session. */
    pendingRerun = false;
    try {
      win.removeEventListener('pagehide', runFlush);
      win.document?.removeEventListener('visibilitychange', onVisibilityChange);
    } catch {
      /** Best-effort cleanup. */
    }
  };
}

export { attachExitFlush };
