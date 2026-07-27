/**
 * Public Node SDK API contract. The `Keewano` facade exported from the
 * package barrel implements it.
 *
 * The Node SDK runs in relay mode: one server process reports on behalf of
 * many end users. There is no global "current user" and no process
 * self-telemetry, so the surface is intentionally tiny - boot, tear down,
 * and emit one user's batch at a time.
 *
 * Lifecycle (`init`, `shutdown`, `isReady`) - boot the SDK and wind it
 *   down. `init` is fire-and-forget but returns a Promise so callers can
 *   await the post-init state.
 * Relay (`reportUserBatch`) - emit one self-contained batch attributed to
 *   a single end user; the events are produced through the reporter handed
 *   to its build callback.
 */

import type { NodeKeewanoConfig } from './config';
import type { ReportUserBatchArgs } from './relay';

interface NodeKeewanoApi {
  init(config: NodeKeewanoConfig): Promise<void>;
  shutdown(): Promise<void>;
  isReady(): boolean;
  reportUserBatch(args: ReportUserBatchArgs): Promise<void>;
}

export type { NodeKeewanoApi };
