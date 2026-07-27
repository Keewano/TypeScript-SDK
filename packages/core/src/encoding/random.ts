/**
 * Random byte generation for the SDK's identifiers.
 *
 * Uses `globalThis.crypto.getRandomValues` when the runtime provides it
 * (Node 19+, all modern browsers, and React Native hosts that ship or
 * polyfill Web Crypto). When it is absent - notably React Native /
 * Hermes, which does NOT expose a global `crypto.getRandomValues` even
 * on current versions unless the app adds `react-native-get-random-values`
 * - it falls back to a non-cryptographic RNG instead of throwing.
 *
 * The fallback is deliberate: these bytes only ever back analytics
 * identifiers (install / session UUIDs and scratch-file suffixes), where
 * uniqueness is the requirement and cryptographic unpredictability is
 * not. Degrading gracefully keeps the SDK install-and-go - a host does
 * not have to add a crypto polyfill just to boot - which is the whole
 * point of these identifiers.
 *
 * Internal helper - not re-exported from the encoding barrel or the
 * package root.
 *
 * @example
 * ```ts
 * const bytes = getSecureRandomBytes(16);
 * // bytes is a 16-byte Uint8Array of random data.
 * ```
 */

import { assertIntInRange } from './assertions';

/**
 * Allocate a buffer of `size` bytes filled with random data. Prefers
 * the platform's cryptographic RNG and falls back to a non-crypto RNG
 * when Web Crypto is unavailable (see module header for why that is
 * acceptable for the SDK's identifier use).
 *
 * @param size - Number of random bytes to generate. A value of `0`
 *               returns an empty buffer.
 * @returns A `Uint8Array` of the requested length, freshly allocated
 *          and populated with random bytes.
 * @throws RangeError when `size` is not a non-negative integer.
 */
function getSecureRandomBytes(size: number): Uint8Array {
  assertIntInRange({
    fnName: 'getSecureRandomBytes',
    max: Number.MAX_SAFE_INTEGER,
    min: 0,
    n: size,
  });

  const out = new Uint8Array(size);

  const crypto = globalThis.crypto as
    | { getRandomValues?: (b: Uint8Array) => Uint8Array }
    | undefined;
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(out);
    return out;
  }

  /**
   * No Web Crypto in this runtime. Fill from `Math.random` - non-crypto
   * by design (see module header): these bytes identify installs and
   * sessions for analytics, where collision-resistance, not
   * unpredictability, is what matters.
   */
  for (let i = 0; i < size; i += 1) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

export { getSecureRandomBytes };
