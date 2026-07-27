/**
 * SDK teardown. `shutdown()` is the single serialized entry point: it
 * aborts the send loop, awaits its exit so the dispatcher is no longer
 * racing a live tick, cancels the idle timer, and clears the runtime
 * singleton.
 *
 * There is nothing to flush on the way out: every user batch is persisted
 * synchronously inside `reportUserBatch`, and the inert send-loop
 * dispatcher never accumulates events. Anything already on disk but not
 * yet shipped is picked up by the next launch's send-loop sweep.
 */

import { clearRuntime, getRuntimeOrNull } from '../runtime';
import { serializeLifecycle } from './helpers/serialize';

/**
 * Wind down the SDK. Teardown runs through `serializeLifecycle` so a
 * repeated termination signal or a host calling shutdown twice never
 * interleaves two teardown sequences. Idempotent: a shutdown after the
 * runtime is gone is a no-op.
 */
async function shutdown(): Promise<void> {
  return serializeLifecycle(doShutdown);
}

/**
 * Abort the loop first, await its exit so the dispatcher is no longer
 * racing a live tick, cancel the idle timer, then clear the runtime
 * singleton.
 */
async function doShutdown(): Promise<void> {
  const runtime = getRuntimeOrNull();
  if (runtime === null) {
    return;
  }
  runtime.sendLoopAbort.abort();
  if (runtime.sendLoopPromise !== null) {
    await runtime.sendLoopPromise;
  }
  runtime.dispatcher.cancelPendingWait();
  clearRuntime();
}

export { shutdown };
