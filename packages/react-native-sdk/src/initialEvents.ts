/**
 * Emit the initial environment events at the end of every successful
 * `Keewano.init`. The canonical init burst is:
 *
 *   APP_LAUNCH -> PLATFORM -> DEVICE_TYPE -> OS -> RAM_SIZE ->
 *   SCREEN_RESOLUTION -> SYSTEM_LANG
 *
 * The event order is part of the wire protocol and is verified by
 * conformance tests; do not reorder.
 */

import type { EmitInitialEventsArgs } from './types/initialEvents';

import {
  KEvents,
  appVersionPayload,
  clampUint16,
  clampUint32,
  truncateString,
} from '@keewano/core';

/**
 * Emit the init-burst events into the dispatcher in canonical order.
 * The call is synchronous; events land in the dispatcher's in-batch
 * and ride out on the next swap.
 *
 * Every string is capped the same way a report method caps its label.
 * These fields are host-supplied through `Keewano.init({ platform })`
 * - a build stamp carrying a branch and a commit, a device model read
 * from a native module - so the burst is otherwise the one path on
 * which an unbounded string reaches the wire.
 */
function emitInitialEvents({ dispatcher, platform }: EmitInitialEventsArgs): void {
  /**
   * APP_LAUNCH goes out whether or not the host could name its build.
   * The adapter type asks for a version, and the defaults supply one,
   * but a JavaScript host can still hand over an object without it -
   * an unset environment variable reaching this far used to throw
   * inside the burst and fail the whole init, taking every other event
   * with it. A session with no version is worth more than no session.
   */
  dispatcher.addEventString({
    eventId: KEvents.APP_LAUNCH,
    str: truncateString(appVersionPayload(platform.appVersion)),
  });
  // PLATFORM intentionally carries the RN `Platform.OS` token ('ios' /
  // 'android' / 'web'); cross-SDK platform naming is reconciled server-side.
  dispatcher.addEventString({ eventId: KEvents.PLATFORM, str: truncateString(platform.os) });
  // DEVICE_TYPE is a coarse device class ('phone' / 'tablet' / 'tv' /
  // 'desktop' / 'unknown'): pure-JS RN exposes no device-model string, so a
  // host that needs the exact model injects it via `Keewano.init({ platform })`.
  dispatcher.addEventString({
    eventId: KEvents.DEVICE_TYPE,
    str: truncateString(platform.deviceType),
  });
  // OS carries the bare `Platform.Version` literal ('17.2' on iOS, the API
  // level on Android); the server attaches the OS name from PLATFORM.
  dispatcher.addEventString({ eventId: KEvents.OS, str: truncateString(platform.osVersion) });
  // RAM_SIZE wire payload is megabytes (uint32), not bytes; `ramSizeMb`
  // enforces the unit at the type level.
  dispatcher.addEventUint32({
    eventId: KEvents.RAM_SIZE,
    value: clampUint32(platform.ramSizeMb),
  });
  /**
   * SCREEN_RESOLUTION = two uint16 LE values (width, height).
   * `clampUint16` SATURATES dimensions above 65535 to 65535 rather
   * than wrapping modulo 2^16. Saturation is the intentional policy:
   * for every shipping device both dimensions are well under 65535 so
   * the bytes are unaffected, and clamping to the max keeps a future
   * out-of-range value monotonic (a large screen never reports a tiny
   * wrapped width) for any analytics that bucket by resolution.
   */
  dispatcher.addEventUint16x2({
    eventId: KEvents.SCREEN_RESOLUTION,
    x: clampUint16(platform.screenWidth),
    y: clampUint16(platform.screenHeight),
  });
  /**
   * SYSTEM_LANG is the IETF / BCP-47 language tag the OS reports
   * ('en_US', 'fr-FR'). The RN SDK intentionally emits the open-set
   * locale tag the platform exposes rather than a closed enum name:
   * the locale identifier is the only language value reachable from
   * pure JS, and BCP-47 is the lossless superset, so the server maps
   * other runtimes onto this alphabet rather than the reverse.
   */
  dispatcher.addEventString({
    eventId: KEvents.SYSTEM_LANG,
    str: truncateString(platform.systemLanguage),
  });
}

export type { EmitInitialEventsArgs } from './types/initialEvents';
export { emitInitialEvents };
