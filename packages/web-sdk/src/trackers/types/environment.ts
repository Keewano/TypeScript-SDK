/**
 * Types for the environment-burst tracker.
 *
 * EnvironmentLike - the browser surface the tracker reads, extracted
 *   as a seam so tests can supply fixed values. Every field is
 *   optional: a missing source degrades that one event to its
 *   fallback (or skips it, for RAM) instead of failing the burst.
 *   userAgent / language mirror `navigator`; deviceMemory is the
 *   Chromium-only `navigator.deviceMemory` (GiB); screenWidth /
 *   screenHeight mirror `screen.width` / `screen.height` in CSS
 *   pixels.
 *
 * EnvironmentTrackerArgs - dispatcher the burst writes into, plus the
 *   optional environment seam (defaults to the live globals) and
 *   the host's app version for APP_LAUNCH ("undefined" when absent).
 */
import type { KEventDispatcher } from '@keewano/core';

interface EnvironmentLike {
  userAgent?: string;
  language?: string;
  deviceMemory?: number;
  screenWidth?: number;
  screenHeight?: number;
}

interface EnvironmentTrackerArgs {
  dispatcher: KEventDispatcher;
  env?: EnvironmentLike;
  appVersion?: string;
}

export type { EnvironmentLike, EnvironmentTrackerArgs };
