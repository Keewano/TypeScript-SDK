/**
 * Argument bags for the lifecycle construction helpers in `build.ts`.
 */

import type { CustomEventSet, KEventDispatcher, StorageAdapter } from '@keewano/core';

import type { NodeKeewanoConfig } from './config';

/**
 * Inputs for `buildDispatcher`, shared by the inert send-loop dispatcher
 * (built at init) and the per-user batch dispatcher (built per
 * `reportUserBatch`).
 *
 * installId - 16-byte UUID stamped on the dispatcher's batches; the relay's
 *   project id, or all-zero when the API key carries none (the dispatcher
 *   accepts the all-zero server-relay sentinel). Shipped as `K-InstallId`,
 *   never persisted to disk.
 * userId - 16-byte UUID for this dispatcher. All-zero "no user" marker for
 *   the inert dispatcher; the end user's id for a per-user batch.
 * dataSessionId - 16-byte non-zero session UUID for this run.
 * customEventSet - optional codegen event set; seeds the batch version.
 */
interface BuildDispatcherArgs {
  installId: Uint8Array;
  userId: Uint8Array;
  dataSessionId: Uint8Array;
  customEventSet: CustomEventSet | undefined;
}

/**
 * Inputs for `buildRuntime`.
 *
 * config - caller-supplied init config.
 * endpoint - resolved ingress URL.
 * shutdownGraceMs - resolved teardown drain budget, in milliseconds.
 * storage - resolved storage adapter.
 * dispatcher - the constructed inert send-loop dispatcher.
 * installId - 16-byte relay install id (see {@link NodeRuntime}).
 * userId - 16-byte all-zero "no user" marker.
 * dataSessionId - 16-byte session UUID for this run.
 */
interface BuildRuntimeArgs {
  config: NodeKeewanoConfig;
  endpoint: string;
  shutdownGraceMs: number;
  storage: StorageAdapter;
  dispatcher: KEventDispatcher;
  installId: Uint8Array;
  userId: Uint8Array;
  dataSessionId: Uint8Array;
}

export type { BuildDispatcherArgs, BuildRuntimeArgs };
