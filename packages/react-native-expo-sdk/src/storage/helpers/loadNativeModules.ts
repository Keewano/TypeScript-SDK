/**
 * Lazy loader for the native module `expo-file-system`. Kept out of the
 * adapter's import block so the native bindings are not resolved until
 * an `ExpoStorageAdapter` is actually instantiated without a test
 * override - host applications that never construct the adapter pay no
 * startup cost.
 */

import type { ExpoFileSystemLike } from '../types/expoStorageAdapter';

import { StorageUnavailableError } from './errors';

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
 * Both `require` calls are wrapped in try / catch: that marks them
 * OPTIONAL dependencies for Metro (`allowOptionalDependencies`), which
 * would otherwise fail the whole bundle at build time where a path is
 * absent - the `/legacy` subpath does not exist before SDK 54, and the
 * root package is absent on a host without `expo-file-system`.
 *
 * Both failures degrade rather than throw: an absent package and a
 * version that dropped the legacy API from both entry points are
 * equally out of the host's control at runtime, and an SDK upgrade
 * must never turn a survivable degradation into a rejected `init`.
 * The message distinguishes them so the console says which one it is.
 */
function loadFileSystem(): ExpoFileSystemLike {
  let rootModule: unknown;
  /**
   * `require` both resolves and evaluates, so this catch sees an
   * absent package and a package whose own top-level code threw. Both
   * degrade, because neither is something the host can act on at
   * runtime and an SDK upgrade must not reject `init`. They are not
   * the same diagnosis, though, and the message names only the common
   * one - so the original failure travels as `cause`, or a module that
   * crashed while loading would reach the developer as "not
   * installed" and send them after a package that is right there.
   */
  try {
    rootModule = require('expo-file-system');
  } catch (error) {
    throw new StorageUnavailableError('ExpoStorageAdapter: expo-file-system not installed', {
      cause: error,
    });
  }
  const root = unwrapDefault(rootModule as ExpoFileSystemLike | { default: ExpoFileSystemLike });
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
  throw new StorageUnavailableError(
    'ExpoStorageAdapter: unsupported expo-file-system version (legacy API missing)',
  );
}

export { loadFileSystem };
