/**
 * Default `LoadRn` implementation: lazily resolves the host's
 * `react-native` module via `require`. Returns `null` when the
 * module is absent (Node test runner without an RN install).
 *
 * The helper is intentionally NOT module-scoped on its result so
 * tests that mock `require('react-native')` per-test see the fresh
 * mock each time `attach()` runs. This mirrors the safe-fallback
 * pattern in `platformDefaults.ts`.
 */
import type { RnApi } from './types/rn';

/**
 * `require` is provided by the React Native / Node runtime but is
 * not part of the SDK's TypeScript lib set. Declared locally so
 * the per-package tsc and editors do not need `@types/node` pulled
 * in - mirrors the same local declaration in `platformDefaults.ts`.
 */
declare const require: (id: string) => unknown;

/**
 * Resolve `require('react-native')` and unwrap the CJS / ESM-interop
 * shapes. Returns `undefined` on resolution failure (module absent /
 * broken shim).
 *
 * Excluded from coverage because the success path requires the
 * native module to be present on disk, which is not the case in the
 * Jest sandbox.
 */
/* istanbul ignore next */
function defaultLoadRn(): RnApi | undefined {
  try {
    const mod = require('react-native') as RnApi & { default?: RnApi };
    if (
      mod.Platform !== undefined ||
      mod.AppState !== undefined ||
      mod.BackHandler !== undefined ||
      mod.Linking !== undefined ||
      mod.Pressable !== undefined
    ) {
      return mod;
    }
    if (mod.default !== undefined) {
      return mod.default;
    }
    return mod;
  } catch {
    return undefined;
  }
}

export { defaultLoadRn };
