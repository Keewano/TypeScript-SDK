/**
 * AppState auto-tracker. Subscribes to RN's `AppState` change events
 * and emits:
 *
 *   - APP_PAUSE  when the host goes background / inactive. The send
 *     loop is woken right after the emit so any accumulated events
 *     get one more chance to ship before the OS suspends the process.
 *   - APP_RESUME when the host returns to active.
 *
 * Repeated transitions into the same logical state are coalesced: a
 * sequence of `inactive -> background` (iOS multitasking quirks)
 * emits exactly ONE APP_PAUSE, not two, because the tracker tracks
 * the last emitted phase and skips no-op transitions.
 */

import type { KeewanoTracker } from '../types/config';
import type { AppStateTrackerArgs } from './types/AppStateTracker';
import type { AppStateSubscription } from './types/rn';

import { KEvents } from '@keewano/core';

import { defaultLoadRn } from './loadRn';
import { noopDetach } from './noopDetach';
import { stampNowOnDispatcher } from './stampNow';

/**
 * Logical lifecycle phase derived from RN's AppState string. The
 * tracker emits APP_PAUSE when entering `'paused'` and APP_RESUME
 * when entering `'active'`. The starting phase is `'unknown'` so the
 * first observed change emits unconditionally (we never start with a
 * matching prior phase).
 */
type Phase = 'unknown' | 'active' | 'paused';

class AppStateTracker implements KeewanoTracker {
  readonly name = 'AppStateTracker';

  private readonly args: AppStateTrackerArgs;

  constructor(args: AppStateTrackerArgs) {
    this.args = args;
  }

  /**
   * Subscribe to RN AppState changes. Returns a no-op detach when
   * AppState is unavailable (Node test runner, broken shim).
   */
  attach(): () => void {
    const load = this.args.loadRn ?? defaultLoadRn;
    /** A throwing custom `loadRn` must degrade rather than crash SDK boot. */
    let rn: ReturnType<typeof load>;
    try {
      rn = load();
    } catch {
      return noopDetach;
    }
    const appState = rn?.AppState;
    if (appState == null || typeof appState.addEventListener !== 'function') return noopDetach;

    let lastPhase: Phase = 'unknown';
    const now = this.args.now ?? defaultNow;
    const signalSend = this.args.signalSend ?? (() => this.args.dispatcher.signalSend());

    /**
     * RN's AppState typed contract is `{ remove() }`, but legacy
     * adapters / custom shims may instead return a bare unsubscribe
     * function. Accept both shapes so cleanup tears the listener down
     * for either - calling `.remove()` on a function would silently
     * leak it across shutdown / re-init and double-emit
     * APP_PAUSE / APP_RESUME after tracker re-attachment.
     */
    type AppStateUnsubscribe = (() => void) | AppStateSubscription;
    let subscription: AppStateUnsubscribe;
    try {
      const result = appState.addEventListener('change', (state: string) => {
        const nextPhase = classify(state);
        if (nextPhase === lastPhase || nextPhase === 'unknown') return;
        try {
          stampNowOnDispatcher(this.args.dispatcher);
          if (nextPhase === 'paused') {
            this.args.dispatcher.addEventDateTime({
              eventId: KEvents.APP_PAUSE,
              date: now(),
            });
            /**
             * Advance `lastPhase` only after the emit succeeded so a
             * thrown `addEventDateTime` does not permanently suppress
             * future same-phase transitions: the coalescing gate must
             * mirror what was actually written, not what was attempted.
             */
            lastPhase = nextPhase;
            try {
              signalSend();
            } catch {
              /** A throw from the signal hook must not block the emit-only path. */
            }
          } else {
            this.args.dispatcher.addEventDateTime({
              eventId: KEvents.APP_RESUME,
              date: now(),
            });
            lastPhase = nextPhase;
          }
        } catch {
          /** A throw from the dispatcher must not crash the AppState callback. */
        }
      });
      subscription = result;
    } catch {
      /** Subscribe itself threw - the shim is unusable, degrade to no-op. */
      return noopDetach;
    }

    return () => {
      try {
        /** Const-capture so TypeScript narrows the union inside the closure. */
        const sub = subscription;
        if (typeof sub === 'function') {
          sub();
        } else if (typeof sub?.remove === 'function') {
          /**
           * Guard `sub.remove` existence: the cast widens the typed
           * return so a non-conformant shim could hand us any other
           * object. A plain `sub.remove()` on a missing field would
           * throw and skip later cleanup steps.
           */
          sub.remove();
        }
      } catch {
        /** Best-effort tracker cleanup. */
      }
    };
  }
}

/**
 * Map an RN AppState string to a tracker phase. `'background'` and
 * `'inactive'` both collapse to `'paused'` because the wire payload
 * does not distinguish them. Any unknown state (`'extension'` on iOS,
 * custom RN forks) maps to `'unknown'` and is ignored.
 */
function classify(state: string): Phase {
  if (state === 'active') return 'active';
  if (state === 'background' || state === 'inactive') return 'paused';
  return 'unknown';
}

/** Default clock; replaced in tests via `args.now`. */
function defaultNow(): Date {
  return new Date();
}

export type { AppStateTrackerArgs } from './types/AppStateTracker';
export { AppStateTracker };
