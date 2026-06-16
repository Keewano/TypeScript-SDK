/**
 * FNV-1a 32-bit non-cryptographic hash.
 *
 * Used by the custom-events sub-protocol to derive a stable version
 * stamp from the serialized event map; the server compares this stamp
 * against its registry to decide whether a new map needs uploading.
 *
 * The implementation uses `Math.imul` for 32-bit multiplication with
 * wrap-around, since native JS multiplication promotes operands to
 * float64 and silently drops the overflow bits.
 *
 * @example
 * ```ts
 * fnv1a32(new TextEncoder().encode('foobar'));     // 0xBF9CF968
 * fnv1a32(new Uint8Array());                       // 0x811C9DC5
 * ```
 */

import { assertUint8Array } from './assertions';

/**
 * Canonical FNV-1a 32-bit constants from the algorithm specification.
 *
 * OFFSET_BASIS - Decimal 2166136261, the initial hash value.
 * PRIME - Decimal 16777619, the multiplier applied per byte.
 */
const FNV1A_32 = {
  OFFSET_BASIS: 0x811c9dc5,
  PRIME: 0x01000193,
} as const;

/**
 * Compute the FNV-1a 32-bit hash of the input bytes.
 *
 * @param bytes - Input buffer to hash. Empty input is valid and returns
 *                the FNV-1a offset basis (`0x811C9DC5`).
 * @returns Unsigned 32-bit hash value.
 * @throws TypeError when `bytes` is not a `Uint8Array`.
 */
function fnv1a32(bytes: Uint8Array): number {
  assertUint8Array({
    fnName: 'fnv1a32',
    value: bytes,
  });

  let hash = FNV1A_32.OFFSET_BASIS;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, FNV1A_32.PRIME) >>> 0;
  }

  return hash;
}

export { fnv1a32, FNV1A_32 };
