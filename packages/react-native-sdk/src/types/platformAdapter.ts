/**
 * Platform-info abstraction used by the initial-events emitter.
 * The default implementation reads from React Native's `Platform` /
 * `Dimensions` / `NativeModules`; tests pass a fake to keep the
 * unit suite hermetic.
 *
 * os - String identifier emitted as the PLATFORM event payload
 *   (`'ios'` / `'android'` / `'web'` / etc.).
 * osVersion - String emitted as the OS event payload.
 * deviceType - Coarse device class (`'phone'` / `'tablet'` / `'tv'`
 *   / `'desktop'` / `'unknown'`).
 * ramSizeMb - Total device RAM in MEGABYTES. The wire payload for
 *   the RAM_SIZE event is a uint32 count of MB, not bytes; values
 *   above `0xFFFFFFFF` are clamped at the emitter. React Native has
 *   no JS API for total RAM, so the default adapter returns `0`
 *   until a host plugin (e.g. `expo-device`) provides it via DI.
 * screenWidth - Pixel width as uint16.
 * screenHeight - Pixel height as uint16.
 * systemLanguage - Two-letter language code (`'en'`, `'uk'`, ...).
 * appVersion - Host app's release version string.
 */
interface PlatformAdapter {
  os: string;
  osVersion: string;
  deviceType: string;
  ramSizeMb: number;
  screenWidth: number;
  screenHeight: number;
  systemLanguage: string;
  appVersion: string;
}

export type { PlatformAdapter };
