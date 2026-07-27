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
 * storage - custom `StorageAdapter`; defaults to a `NodeStorageAdapter`.
 * dataDir - sandbox root for the default `NodeStorageAdapter`; ignored
 *   when `storage` is supplied. Defaults to `<os.tmpdir()>/keewano`.
 * installId - override the relay's install id (a 36-char hyphenated
 *   UUID). Defaults to the project id from the API key; a relay has no
 *   per-device install id and the backend requires a non-zero one.
 * customEventSet - schema for the host's custom events, produced by
 *   `@keewano/codegen`. When present the send loop registers it once per
 *   session before any batch ships.
 */

import type { CustomEventSet, StorageAdapter } from '@keewano/core';

interface NodeKeewanoConfig {
  apiKey: string;
  endpoint?: string;
  getExtraHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  storage?: StorageAdapter;
  dataDir?: string;
  installId?: string;
  customEventSet?: CustomEventSet;
}

export type { NodeKeewanoConfig };
