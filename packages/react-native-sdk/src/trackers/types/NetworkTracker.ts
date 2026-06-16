/**
 * dispatcher - Live event accumulator. Emits INTERNET_CONNECTED /
 *   INTERNET_DISCONNECTED on every connectivity transition reported
 *   by the host's NetInfo module.
 * loadNetInfo - Optional injection point for tests. Returns the
 *   host's NetInfo-shaped module, or `null` when absent. Defaults
 *   to a lazy `require('@react-native-community/netinfo')` wrapper
 *   that returns `null` on resolution failure.
 */
import type { KEventDispatcher } from '@keewano/core';

interface NetInfoState {
  isConnected?: boolean | null;
}

interface NetInfoLike {
  /**
   * Subscribe to connectivity transitions. The handler may fire with
   * a `null` / `undefined` state on broken shims, and the return may
   * be either a bare unsubscribe function or a `remove()` subscription
   * (legacy / custom NetInfo adapters), so both are widened here to
   * match the defensive runtime contract.
   */
  addEventListener: (
    handler: (state: NetInfoState | null | undefined) => void,
  ) => (() => void) | { remove?: () => void };
}

interface NetworkTrackerArgs {
  dispatcher: KEventDispatcher;
  loadNetInfo?: () => NetInfoLike | null;
}

export type { NetInfoLike, NetInfoState, NetworkTrackerArgs };
