/**
 * Lazy loader for the native module `expo-file-system`. Kept out of the
 * adapter's import block so the native bindings are not resolved until
 * an `ExpoStorageAdapter` is actually instantiated without a test
 * override - host applications that never construct the adapter pay no
 * startup cost.
 *
 * Not exercised by unit tests because the native module is not
 * installed in the jest runtime; the adapter tests always pass a mock
 * override instead.
 */

import type { ExpoFileSystemLike } from '../types/expoStorageAdapter';

/**
 * `require` is provided by the React Native / Node runtime but is not
 * part of the SDK's TypeScript lib set. Declared locally so the
 * per-package tsc and editors do not need `@types/node` pulled in.
 */
declare const require: (id: string) => unknown;

/**
 * Unwrap the CommonJS / ESM interop shape (`{ default: ... }` vs the
 * direct module object) that varies across Metro, Jest, and build
 * tooling.
 */
function unwrapDefault<T>(mod: T | { default: T }): T {
  return mod !== null && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
}

/**
 * `true` when a resolved module exposes the legacy file-system API the
 * adapter depends on. `documentDirectory` is a defined property in the
 * legacy API (string or null) and absent from the Expo SDK 54+ root
 * export, which switched to the object-oriented `File` / `Directory`
 * API - so its presence is the reliable discriminator.
 */
function hasLegacyFileSystemApi(mod: unknown): mod is ExpoFileSystemLike {
  return mod !== null && typeof mod === 'object' && 'documentDirectory' in mod;
}

/**
 * Resolve the legacy `expo-file-system` API at first call across Expo
 * SDK versions.
 *
 * Through SDK 53 the legacy API (`documentDirectory`, `writeAsStringAsync`,
 * ...) is the package root. SDK 54+ moved the new object-oriented API
 * to the root and relocated the legacy API to `expo-file-system/legacy`.
 * Try the root first (covers older SDKs and any host that aliases the
 * legacy API back to the root), and fall back to the `/legacy` entry
 * point when the root no longer carries the legacy surface.
 *
 * The `/legacy` subpath does not exist before SDK 54, so its `require`
 * is wrapped in try / catch: that marks it an OPTIONAL dependency for
 * Metro (`allowOptionalDependencies`), which would otherwise fail the
 * whole bundle at build time on SDK <= 53 where the path is absent -
 * even though the runtime never reaches it there (the root carries the
 * legacy API and returns first).
 */
/* istanbul ignore next */
function loadFileSystem(): ExpoFileSystemLike {
  const root = unwrapDefault(
    require('expo-file-system') as ExpoFileSystemLike | { default: ExpoFileSystemLike },
  );
  if (hasLegacyFileSystemApi(root)) {
    return root;
  }
  let legacy: unknown;
  try {
    legacy = unwrapDefault(
      require('expo-file-system/legacy') as ExpoFileSystemLike | { default: ExpoFileSystemLike },
    );
  } catch {
    legacy = undefined;
  }
  if (hasLegacyFileSystemApi(legacy)) {
    return legacy;
  }
  throw new Error(
    'ExpoStorageAdapter: expo-file-system is installed but exposes neither the legacy API at its root nor at "expo-file-system/legacy". Install a supported expo-file-system version or pass a custom fileSystem to the adapter.',
  );
}

export { loadFileSystem };
