/**
 * Shared helper invoked by every listener-driven tracker before
 * dispatching an event. Stamps the dispatcher's frame timestamp
 * with the current wall-clock time so the next `addEvent*` call
 * writes the event header with the wall time at which the listener
 * fired, not whatever frame-timestamp was last set by an unrelated
 * `runWhenReady` invocation.
 *
 * Public report methods (`Keewano.reportButtonClick`, etc.) get
 * this for free because `runWhenReady` snapshots `Math.floor(Date.now()
 * / 1000)` and calls `setFrameTimestamp(ts)` before `fn` runs. The
 * auto-tracker path bypasses `runWhenReady`, so the stamping has
 * to happen here.
 */

import type { KEventDispatcher } from '@keewano/core';

/**
 * Set the dispatcher's frame timestamp to `Math.floor(Date.now() /
 * 1000)`. The next `addEvent*` write picks it up via `writeHeader`.
 */
function stampNowOnDispatcher(dispatcher: KEventDispatcher): void {
  dispatcher.setFrameTimestamp(Math.floor(Date.now() / 1000));
}

export { stampNowOnDispatcher };
