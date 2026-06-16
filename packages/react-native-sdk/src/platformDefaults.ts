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

import { clampUint32 } from './clamp';

/**
 * `require` is provided by the React Native / Node runtime but is
 * not part of the SDK's TypeScript lib set. Declared locally so
 * the per-package tsc and editors do not need `@types/node`
 * pulled in - mirrors the same local declaration in
 * `storage/helpers/loadNativeModules.ts`.
 */
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
    /**
     * CommonJS / ESM interop builds can expose the React Native API
     * BOTH on the top-level module and on `mod.default`. Aggressively
     * unwrapping `default` whenever it exists can throw away the real
     * top-level fields (Platform / Dimensions / NativeModules). Prefer
     * the top-level shape when it already looks like an RN module
     * and fall back to `default` only for the pure ESM-wrapped case.
     */
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
 * Read the full-screen dimensions from a React Native module, falling
 * back to `undefined` when the lookup throws. `Dimensions.get()` can
 * throw on SSR, partially-mocked test environments, or broken shims
 * that wire up the property but make `get` itself raise. The outer
 * `?.` chain catches missing keys but not a throw from `get` itself,
 * so a defensive wrap is needed to match the documented
 * safe-fallback contract.
 *
 * Reads the `'screen'` metrics (the whole display) rather than
 * `'window'` (the app's drawable area, which excludes the Android
 * status / navigation bars) to mirror Unity's `Screen.currentResolution`.
 * The `scale` (device pixel ratio) is returned alongside so the caller
 * can convert RN's density-independent points to the physical pixels
 * the wire protocol expects.
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
  /**
   * Validate the shape too. The outer try only catches throws; a
   * broken shim that returns `null`, a primitive, or an object
   * without numeric `width` / `height` would otherwise pass through
   * and crash the caller's `dims.width` deref. Falling back to
   * `undefined` matches the documented safe-default contract -
   * downstream `clampUint32(undefined)` then produces a 0.
   */
  if (dims === null || typeof dims !== 'object') return undefined;
  const candidate = dims as { width?: unknown; height?: unknown; scale?: unknown };
  if (typeof candidate.width !== 'number' || typeof candidate.height !== 'number') {
    return undefined;
  }
  /**
   * `scale` is the device pixel ratio. Default to 1 when a shim omits
   * it (or reports a non-positive value) so the points pass through
   * unscaled instead of collapsing the resolution to 0.
   */
  const scale = typeof candidate.scale === 'number' && candidate.scale > 0 ? candidate.scale : 1;
  return { width: candidate.width, height: candidate.height, scale };
}

/**
 * Resolve the OS identifier from the host's React Native module.
 * Prefers the top-level `Platform.OS` and falls back to the nested
 * `Platform.constants.systemName` (some RN hosts expose only the
 * latter). BOTH sources are lowercased so a host that writes
 * `'iOS'` / `'Android'` into `Platform.OS` (non-canonical but
 * possible) does not get misclassified as `'unknown'` downstream by
 * `detectDeviceType` / `detectLanguage`, which check `=== 'ios'` /
 * `=== 'android'`. Returns `undefined` when neither source is
 * available so callers can decide whether `'unknown'` is the right
 * sentinel for their field.
 */
function resolveOs(platform: RnPlatformLike | undefined): string | undefined {
  if (platform === undefined) return undefined;
  if (typeof platform.OS === 'string') return platform.OS.toLowerCase();
  const sysName = platform.constants?.systemName;
  if (typeof sysName === 'string') return sysName.toLowerCase();
  return undefined;
}

/**
 * Classify the host device into one of `'tv'` / `'tablet'` / `'phone'`
 * / `'desktop'` / `'unknown'`. The check order matters: `isTV` wins
 * over `isPad` so an Apple TV reports `'tv'` even when the underlying
 * iOS API would otherwise mark it as iPad-class. OS detection goes
 * through {@link resolveOs} so a host that exposes only the nested
 * `Platform.constants.systemName` still gets the right device class
 * (matching the `os` field on the resulting adapter).
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
 * Resolve the user's preferred locale. iOS exposes the locale through
 * `SettingsManager.settings.AppleLocale` (or `AppleLanguages[0]` when
 * the locale field is absent); Android exposes it through
 * `I18nManager.localeIdentifier`. Falls back to {@link UNKNOWN} when
 * none of the sources are present.
 *
 * Gated by {@link resolveOs} so a hybrid module (both `SettingsManager`
 * and `I18nManager` exposed - some custom RN forks, partially-stubbed
 * test envs) reads the locale from the source that matches the actual
 * platform, not the first source the lookup finds. When the OS is
 * unknown, falls back to the unordered scan (Apple sources first, then
 * I18nManager) so legacy hosts that do not expose `Platform.OS` still
 * get a non-`UNKNOWN` value.
 */
function detectLanguage(rn: RnModule | null): string {
  const nm = rn?.NativeModules;
  if (nm === undefined) return UNKNOWN;
  /**
   * Wrap the OS branch in try / catch matching the Dimensions.get
   * guard. Native modules expose JS getters that can throw on
   * partial mocks, lazy-init failures, or custom shims; without
   * the wrap, an exception in `SettingsManager.settings` /
   * `I18nManager.localeIdentifier` (or in `resolveOs` reading
   * Platform fields) would crash `init()` instead of falling back
   * to UNKNOWN.
   */
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
  /**
   * OS + version source order: top-level `Platform.OS` / `Platform.Version`
   * win when present; fall back to the nested `Platform.constants`
   * bag for hosts that only expose values there.
   */
  const os = resolveOs(platform) ?? UNKNOWN;
  const osVersionSource = platform?.Version ?? platform?.constants?.osVersion;
  return {
    os,
    osVersion: stringifyVersion(osVersionSource),
    deviceType: detectDeviceType(rn),
    /**
     * RN does not expose total RAM via JS; the field stays 0 until a
     * host plugin (e.g. expo-device) provides it via DI. Unit is
     * megabytes - the wire payload for RAM_SIZE is a uint32 count of
     * MB, not bytes.
     */
    ramSizeMb: 0,
    /**
     * Report PHYSICAL pixels to match Unity's `Screen.currentResolution`:
     * RN's `Dimensions` are density-independent points, so multiply by
     * the device pixel ratio (`scale`). The points are kept at full
     * float precision until this multiply, so e.g. 411.43 dp x 2.625 =
     * 1080 px exactly rather than rounding the points to 411 first.
     *
     * `Dimensions.get()` from a misbehaving shim can return `undefined`
     * fields or non-numeric values. Clamp at the source so NaN /
     * Infinity / negative width or height cannot leak into the public
     * `PlatformInfo` snapshot - the `initialEvents` writer would still
     * catch it via `clampUint16`, but the raw field is also read by
     * host code that inspects `info` directly for debug.
     */
    screenWidth: dims === undefined ? 0 : clampUint32(dims.width * dims.scale),
    screenHeight: dims === undefined ? 0 : clampUint32(dims.height * dims.scale),
    systemLanguage: detectLanguage(rn),
    /**
     * App version is sourced from the host bundle; tests / hosts
     * without expo-application pass it explicitly through
     * `Keewano.init({ platform })`.
     */
    appVersion: UNKNOWN,
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
