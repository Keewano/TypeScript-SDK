/**
 * Public Node SDK entrypoint. The `Keewano` object below is the only
 * surface host code interacts with; everything else in this package is an
 * implementation detail.
 *
 * The Node SDK runs in relay mode: one server process reports on behalf of
 * many end users. There is no global "current user" and no process
 * self-telemetry, so the surface is just boot, tear down, and emit one
 * user's batch at a time.
 *
 * Lifecycle:
 *   `Keewano.init(config)` installs the runtime and starts the send loop;
 *   its only async step is seeding the batchNum counter from the batches
 *   directory. Re-init warns and no-ops. `Keewano.shutdown()` aborts the
 *   send loop and clears the runtime. `Keewano.reportUserBatch(args)`
 *   emits one batch for a single end user through the reporter handed to
 *   its build callback.
 *
 * Versus the React Native SDK this facade attaches no UI auto-trackers and
 * the dispatcher `unref`s its idle timer so the SDK never keeps the process
 * alive. The lifecycle implementation lives under `./lifecycle`; this file
 * only assembles the public object.
 */

import type { NodeKeewanoApi } from './types/keewano';

import { init, reportUserBatch, shutdown } from './lifecycle';
import { isInitialized } from './runtime';

/** `true` when {@link init} has installed the runtime and `shutdown` has not run since. */
function isReady(): boolean {
  return isInitialized();
}

/**
 * The single facade host code interacts with. Implements
 * {@link NodeKeewanoApi}; the method surface is described in that
 * interface's header.
 */
const Keewano: NodeKeewanoApi = {
  init,
  shutdown,
  isReady,
  reportUserBatch,
};

export type { NodeKeewanoApi } from './types/keewano';
export { Keewano };
