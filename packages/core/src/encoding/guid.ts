/**
 * GUID codec using a mixed-endian 16-byte layout:
 *
 *   bytes 0-3  = Data1 (uint32) little-endian
 *   bytes 4-5  = Data2 (uint16) little-endian
 *   bytes 6-7  = Data3 (uint16) little-endian
 *   bytes 8-15 = Data4 (byte[8]) sequential
 *
 * The string form ("D" format, lowercase, hyphenated) is used in HTTP
 * headers; the binary form is used inside batch payloads.
 *
 * @example
 * ```ts
 * guidToBytes('aabbccdd-eeff-0011-2233-445566778899');
 * // [0xDD, 0xCC, 0xBB, 0xAA, 0xFF, 0xEE, 0x11, 0x00,
 * //  0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99]
 * ```
 */

import { assertUint8Array } from './assertions';
import { getSecureRandomBytes } from './random';

const GUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Reverse the three little-endian byte groups in a 16-byte GUID buffer
 * in place. Symmetric: applying it twice restores the original layout.
 *
 * @param buf - 16-byte GUID buffer to swap in place.
 */
function swapMixedEndianGroups(buf: Uint8Array): void {
  buf.subarray(0, 4).reverse();
  buf.subarray(4, 6).reverse();
  buf.subarray(6, 8).reverse();
}

/**
 * Format a single byte as a two-digit LOWERCASE hex string.
 *
 * The canonical GUID "D" form is lowercase, so this helper does not
 * uppercase the output. Test code uses a sibling `byteToHex` in
 * `__tests__/_helpers.ts` that returns uppercase - the two are
 * intentionally not shared because their casing semantics differ.
 *
 * @param byte - Byte value in `[0, 255]`.
 * @returns Two-character lowercase hex string (for example `ab`).
 */
function byteToHex(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

/**
 * Stamp the RFC 4122 version-4 marker bits into a 16-byte buffer in place.
 *
 * @param bytes - 16-byte buffer to mutate. Bytes 7 and 8 are rewritten;
 *                all other bytes are left untouched.
 */
function applyV4MarkerBits(bytes: Uint8Array): void {
  // RFC 4122 v4 marker bits, in mixed-endian byte order:

  // byte 7 high nibble = 4 (version)
  bytes[7] = (bytes[7]! & 0x0f) | 0x40;
  // byte 8 high bits = 10 (variant)
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
}

/**
 * Encode a GUID string into 16 bytes using the mixed-endian layout
 * documented at the top of this module.
 *
 * @param guidStr - GUID in canonical "D" form `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.
 *                  Case-insensitive on input; mixed case is allowed.
 * @returns Freshly allocated 16-byte buffer in mixed-endian layout.
 * @throws TypeError when the string does not match the GUID format.
 */
function guidToBytes(guidStr: string): Uint8Array {
  if (typeof guidStr !== 'string' || !GUID_REGEX.test(guidStr)) {
    throw new TypeError(`guidToBytes: invalid GUID ${String(guidStr)}`);
  }

  const hex = guidStr.split('-').join('').toLowerCase();
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  swapMixedEndianGroups(bytes);
  return bytes;
}

/**
 * Decode 16 mixed-endian GUID bytes into the canonical lowercase
 * "D" string form.
 *
 * @param bytes - 16-byte buffer in mixed-endian layout. The buffer is
 *                NOT mutated - a local copy is made before swapping.
 * @returns Lowercase hyphenated GUID string (canonical "D" form).
 * @throws TypeError when `bytes` is not a 16-byte `Uint8Array`.
 */
function guidBytesToString(bytes: Uint8Array): string {
  assertUint8Array({
    expectedLength: 16,
    fnName: 'guidBytesToString',
    value: bytes,
  });

  // Copy so we do not mutate the caller's buffer.
  const tmp = new Uint8Array(bytes);
  swapMixedEndianGroups(tmp);

  const hex = Array.from(tmp, byteToHex).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Generate a random version-4 GUID using a cryptographically secure RNG.
 *
 * Requires `globalThis.crypto.getRandomValues`, available in Node 19+,
 * all modern browsers, and React Native 0.71+. Older React Native
 * environments must install the `react-native-get-random-values`
 * polyfill and import it before the SDK is used.
 *
 * @returns Lowercase hyphenated GUID string (canonical "D" form, RFC 4122 v4).
 * @throws Error when the cryptographic RNG is not available.
 */
function newGuid(): string {
  const bytes = getSecureRandomBytes(16);
  applyV4MarkerBits(bytes);
  return guidBytesToString(bytes);
}

export { guidBytesToString, guidToBytes, newGuid };
