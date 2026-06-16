/**
 * Deep-link auto-tracker. Subscribes to RN's `Linking` and emits
 * DEEP_LINK_ACTIVATED with the URL string per `'url'` event.
 *
 * The initial-launch URL (returned by `Linking.getInitialURL()`) is
 * NOT emitted automatically: the launch URL is a single one-shot
 * value that the host's deep-link router resolves at startup, and
 * emitting it as a runtime "activation" would double-report when
 * the same URL also fires through the change listener on certain
 * OS / RN combinations. Hosts that want the launch URL tracked
 * should emit it themselves once the deep-link route is resolved.
 */

import type { KeewanoTracker } from '../types/config';
import type { LinkingTrackerArgs } from './types/LinkingTracker';
import type { LinkingSubscription } from './types/rn';

import { KEvents } from '@keewano/core';

import { defaultLoadRn } from './loadRn';
import { noopDetach } from './noopDetach';
import { stampNowOnDispatcher } from './stampNow';

class LinkingTracker implements KeewanoTracker {
  readonly name = 'LinkingTracker';

  private readonly args: LinkingTrackerArgs;

  constructor(args: LinkingTrackerArgs) {
    this.args = args;
  }

  /**
   * Subscribe to deep-link `'url'` events. Returns a no-op detach
   * when Linking is unavailable.
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
    const linking = rn?.Linking;
    /** `== null` so a shim returning `null` degrades the same as `undefined`. */
    if (linking == null || typeof linking.addEventListener !== 'function') {
      return noopDetach;
    }

    /**
     * RN's Linking typed contract is `{ remove() }`, but legacy
     * adapters / custom shims may instead return a bare unsubscribe
     * function. Accept both shapes so cleanup tears the listener down
     * for either - calling `.remove()` on a function would silently
     * leak it across shutdown / re-init.
     */
    type LinkingUnsubscribe = (() => void) | LinkingSubscription;
    let subscription: LinkingUnsubscribe;
    try {
      const result = linking.addEventListener(
        'url',
        (event: { url?: string } | null | undefined) => {
          /** Optional chain shields against a shim that fires the callback with `null`/`undefined`. */
          const url = event?.url;
          if (typeof url !== 'string' || url.length === 0) return;
          try {
            stampNowOnDispatcher(this.args.dispatcher);
            this.args.dispatcher.addEventString({
              eventId: KEvents.DEEP_LINK_ACTIVATED,
              str: url,
            });
          } catch {
            /** A throw from the dispatcher must not block the Linking callback. */
          }
        },
      );
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

export type { LinkingTrackerArgs } from './types/LinkingTracker';
export { LinkingTracker };
