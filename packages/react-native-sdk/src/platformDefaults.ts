/**
 * Lazy `PlatformAdapter` that reads from React Native's `Platform`,
 * `Dimensions`, and `NativeModules` at first use. Wrapped in a
 * try / catch around `require('react-native')` so unit tests do not
 * have to mock the native module: when `react-native` is unavailable
 * (Node test runner), every field falls back to a self-labelling
 * sentinel string.
 */

import type { PlatformAdapter } from './types/platformAdapter';
import type { RnModule, RnPlatformLike } from './types/platformDefaults';

import { APP_VERSION_UNSPECIFIED, clampUint32 } from '@keewano/core';

// Declared locally so the per-package tsc does not need @types/node (mirrors loadNativeModules.ts).
declare const require: (id: string) => unknown;

/** Sentinel returned when a platform field cannot be resolved. */
const UNKNOWN = 'unknown';

/**
 * Resolve `require('react-native')` at first call. Returns `null`
 * when the module is absent (e.g. Jest test runtime). Handles both
 * the CommonJS direct shape and the `{ default: ... }` ESM-interop
 * shape so the loader works under Metro, Jest, and Webpack alike.
 *
 * Excluded from coverage because the success path requires the
 * native module to be present on disk, which is not the case in the
 * Jest sandbox.
 */
/* istanbul ignore next */
function tryRequireRn(): RnModule | null {
  try {
    const mod = require('react-native') as RnModule & { default?: RnModule };
    // Interop builds expose the API on both the top level and mod.default; prefer the top-level
    // shape when it already looks like RN, else unwrapping default would drop the real fields.
    if (
      mod.Platform !== undefined ||
      mod.Dimensions !== undefined ||
      mod.NativeModules !== undefined
    ) {
      return mod;
    }
    if (mod.default !== undefined) {
      return mod.default;
    }
    return mod;
  } catch {
    return null;
  }
}

/**
 * Full-screen dimensions, or `undefined` when the lookup throws
 * (`Dimensions.get()` can raise on SSR / mocks; the `?.` chain does
 * not catch a throw). Reads `'screen'` (whole display), not `'window'`
 * (excludes Android status/nav bars), to mirror the wire's expected
 * resolution; `scale` is returned so the caller can convert
 * density-independent points to the physical pixels the wire expects.
 */
function tryGetScreenDimensions(
  rn: RnModule | null,
): { width: number; height: number; scale: number } | undefined {
  let dims: unknown;
  try {
    dims = rn?.Dimensions?.get?.('screen');
  } catch {
    return undefined;
  }
  // Validate shape: a shim returning null/primitive/missing-numeric fields must fall back rather
  // than crash the caller's dims.width deref.
  if (dims === null || typeof dims !== 'object') return undefined;
  const candidate = dims as { width?: unknown; height?: unknown; scale?: unknown };
  if (typeof candidate.width !== 'number' || typeof candidate.height !== 'number') {
    return undefined;
  }
  // Default scale to 1 when omitted/non-positive so points pass through unscaled, not collapsed to 0.
  const scale = typeof candidate.scale === 'number' && candidate.scale > 0 ? candidate.scale : 1;
  return { width: candidate.width, height: candidate.height, scale };
}

/**
 * OS identifier from `Platform.OS`, falling back to the nested
 * `Platform.constants.systemName`. Lowercased so a host writing
 * `'iOS'`/`'Android'` is not misclassified downstream (callers check
 * `=== 'ios'`/`'android'`). `undefined` when neither source exists.
 */
function resolveOs(platform: RnPlatformLike | undefined): string | undefined {
  if (platform === undefined) return undefined;
  if (typeof platform.OS === 'string') return platform.OS.toLowerCase();
  const sysName = platform.constants?.systemName;
  if (typeof sysName === 'string') return sysName.toLowerCase();
  return undefined;
}

/**
 * Classify device into tv/tablet/phone/desktop/unknown. Order matters:
 * `isTV` wins over `isPad` so an Apple TV reports 'tv', not iPad-class.
 */
function detectDeviceType(rn: RnModule | null): string {
  const platform = rn?.Platform;
  if (platform === undefined) return UNKNOWN;
  if (platform.isTV === true) return 'tv';
  if (platform.isPad === true) return 'tablet';
  const os = resolveOs(platform);
  if (os === 'ios' || os === 'android') return 'phone';
  if (os === 'web') return 'desktop';
  return UNKNOWN;
}

/**
 * Preferred locale: iOS via `SettingsManager.settings.AppleLocale`
 * (or `AppleLanguages[0]`), Android via `I18nManager.localeIdentifier`,
 * else {@link UNKNOWN}. Gated by {@link resolveOs} so a hybrid module
 * reads the source matching the actual platform; when the OS is unknown
 * it scans Apple-then-Android so legacy hosts still resolve a value.
 */
function detectLanguage(rn: RnModule | null): string {
  const nm = rn?.NativeModules;
  if (nm === undefined) return UNKNOWN;
  // NativeModules getters can throw (partial mocks, lazy-init); without the wrap that would
  // crash init() instead of falling back to UNKNOWN.
  try {
    const os = resolveOs(rn?.Platform);
    if (os === 'ios') return readAppleLocale(nm) ?? UNKNOWN;
    if (os === 'android') return readAndroidLocale(nm) ?? UNKNOWN;
    return readAppleLocale(nm) ?? readAndroidLocale(nm) ?? UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

/**
 * Read the iOS locale from `SettingsManager.settings`. Returns `null`
 * when neither `AppleLocale` nor `AppleLanguages[0]` is a string, or
 * when any of the underlying NativeModules property reads throws.
 */
function readAppleLocale(nm: NonNullable<RnModule['NativeModules']>): string | null {
  try {
    const apple = nm.SettingsManager?.settings;
    if (typeof apple?.AppleLocale === 'string') return apple.AppleLocale;
    const appleLangs = apple?.AppleLanguages;
    if (Array.isArray(appleLangs) && typeof appleLangs[0] === 'string') return appleLangs[0];
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the Android locale from `I18nManager.localeIdentifier`.
 * Returns `null` when the field is missing, not a string, or the
 * NativeModules property read throws.
 */
function readAndroidLocale(nm: NonNullable<RnModule['NativeModules']>): string | null {
  try {
    const id = nm.I18nManager?.localeIdentifier;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/**
 * Build a fresh {@link PlatformAdapter} populated from whatever the
 * lazy `require('react-native')` returns. Returns a self-labelling
 * `'unknown'` adapter when the native module is absent so tests and
 * Node hosts can run the rest of the SDK without crashing.
 *
 * `ramSizeMb` and `appVersion` always stay at their fallback
 * values: React Native does not expose total RAM or bundle version
 * through JS, so a host that wants real values must inject them via
 * `Keewano.init({ platform: ... })`.
 */
function defaultPlatformAdapter(): PlatformAdapter {
  const rn = tryRequireRn();
  const platform = rn?.Platform;
  const dims = tryGetScreenDimensions(rn);
  const os = resolveOs(platform) ?? UNKNOWN;
  const osVersionSource = platform?.Version ?? platform?.constants?.osVersion;
  return {
    os,
    osVersion: stringifyVersion(osVersionSource),
    deviceType: detectDeviceType(rn),
    // Stays 0 until a host plugin provides it: RN exposes no total RAM via JS. Unit is MB (the
    // RAM_SIZE wire payload is a uint32 MB count, not bytes).
    ramSizeMb: 0,
    // Physical pixels: RN Dimensions are density-independent points, so multiply by scale, keeping
    // full float precision until the multiply (411.43 dp x 2.625 = 1080 px exactly). Clamp at the
    // source so NaN/Infinity/negative from a bad shim cannot leak into the public snapshot.
    screenWidth: dims === undefined ? 0 : clampUint32(dims.width * dims.scale),
    screenHeight: dims === undefined ? 0 : clampUint32(dims.height * dims.scale),
    systemLanguage: detectLanguage(rn),
    // Sourced from the host bundle; injected via Keewano.init({ platform }) when unavailable.
    // Unset reads as the agreed literal rather than 'unknown', so a version-less
    // session is one the backend can tell apart from a real version cohort.
    appVersion: APP_VERSION_UNSPECIFIED,
  };
}

/**
 * Coerce `Platform.Version` (string on iOS, number on Android) into a
 * single string. Falls back to {@link UNKNOWN} when the value is
 * `undefined`.
 */
function stringifyVersion(version: string | number | undefined): string {
  if (typeof version === 'string') return version;
  if (typeof version === 'number') return String(version);
  return UNKNOWN;
}

export { defaultPlatformAdapter };
