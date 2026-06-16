/**
 * Network-layer constants used across `sendBatch` and the `/custom`
 * sub-protocol. Grouped here so a future endpoint change touches one
 * file instead of every transport function.
 */

import { version as PACKAGE_VERSION } from '../../../package.json';

/**
 * Default Keewano ingress base URL. Exported as a convenience for
 * callers that do not need a custom endpoint; every transport
 * function still requires an explicit `baseUrl` argument so test
 * setups remain obvious.
 */
const KEEWANO_DEFAULT_BASE_URL = 'https://api.keewano.com/event/ingress/v1/data';

/**
 * Endpoint paths relative to `baseUrl`. Joined via `joinEndpoint` so
 * a trailing slash on `baseUrl` cannot produce `//in` or `//custom`.
 *
 * IN - Batch submission endpoint (`POST`).
 * CUSTOM - Custom-events map probe (`GET`) and registration (`POST`)
 *   endpoint.
 */
const ENDPOINT_PATH = {
  IN: '/in',
  CUSTOM: '/custom',
} as const;

/**
 * Body content type for both `/in` (event-stream bytes) and `/custom`
 * (gzip blob). The body is always opaque binary; HTTP just needs to
 * know it is not text or JSON.
 */
const CONTENT_TYPE_OCTET_STREAM = 'application/octet-stream';

/**
 * `K-SDK` HTTP header value. The version portion is read at compile
 * time from `packages/core/package.json` via `resolveJsonModule`, so
 * bumping that field is the only step needed to update the wire
 * identifier - no source edit, no codegen, no manual sync command.
 *
 * The `ReactNative/` prefix is provisional - the server team has
 * not yet confirmed the canonical `K-SDK` token shape. When that
 * confirmation lands, edit this template string.
 */
const SDK_VERSION = `ReactNative/${PACKAGE_VERSION}`;

export { CONTENT_TYPE_OCTET_STREAM, ENDPOINT_PATH, KEEWANO_DEFAULT_BASE_URL, SDK_VERSION };
