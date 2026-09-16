/**
 * SDK teardown. `shutdown()` is the single serialized entry point: it
 * joins an in-flight init, aborts the send loop, awaits its exit so the
 * dispatcher is no longer racing a live tick, cancels the idle timer,
 * and clears the runtime singleton.
 *
 * There is nothing in memory to flush: every user batch is persisted
 * synchronously inside `reportUserBatch`, and the inert send-loop
 * dispatcher never accumulates events. What is on disk is a different
 * matter - a long-lived server has a loop that will ship it, a script
 * has no next launch at all - so teardown first gives the queue a
 * bounded chance to leave. See `finalShip.ts`.
 */

import { clearRuntime, getInitPromise, getRuntimeOrNull } from '../runtime';
import { shipQueuedBeforeExit } from './finalShip';
import { within } from './helpers/within';
import { serializeLifecycle } from './helpers/serialize';

/**
 * How long teardown waits for the aborted loop to actually exit.
 *
 * Generous next to a loop that is merely mid-request, short next to the
 * ten seconds a container runtime allows between SIGTERM and SIGKILL.
 */
const LOOP_EXIT_WAIT_MS = 2000;

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
 * Join an in-flight init, abort the loop, await its exit so the
 * dispatcher is no longer racing a live tick, cancel the idle timer,
 * then clear the runtime singleton.
 */
async function doShutdown(): Promise<void> {
  /**
   * Wait for an in-flight init() to install the runtime (or fail);
   * otherwise shutdown returns early while startInit() finishes
   * asynchronously and leaves the loop running.
   */
  const pending = getInitPromise();
  if (pending !== null) {
    try {
      await pending;
    } catch {
      /** Init rejected; nothing was installed so there is nothing to tear down. */
    }
  }
  const runtime = getRuntimeOrNull();
  if (runtime === null) {
    return;
  }
  /**
   * Before the abort, not after: the drain works by waking the live
   * loop, and an aborted loop has no passes left to wait on.
   */
  await shipQueuedBeforeExit(runtime, runtime.shutdownGraceMs);
  runtime.sendLoopAbort.abort();
  if (runtime.sendLoopPromise !== null) {
    /**
     * Bounded, because the abort only takes effect where the loop can
     * see it. Parked inside a storage call - a hung network mount, an
     * adapter that never answers - it observes nothing until that call
     * returns, and an unbounded wait here hands the whole process's
     * exit to it. The abort is already latched, so a loop that wakes
     * later exits on its own without touching the cleared runtime.
     */
    await within(runtime.sendLoopPromise, LOOP_EXIT_WAIT_MS);
  }
  runtime.dispatcher.cancelPendingWait();
  clearRuntime();
}

export { shutdown };
