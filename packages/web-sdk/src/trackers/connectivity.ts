/**
 * Connectivity tracker: browser `online` / `offline` events become
 * INTERNET_CONNECTED / INTERNET_DISCONNECTED. Coming back online also
 * wakes the send loop so the offline backlog ships immediately
 * instead of waiting out the idle timer.
 *
 * Baseline follows the canonical reachability state machine shared
 * with the other platforms: the tracked state starts at "offline",
 * so a boot while ONLINE emits one INTERNET_CONNECTED (the first
 * observed reachability), while a boot offline emits nothing until
 * connectivity actually appears. Duplicate browser events for the
 * same state are coalesced.
 */
import type { KeewanoTracker } from '../types/config';
import type { ConnectivityTrackerArgs, ConnectivityWindowLike } from './types/connectivity';

import { KEvents } from '@keewano/core';

import { EVENT_TARGET_METHODS, probeGlobal } from '../probeGlobal';
import { noopDetach } from './noopDetach';
import { stampNowOnDispatcher } from './stampNow';

type LinkState = 'online' | 'offline';

class ConnectivityTracker implements KeewanoTracker {
  readonly name = 'ConnectivityTracker';

  private readonly args: ConnectivityTrackerArgs;

  constructor(args: ConnectivityTrackerArgs) {
    this.args = args;
  }

  attach(): () => void {
    const win =
      this.args.win ?? probeGlobal<ConnectivityWindowLike>({ methods: EVENT_TARGET_METHODS });
    if (win === null) return noopDetach;
    const signalSend = this.args.signalSend ?? ((): void => this.args.dispatcher.signalSend());

    /** Canonical initial state: offline, so the first observed online is a real transition. */
    let lastState: LinkState = 'offline';

    /** @returns `true` when a transition was actually written to the dispatcher. */
    const emit = (state: LinkState): boolean => {
      if (state === lastState) return false;
      try {
        stampNowOnDispatcher(this.args.dispatcher);
        this.args.dispatcher.addEvent(
          state === 'online' ? KEvents.INTERNET_CONNECTED : KEvents.INTERNET_DISCONNECTED,
        );
        lastState = state;
        return true;
      } catch {
        /** A throw from the dispatcher must not crash the connectivity callback. */
        return false;
      }
    };

    /**
     * Baseline: a boot while ONLINE transitions offline -> online and
     * emits INTERNET_CONNECTED; a boot offline matches the initial
     * state and stays silent. An unreadable `navigator` emits nothing
     * - the first real browser event still transitions correctly.
     */
    try {
      if (win.navigator?.onLine !== false && win.navigator?.onLine !== undefined) emit('online');
    } catch {
      /* No baseline signal; the listeners still cover transitions. */
    }

    /**
     * The RECONNECT wakes the send loop so the offline backlog ships
     * immediately; the boot baseline deliberately does not - there is
     * no backlog at init and the loop has its own startup pass.
     */
    const onOnline = (): void => {
      if (emit('online')) {
        try {
          signalSend();
        } catch {
          /** A throw from the wake hook must not block the emit-only path. */
        }
      }
    };
    const onOffline = (): void => {
      emit('offline');
    };
    win.addEventListener('online', onOnline);
    win.addEventListener('offline', onOffline);
    return () => {
      try {
        win.removeEventListener('online', onOnline);
        win.removeEventListener('offline', onOffline);
      } catch {
        /** Best-effort tracker cleanup. */
      }
    };
  }
}

export type { ConnectivityTrackerArgs } from './types/connectivity';
export { ConnectivityTracker };
