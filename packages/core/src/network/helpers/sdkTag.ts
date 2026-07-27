/**
 * `K-SDK` HTTP header value. The header tells the ingress server which
 * platform SDK produced the request. The version portion is read at
 * compile time from `packages/core/package.json` via `resolveJsonModule`,
 * so bumping that field updates the wire identifier with no source edit.
 *
 * There is no default platform: every SDK MUST call `configureSdkPlatform`
 * during init (the React Native facade passes `ReactNative`, the Node
 * facade passes `Node`). `resolveSdkTag` throws until it is set, so a
 * platform that forgets to declare itself fails loudly instead of being
 * silently misattributed on the server. The setting is process-global
 * (one SDK runs per process).
 *
 * The token shape is still provisional - the server team has not confirmed
 * the canonical `K-SDK` form. When it does, change what each facade passes;
 * nothing else moves.
 */

import { version as PACKAGE_VERSION } from '../../../package.json';

let sdkPlatform: string | null = null;

/**
 * Set the platform prefix for the `K-SDK` header on every subsequent
 * request. Each SDK calls this once during init.
 *
 * @throws TypeError when `platform` is not a non-empty string.
 */
function configureSdkPlatform(platform: string): void {
  if (typeof platform !== 'string' || platform.length === 0) {
    throw new TypeError('configureSdkPlatform: empty platform');
  }
  sdkPlatform = platform;
}

/**
 * Throw if no SDK platform has been configured. Called once during init
 * (from the shared runtime install) so an SDK that never declared its
 * platform fails the initialization loudly instead of mis-tagging its
 * traffic at send time, and by `resolveSdkTag` as the wire-time backstop.
 *
 * @throws Error when `configureSdkPlatform` has not been called.
 */
function assertSdkPlatformConfigured(): void {
  if (sdkPlatform === null) {
    throw new Error('Keewano: SDK platform not configured; call configureSdkPlatform during init');
  }
}

/**
 * The `K-SDK` value to send: `<platform>/<core version>`.
 *
 * @throws Error when no platform has been configured - the owning SDK
 *   failed to call `configureSdkPlatform` during init.
 */
function resolveSdkTag(): string {
  if (sdkPlatform === null) {
    throw new Error('resolveSdkTag: SDK platform not configured');
  }
  return `${sdkPlatform}/${PACKAGE_VERSION}`;
}

export { assertSdkPlatformConfigured, configureSdkPlatform, resolveSdkTag };
