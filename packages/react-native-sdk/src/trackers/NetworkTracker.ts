/**
 * Connectivity auto-tracker. Subscribes to
 * `@react-native-community/netinfo` (when installed) and emits:
 *
 *   - INTERNET_CONNECTED    when `state.isConnected` flips to `true`.
 *   - INTERNET_DISCONNECTED when it flips to `false`.
 *
 * The tracker degrades gracefully to a no-op when NetInfo is not
 * installed - it is an optional peer dependency. Whether the host
 * sees an initial baseline event depends on the underlying NetInfo
 * implementation: `@react-native-community/netinfo` >= 6 fires the
 * listener once on subscribe with the current state, in which case
 * a boot-offline launch emits one `INTERNET_DISCONNECTED` baseline;
 * older NetInfo builds and custom mocks may not. The tracker does
 * not call `NetInfo.fetch()` itself - it would require widening the
 * minimal `NetInfoLike` contract and most realistic NetInfo builds
 * already deliver the baseline through `addEventListener`.
 *
 * `isConnected === null` (the "unknown" RN state) is treated as a
 * no-op so the tracker does not emit a misleading
 * `INTERNET_DISCONNECTED` for the brief window before the OS reports
 * a real value.
 */

import type { KeewanoTracker } from '../types/config';
import type { NetInfoState, NetworkTrackerArgs } from './types/NetworkTracker';

import { KEvents } from '@keewano/core';

import { defaultLoadNetInfo } from './loadNetInfo';
import { noopDetach } from './noopDetach';
import { stampNowOnDispatcher } from './stampNow';

class NetworkTracker implements KeewanoTracker {
  readonly name = 'NetworkTracker';

  private readonly args: NetworkTrackerArgs;

  constructor(args: NetworkTrackerArgs) {
    this.args = args;
  }

  /**
   * Subscribe to NetInfo connectivity transitions. Returns a no-op
   * detach when NetInfo is absent or its `addEventListener` is not
   * a function (broken shim).
   */
  attach(): () => void {
    const load = this.args.loadNetInfo ?? defaultLoadNetInfo;
    /**
     * A custom `loadNetInfo` shim could throw at resolve time
     * (require() failure, lazy peer with side-effecting init). Treat
     * a throwing loader the same as a missing peer.
     */
    let netInfo: ReturnType<typeof load>;
    try {
      netInfo = load();
    } catch {
      return noopDetach;
    }
    /**
     * Reject anything that does not expose a callable `addEventListener`.
     * `defaultLoadNetInfo` already filters for this on the standard path,
     * but a custom `loadNetInfo` arg (host shim, future provider, test
     * double) could return any shape - guard once here so a broken shim
     * cannot crash SDK boot. `== null` covers both `null` (the typed
     * sentinel) and `undefined` (a non-conformant return from a custom
     * loader).
     */
    if (netInfo == null || typeof netInfo.addEventListener !== 'function') return noopDetach;

    let lastConnected: boolean | null = null;
    /**
     * `addEventListener` is typed as returning `() => void`, but the
     * runtime may hand back a subscription object with `.remove()`
     * instead (legacy / custom NetInfo adapters). Keep `subscription`
     * as the union so detach can dispatch on either shape; assignment
     * casts widen back from the narrower return type.
     */
    type NetInfoSubscription = (() => void) | { remove?: () => void };
    let subscription: NetInfoSubscription | undefined;
    try {
      const result = netInfo.addEventListener((state: NetInfoState | null | undefined) => {
        /** Optional chain shields against a shim that fires the callback with `null`/`undefined`. */
        const current = state?.isConnected;
        if (current !== true && current !== false) return;
        if (lastConnected === current) return;
        try {
          stampNowOnDispatcher(this.args.dispatcher);
          this.args.dispatcher.addEvent(
            current ? KEvents.INTERNET_CONNECTED : KEvents.INTERNET_DISCONNECTED,
          );
          /**
           * Advance `lastConnected` only after the emit succeeded so a
           * thrown `addEvent` does not permanently suppress future
           * same-state transitions: the coalescing gate must mirror
           * what was actually written, not what was attempted.
           */
          lastConnected = current;
        } catch {
          /** A throw from the dispatcher must not crash the NetInfo callback. */
        }
      });
      subscription = result;
    } catch {
      /** Subscribe itself threw - the shim is unusable, degrade to no-op. */
      return noopDetach;
    }

    return () => {
      /**
       * NetInfo's documented contract is an unsubscribe function, but
       * non-conformant shims (legacy / custom adapters) may return a
       * subscription object with `.remove()` instead. Cover both shapes
       * so listeners do not leak across shutdown / re-init.
       */
      try {
        if (typeof subscription === 'function') {
          subscription();
        } else if (typeof subscription?.remove === 'function') {
          subscription.remove();
        }
      } catch {
        /** Best-effort tracker cleanup. */
      }
    };
  }
}

export type { NetworkTrackerArgs } from './types/NetworkTracker';
export { NetworkTracker };
