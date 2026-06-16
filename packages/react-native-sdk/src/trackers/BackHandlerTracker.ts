/**
 * Android hardware-back auto-tracker. Subscribes to RN's
 * `BackHandler` and emits BUTTON_CLICK("Android Device Back Button")
 * per press. The subscription returns `false` so the default back
 * navigation still runs - the tracker is observe-only.
 *
 * No-op on iOS / web: the platform check inside `attach()` returns
 * a no-op detach when `Platform.OS !== 'android'`, so the SDK boot
 * does not crash on the wrong host.
 */

import type { KeewanoTracker } from '../types/config';
import type { BackHandlerTrackerArgs } from './types/BackHandlerTracker';
import type { BackHandlerSubscription } from './types/rn';

import { KEvents } from '@keewano/core';

import { defaultLoadRn } from './loadRn';
import { noopDetach } from './noopDetach';
import { stampNowOnDispatcher } from './stampNow';

/** Exact payload string emitted on every Android back-press. */
const BACK_BUTTON_NAME = 'Android Device Back Button';

class BackHandlerTracker implements KeewanoTracker {
  readonly name = 'BackHandlerTracker';

  private readonly args: BackHandlerTrackerArgs;

  constructor(args: BackHandlerTrackerArgs) {
    this.args = args;
  }

  /**
   * Subscribe to hardware-back events when running on Android.
   * Returns a no-op detach on iOS / web or when the BackHandler
   * module is absent.
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
    /** `== null` so a custom `loadRn` returning `null` degrades the same as `undefined`. */
    if (rn == null) return noopDetach;
    if (rn.Platform?.OS !== 'android') return noopDetach;
    if (rn.BackHandler == null || typeof rn.BackHandler.addEventListener !== 'function') {
      return noopDetach;
    }

    /**
     * RN's BackHandler typed contract is `{ remove() }`, but legacy
     * adapters / custom shims may instead return a bare unsubscribe
     * function. Accept both shapes so cleanup tears the listener down
     * for either - calling `.remove()` on a function would silently
     * leak it across shutdown / re-init and double-emit BUTTON_CLICK.
     */
    type BackHandlerUnsubscribe = (() => void) | BackHandlerSubscription;
    let subscription: BackHandlerUnsubscribe;
    try {
      const result = rn.BackHandler.addEventListener('hardwareBackPress', () => {
        try {
          stampNowOnDispatcher(this.args.dispatcher);
          this.args.dispatcher.addEventString({
            eventId: KEvents.BUTTON_CLICK,
            str: BACK_BUTTON_NAME,
          });
        } catch {
          /** A throw from the dispatcher must not block the back-press chain. */
        }
        /**
         * Return `false` so the default back-button handler still
         * runs. Returning `true` would consume the press and break
         * the host's navigation - the tracker is observe-only.
         */
        return false;
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

export type { BackHandlerTrackerArgs } from './types/BackHandlerTracker';
export { BackHandlerTracker };
