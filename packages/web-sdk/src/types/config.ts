/**
 * Boot configuration accepted by `Keewano.init`.
 *
 * apiKey - Project key. Required. It is visible in page source by
 *   nature of running in a browser, so treat it as a public project
 *   identifier.
 * appVersion - Host application release version, reported as the
 *   APP_LAUNCH payload. A browser exposes no such value, so it can
 *   only come from the host build (a bundler-injected constant, a
 *   git SHA). Reported as "undefined" when absent. This is the HOST's
 *   version, not the SDK's: the SDK reports its own on every request.
 * requirePlayerConsent - Initial consent gate behaviour on a fresh
 *   origin. `true` -> `Pending` (events are collected and held on the
 *   client until the host calls `setUserConsent`; a grant ships the
 *   held data, a deny deletes it); `false` -> `NotRequired` (events
 *   flow immediately). Defaults to `true`: on the web, analytics is
 *   expected to stay silent until the visitor consents. Pass `false`
 *   only where no consent requirement applies.
 * endpoint - Override the ingestion HOST for staging / self-host
 *   setups. The browser SDK appends its own API paths, so pass an
 *   origin (`https://ingest.example.com`), not a full endpoint path -
 *   this differs from the device SDKs, whose base URL already
 *   includes their ingress path. Defaults to the production host.
 * storage - Custom `StorageAdapter` for the durable event queue.
 *   Defaults to IndexedDB with an in-memory fallback when the write
 *   probe fails. Identity and consent do NOT flow through this
 *   adapter: they persist through the localStorage / cookie ladder so
 *   they degrade independently of the queue.
 * customEventSet - Schema for the host's custom events, produced by
 *   `@keewano/codegen`. When present, every batch carries the set's
 *   schema hash and the schema is registered with the server before
 *   any batch is sent. When absent, batches carry the "no schema"
 *   sentinel and registration is skipped.
 * plugins - Custom KeewanoTracker instances. Attached after the
 *   built-in trackers; each lives until shutdown.
 * resolveWindowName - Maps the current location to the reported
 *   window name for the navigation tracker. Defaults to
 *   `location.pathname`; override for dynamic segments
 *   (`/game/123` -> `game`). A throwing resolver falls back to the
 *   pathname.
 * disableNavigationTracking - Skip the WINDOW_OPEN / WINDOW_CLOSE
 *   navigation tracker (initial page, History API, back / forward).
 * disableButtonTracking - Skip the delegated BUTTON_CLICK click
 *   tracker.
 * disableErrorTracking - Skip the uncaught-error / unhandled-
 *   rejection ERROR_MSG tracker.
 * disableAppStateTracking - Skip the tab-visibility APP_PAUSE /
 *   APP_RESUME tracker.
 * disableNetworkTracking - Skip the INTERNET_CONNECTED /
 *   INTERNET_DISCONNECTED connectivity tracker. Unlike React Native
 *   (opt-in there: it needs an extra native peer), the browser
 *   `online` / `offline` events are free, so the tracker is on by
 *   default.
 */

import type { CustomEventSet, StorageAdapter } from '@keewano/core';

import type { ResolveWindowName } from '../trackers/types/navigation';

interface WebKeewanoConfig {
  apiKey: string;
  appVersion?: string;
  requirePlayerConsent?: boolean;
  endpoint?: string;
  storage?: StorageAdapter;
  customEventSet?: CustomEventSet;
  plugins?: ReadonlyArray<KeewanoTracker>;
  resolveWindowName?: ResolveWindowName;
  disableNavigationTracking?: boolean;
  disableButtonTracking?: boolean;
  disableErrorTracking?: boolean;
  disableAppStateTracking?: boolean;
  disableNetworkTracking?: boolean;
}

/**
 * Plugin contract for custom auto-trackers, shared with the sibling
 * platform SDKs. Built-in auto-trackers implement the same interface;
 * the lifecycle manager calls `attach()` on init and the returned
 * `detach` function on shutdown.
 *
 * `criticalPath` (optional, default false): when `true`, an `attach()`
 * throw fails `Keewano.init()` instead of being logged as a
 * best-effort failure. Reserved for trackers whose absence would
 * corrupt the session record.
 */
interface KeewanoTracker {
  readonly name: string;
  readonly criticalPath?: boolean;
  /**
   * Wire up the listeners and hand back how to remove them: either a
   * detach function or a subscription with a callable `remove()`. The
   * second shape is what most React Native and browser APIs already
   * return, and the SDK has always accepted it - the type said
   * otherwise, so a host handing one over had to cast.
   */
  attach(): (() => void) | { remove: () => void };
}

export type { KeewanoTracker, WebKeewanoConfig };
