/**
 * Expo platform adapter. Starts from the bare-RN defaults (OS, device
 * type, screen size and language, all read from react-native) and fills
 * in the one field react-native cannot expose through JS: the host app
 * version. Every Expo app ships `expo-constants`, so the version is
 * available install-and-go - the host neither wires a custom adapter
 * nor adds a peer dependency of its own.
 *
 * Anything expo-constants cannot supply (total RAM) stays at the
 * bare-RN fallback; a host that wants those still injects a fuller
 * adapter via `Keewano.init({ platform })`.
 */

import type { PlatformAdapter } from '@keewano/react-native-sdk';

import { defaultPlatformAdapter } from '@keewano/react-native-sdk';

declare const require: (id: string) => unknown;

/**
 * Read `expoConfig.version` (the app.json version, with the legacy
 * `manifest.version` as a fallback) from expo-constants. Returns `null`
 * when the module or field is absent or not a non-empty string, so the
 * caller keeps the bare-RN `'unknown'` fallback.
 *
 * Wrapped in try/catch so a host that somehow lacks the module degrades
 * instead of crashing boot. expo-constants is present in every real
 * Expo app, so the require resolves there and never reaches Metro's
 * missing-module path. Excluded from coverage because the success path
 * needs the native module on disk, which the Jest sandbox lacks; the
 * pure adapter logic is exercised through the injection point below.
 */
/* istanbul ignore next */
function defaultReadAppVersion(): string | null {
  try {
    const mod = require('expo-constants') as { default?: unknown };
    const constants = (mod.default ?? mod) as {
      expoConfig?: { version?: unknown };
      manifest?: { version?: unknown };
    };
    const version = constants.expoConfig?.version ?? constants.manifest?.version;
    return typeof version === 'string' && version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

/**
 * Build the Expo {@link PlatformAdapter}: the bare-RN defaults plus a
 * real `appVersion` from expo-constants when one is readable.
 *
 * @param readAppVersion - App-version source. Defaults to the
 *   expo-constants reader; tests inject a stub.
 */
function expoPlatformAdapter(
  readAppVersion: () => string | null = defaultReadAppVersion,
): PlatformAdapter {
  const base = defaultPlatformAdapter();
  const appVersion = readAppVersion();
  return appVersion === null ? base : { ...base, appVersion };
}

export { expoPlatformAdapter };
