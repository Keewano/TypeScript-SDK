/**
 * Stamp the dispatcher's frame timestamp with the current wall clock
 * before a tracker writes directly through `dispatcher.addEvent*`.
 * The `Keewano.report*` surface gets this for free because
 * `runWhenReady` snapshots the call time; the tracker path bypasses
 * `runWhenReady`, so without this stamp a direct emit would reuse
 * whatever timestamp the previous event left behind.
 */
import type { KEventDispatcher } from '@keewano/core';

const MS_PER_SECOND = 1000;

function stampNowOnDispatcher(dispatcher: KEventDispatcher): void {
  dispatcher.setFrameTimestamp(Math.floor(Date.now() / MS_PER_SECOND));
}

export { stampNowOnDispatcher };
