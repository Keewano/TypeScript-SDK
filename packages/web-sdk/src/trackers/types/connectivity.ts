/**
 * Types for the connectivity tracker.
 *
 * ConnectivityWindowLike - the window seam: the `online` / `offline`
 *   listener target plus the optional `navigator.onLine` baseline
 *   read.
 *
 * ConnectivityTrackerArgs - dispatcher the events land in, optional
 *   window seam and send-loop wake hook.
 */
import type { KEventDispatcher } from '@keewano/core';

interface ConnectivityWindowLike {
  navigator?: { onLine?: boolean };
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface ConnectivityTrackerArgs {
  dispatcher: KEventDispatcher;
  win?: ConnectivityWindowLike;
  signalSend?: () => void;
}

export type { ConnectivityTrackerArgs, ConnectivityWindowLike };
