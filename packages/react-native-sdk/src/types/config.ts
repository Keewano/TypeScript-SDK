/**
 * Configuration accepted by `Keewano.init`.
 *
 * apiKey - Project-scoped secret sent as `K-Token`. Required.
 * requirePlayerConsent - Initial consent gate behaviour on a fresh
 *   install. `true` -> `Pending` (events queue until the host calls
 *   `setUserConsent`); `false` -> `NotRequired` (events flow
 *   immediately). Defaults to `false`.
 * endpoint - Override the default Keewano ingress URL. Useful for
 *   staging / self-host setups. Defaults to the production URL.
 * getExtraHeaders - Optional provider for extra HTTP headers attached
 *   to every outgoing request (`POST /in`, `GET`/`POST /custom`).
 *   Resolved once per send-loop iteration so a short-lived token can
 *   be refreshed; may be sync or async. Typical use is an auth header
 *   to clear an identity-aware proxy in front of a staging endpoint
 *   (for example `{ Authorization: 'Bearer <token>' }`). Reserved
 *   K-* / Content-* headers always win a name collision; each header
 *   is validated as header-safe. A throw from the provider is logged
 *   and the iteration proceeds without extra headers.
 * storage - Custom `StorageAdapter`. Defaults to `BareRNStorageAdapter`.
 * platform - Custom `PlatformAdapter`. Defaults to a lazy adapter
 *   that reads from React Native's `Platform` / `Dimensions` /
 *   `NativeModules` at first use.
 * disableButtonTracking - Skip the built-in `Pressable` patch.
 * disableAppStateTracking - Skip the AppState listener.
 * disableBackHandlerTracking - Skip the Android BackHandler listener.
 * disableLinkingTracking - Skip the Linking listener.
 * disableErrorTracking - Skip the ErrorUtils global handler.
 * enableNetworkTracking - Attach the NetInfo connectivity listener.
 *   Off by default, unlike the other auto-trackers: it is the only one
 *   that needs an optional native peer (`@react-native-community/netinfo`)
 *   rather than just `react-native`. Install that peer and set this
 *   `true` to opt in; otherwise the SDK never probes for it.
 * plugins - Custom KeewanoTracker instances. Attached after the
 *   built-in trackers; each lives until shutdown.
 * customEventSet - Schema for the host's custom events. Produced by
 *   `@keewano/codegen` and imported from the generated module. When
 *   present, the send loop stamps every outgoing batch's
 *   `K-CustomEventHash` with `customEventSet.version` and probes
 *   `GET /custom` once per session; if the server replies `204`,
 *   the gzip-compressed schema is uploaded via `POST /custom`
 *   before any `POST /in` is allowed to proceed. When absent, the
 *   send loop ships batches with `K-CustomEventHash: 0` (server
 *   sentinel for "no schema") and skips registration entirely.
 */

import type { CustomEventSet, StorageAdapter } from '@keewano/core';

import type { PlatformAdapter } from './platformAdapter';

interface KeewanoConfig {
  apiKey: string;
  requirePlayerConsent?: boolean;
  endpoint?: string;
  getExtraHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  storage?: StorageAdapter;
  platform?: PlatformAdapter;
  disableButtonTracking?: boolean;
  disableAppStateTracking?: boolean;
  disableBackHandlerTracking?: boolean;
  disableLinkingTracking?: boolean;
  disableErrorTracking?: boolean;
  enableNetworkTracking?: boolean;
  plugins?: ReadonlyArray<KeewanoTracker>;
  customEventSet?: CustomEventSet;
}

/**
 * Plugin contract for custom auto-trackers. Built-in auto-trackers
 * implement the same interface; the lifecycle manager calls
 * `attach()` on init and the returned `detach` function on shutdown.
 *
 * `criticalPath` (optional, default false): when `true`, an `attach()`
 * throw rejects `Keewano.init()` instead of being logged as a
 * best-effort failure. Reserved for trackers whose absence would
 * corrupt the session record - currently only the InitialEventsTracker,
 * which emits the canonical APP_LAUNCH / PLATFORM / DEVICE_TYPE / OS /
 * RAM_SIZE / SCREEN_RESOLUTION / SYSTEM_LANG burst the analytics server
 * expects at the start of every session.
 */
interface KeewanoTracker {
  readonly name: string;
  readonly criticalPath?: boolean;
  attach(): () => void;
}

export type { KeewanoConfig, KeewanoTracker };
