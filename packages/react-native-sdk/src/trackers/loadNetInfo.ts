/**
 * Default `loadNetInfo`: lazily resolves
 * `@react-native-community/netinfo` via `require`. Returns `null`
 * when the optional peer dependency is not installed.
 *
 * The unwrap mirrors `loadRn.ts`: prefer the top-level CJS shape
 * when it already exposes `addEventListener`, fall back to the
 * `default` field for pure ESM-wrapped modules.
 */
import type { NetInfoLike } from './types/NetworkTracker';

declare const require: (id: string) => unknown;

/**
 * Resolve `require('@react-native-community/netinfo')`. Returns
 * `null` on resolution failure (peer not installed / broken shim).
 *
 * Excluded from coverage because the success path requires the
 * optional peer to be on disk, which is not the case in the Jest
 * sandbox.
 */
/* istanbul ignore next */
function defaultLoadNetInfo(): NetInfoLike | null {
  try {
    const mod = require('@react-native-community/netinfo') as NetInfoLike & {
      default?: NetInfoLike;
    };
    if (typeof mod.addEventListener === 'function') return mod;
    if (mod.default !== undefined && typeof mod.default.addEventListener === 'function') {
      return mod.default;
    }
    return null;
  } catch {
    return null;
  }
}

export { defaultLoadNetInfo };
