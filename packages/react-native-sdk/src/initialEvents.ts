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

import { KEvents } from '@keewano/core';

import { clampUint16, clampUint32 } from './clamp';

/**
 * Emit the init-burst events into the dispatcher in canonical order.
 * The call is synchronous; events land in the dispatcher's in-batch
 * and ride out on the next swap.
 */
function emitInitialEvents({ dispatcher, platform }: EmitInitialEventsArgs): void {
  /** APP_LAUNCH carries the host app version string. */
  dispatcher.addEventString({ eventId: KEvents.APP_LAUNCH, str: platform.appVersion });
  /**
   * PLATFORM mirrors `Platform.OS` ('ios' / 'android' / 'web'). This
   * is the canonical platform alphabet for the RN SDK: it is the only
   * platform token a pure-JS host can read without a native module, so
   * the wire value intentionally carries the RN identifier rather than
   * any other runtime's platform naming. Cross-SDK dashboards reconcile
   * platforms server-side, not on the client.
   */
  dispatcher.addEventString({ eventId: KEvents.PLATFORM, str: platform.os });
  /**
   * DEVICE_TYPE is a coarse device class ('phone' / 'tablet' / 'tv' /
   * 'desktop' / 'unknown') - emitted BEFORE OS. Pure-JS React Native
   * exposes no concrete device-model string, so the SDK intentionally
   * reports the device CLASS it can derive from `Platform.isTV` /
   * `isPad` / OS. A host that needs the exact model injects it via
   * `Keewano.init({ platform })`.
   */
  dispatcher.addEventString({ eventId: KEvents.DEVICE_TYPE, str: platform.deviceType });
  /**
   * OS carries the OS-version string (`Platform.Version` on RN hosts).
   * This is the bare version literal RN surfaces ('17.2' on iOS, the
   * API level on Android); a composed name+version descriptor would
   * require a native module, so the RN SDK intentionally ships the raw
   * platform value and lets the server attach the OS name from PLATFORM.
   */
  dispatcher.addEventString({ eventId: KEvents.OS, str: platform.osVersion });
  /**
   * RAM_SIZE wire payload is megabytes (uint32), not bytes. The
   * PlatformAdapter contract names the field `ramSizeMb` to enforce
   * the unit at the type level.
   */
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
  dispatcher.addEventString({ eventId: KEvents.SYSTEM_LANG, str: platform.systemLanguage });
}

export type { EmitInitialEventsArgs } from './types/initialEvents';
export { emitInitialEvents };
