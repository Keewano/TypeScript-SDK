/**
 * Configuration accepted by `Keewano.init` on Node.
 *
 * The Node SDK runs in relay mode: a single server process reports
 * telemetry on behalf of many end users. It keeps no self-telemetry of
 * its own (no environment burst, no crash observer, no consent gate), so
 * the config is deliberately small - everything user-facing is supplied
 * per call through `Keewano.reportUserBatch`.
 *
 * apiKey - project-scoped secret sent as `K-Token`. Required.
 * endpoint - override the default ingress URL (staging / self-host).
 * getExtraHeaders - optional provider for extra HTTP headers attached to
 *   every request; resolved once per send-loop iteration, sync or async.
 * storage - custom `StorageAdapter`. Supply this or `dataDir`.
 * dataDir - sandbox root for the default `NodeStorageAdapter`; ignored
 *   when `storage` is supplied. Required otherwise, and deliberately
 *   without a default: a queue directory holds batches addressed to one
 *   project, and a batch carries its own user and payload, so a process
 *   that finds a neighbour's file ships that neighbour's end users into
 *   its own project. A host-wide default made that the out-of-the-box
 *   configuration. Point it at a private, persistent location - the same
 *   one across restarts, a different one per service and per replica.
 * shutdownGraceMs - how long `shutdown()` may spend shipping what is
 *   still queued, in whole milliseconds. Defaults to 3000. `0` skips
 *   the drain and tears down immediately, leaving the queue for the
 *   next launch.
 * installId - override the relay's install id (a 36-char hyphenated
 *   UUID). Defaults to the project id from the API key; a relay has no
 *   per-device install id and the backend requires a non-zero one.
 * customEventSet - schema for the host's custom events, produced by
 *   `@keewano/codegen`. When present the send loop registers it once per
 *   session before any batch ships.
 */

import type { CustomEventSet, StorageAdapter } from '@keewano/core';

interface NodeKeewanoConfigBase {
  apiKey: string;
  endpoint?: string;
  getExtraHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  installId?: string;
  customEventSet?: CustomEventSet;
  shutdownGraceMs?: number;
}

/**
 * Either name the directory or bring the adapter, never neither: the
 * union is what makes the host-wide default unrepresentable rather than
 * merely discouraged.
 *
 * The `dataDir` branch is last on purpose. TypeScript reports the final
 * member when nothing matches, and a caller who forgot both is far more
 * likely to want the directory than to want to write an adapter - with
 * the branches the other way round the compiler tells them `storage` is
 * missing and sends them off to implement one.
 */
type NodeKeewanoConfig = NodeKeewanoConfigBase &
  ({ storage: StorageAdapter; dataDir?: never } | { dataDir: string; storage?: never });

export type { NodeKeewanoConfig, NodeKeewanoConfigBase };
