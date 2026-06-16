/**
 * Subset of React Native's `Platform.constants` bag that the lazy
 * loader inspects. Some RN hosts expose `systemName` / `osVersion`
 * through this nested bag instead of the top-level fields, so we
 * accept both.
 *
 * systemName - OS name ('iOS', 'Android', ...).
 * osVersion - OS version string ('17.4.1', '13', ...).
 */
interface RnPlatformConstantsLike {
  systemName?: string;
  osVersion?: string;
}

/**
 * Subset of React Native's `Platform` module that the lazy loader
 * inspects. Kept narrow so the SDK does not depend on
 * `@types/react-native` to compile.
 *
 * OS - String identifier emitted as the PLATFORM event payload
 *   (`'ios'` / `'android'` / `'web'` / etc.).
 * Version - Either the iOS string (`'17.4.1'`) or the Android API
 *   level number (`34`). The loader stringifies before emitting.
 * isPad - iPad / tablet flag set by `Platform.isPad` on iOS.
 * isTV - Apple TV / Android TV flag set by `Platform.isTV`.
 * isTesting - Test-runner flag set by `Platform.isTesting`. Not
 *   currently read by the loader but kept on the shape for future
 *   tester-aware behavior.
 * constants - Optional `Platform.constants` bag.
 */
interface RnPlatformLike {
  OS?: string;
  Version?: string | number;
  isPad?: boolean;
  isTV?: boolean;
  isTesting?: boolean;
  constants?: RnPlatformConstantsLike;
}

/**
 * Window / screen size pair returned by `Dimensions.get`. The loader
 * floors both values to integers before emitting them as uint16
 * SCREEN_RESOLUTION payload fields.
 *
 * width - Pixel width as float (may be fractional on web hosts).
 * height - Pixel height as float.
 */
interface RnDimensions {
  width: number;
  height: number;
}

/**
 * Subset of React Native's `Dimensions` module that the lazy loader
 * inspects.
 *
 * get - Reads the current window or screen dimensions. The loader
 *   passes `'window'` and floors the returned values for the
 *   SCREEN_RESOLUTION event payload.
 */
interface RnDimensionsLike {
  get?: (target: 'window' | 'screen') => RnDimensions;
}

/**
 * iOS-side locale source: `NativeModules.SettingsManager.settings`.
 * The loader prefers `AppleLocale`; falls back to the first entry of
 * `AppleLanguages`.
 *
 * AppleLocale - User's locale identifier ('en_US', 'uk_UA', ...).
 * AppleLanguages - Ordered preferred-languages list; only the first
 *   entry is read.
 */
interface RnAppleSettingsLike {
  AppleLocale?: string;
  AppleLanguages?: ReadonlyArray<string>;
}

/**
 * iOS `SettingsManager` native module wrapper.
 *
 * settings - User-settings bag (see {@link RnAppleSettingsLike}).
 */
interface RnSettingsManagerLike {
  settings?: RnAppleSettingsLike;
}

/**
 * Android `I18nManager` native module wrapper.
 *
 * localeIdentifier - User's locale identifier ('en_US', 'uk_UA', ...).
 */
interface RnI18nManagerLike {
  localeIdentifier?: string;
}

/**
 * Subset of `NativeModules` that the lazy loader reads to resolve
 * the SYSTEM_LANG event payload.
 *
 * SettingsManager - iOS native module exposing locale settings.
 * I18nManager - Android native module exposing locale identifier.
 */
interface RnNativeModulesLike {
  SettingsManager?: RnSettingsManagerLike;
  I18nManager?: RnI18nManagerLike;
}

/**
 * Top-level shape of the resolved `require('react-native')` value,
 * narrowed to the three fields the loader inspects.
 *
 * Platform - See {@link RnPlatformLike}.
 * Dimensions - See {@link RnDimensionsLike}.
 * NativeModules - See {@link RnNativeModulesLike}.
 */
interface RnModule {
  Platform?: RnPlatformLike;
  Dimensions?: RnDimensionsLike;
  NativeModules?: RnNativeModulesLike;
}

export type {
  RnAppleSettingsLike,
  RnDimensions,
  RnDimensionsLike,
  RnI18nManagerLike,
  RnModule,
  RnNativeModulesLike,
  RnPlatformConstantsLike,
  RnPlatformLike,
  RnSettingsManagerLike,
};
