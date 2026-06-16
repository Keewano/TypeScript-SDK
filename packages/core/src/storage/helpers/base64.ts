/**
 * Binary <-> base64 conversion helpers used by the file-pool side of
 * `StorageAdapter` implementations. Prefer the runtime's `btoa` / `atob`
 * when present; fall back to a pure-JS implementation for Hermes builds
 * without the Web platform shim.
 *
 * @example
 * ```ts
 * const b64 = bytesToBase64(new Uint8Array([1, 2, 3]));
 * const back = base64ToBytes(b64);
 * ```
 */

const BYTES_TO_BASE64_CHUNK = 0x8000;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encode a `Uint8Array` to a base64 string. Walks the buffer in 32 KB
 * slices to avoid the quadratic string growth that per-byte `+=`
 * concatenation produces on engines that do not optimize cons-strings.
 */
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += BYTES_TO_BASE64_CHUNK) {
      const chunk = bytes.subarray(i, i + BYTES_TO_BASE64_CHUNK);
      /**
       * Per-byte fill instead of `String.fromCodePoint(...chunk)`: the
       * spread form can exceed engine argument limits on Hermes / JSC
       * for the 32 KB chunk size used here.
       */
      const chars = new Array<string>(chunk.length);
      for (let j = 0; j < chunk.length; j++) {
        chars[j] = String.fromCodePoint(chunk[j] as number);
      }
      parts.push(chars.join(''));
    }
    return globalThis.btoa(parts.join(''));
  }

  /**
   * Pure-JS fallback (no `btoa`). Walk 3 input bytes -> 4 base64 chars,
   * padding the tail with `=`. Accumulated into an array and joined
   * once so the encoder stays linear for multi-MB file-pool writes.
   */
  const fallbackParts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);

    fallbackParts.push(
      BASE64_ALPHABET[(triple >> 18) & 0x3f] as string,
      BASE64_ALPHABET[(triple >> 12) & 0x3f] as string,
      b === undefined ? '=' : (BASE64_ALPHABET[(triple >> 6) & 0x3f] as string),
      c === undefined ? '=' : (BASE64_ALPHABET[triple & 0x3f] as string),
    );
  }
  return fallbackParts.join('');
}

/**
 * Strip and validate the trailing `=` padding the same way native
 * `atob` does. Returns the body portion with padding removed.
 */
function stripBase64Padding(b64: string): string {
  /**
   * Explicit slice (not regex) so the linear-time guarantee is obvious
   * to static analyzers - `=+$` is safe in ECMAScript engines but SAST
   * tools tend to flag it.
   */
  let endIdx = b64.length;
  while (endIdx > 0 && b64.codePointAt(endIdx - 1) === 0x3d /* '=' */) {
    endIdx -= 1;
  }
  /**
   * Padding shape rules: at most two `=` AND, when padding is present,
   * the whole input must be a multiple of 4 chars. Rejects `TQ=`
   * (3 chars total) and `TQ===` (3 padding chars).
   */
  const padding = b64.length - endIdx;
  if (padding > 2 || (padding > 0 && b64.length % 4 !== 0)) {
    throw new Error('base64ToBytes: invalid base64 input');
  }
  const normalized = b64.substring(0, endIdx);
  /**
   * A single trailing 6-bit group cannot carry any whole byte, so
   * `length % 4 === 1` is unambiguous garbage.
   */
  if (normalized.length % 4 === 1) {
    throw new Error('base64ToBytes: invalid base64 input');
  }
  return normalized;
}

/**
 * Pure-JS RFC 4648 base64 decoder used when `globalThis.atob` is
 * unavailable. Trusts its input: `base64ToBytes` performs all
 * alphabet / padding / trailing-bit validation before invoking.
 */
function fallbackBase64Decode(b64: string): Uint8Array {
  const normalized = stripBase64Padding(b64);
  const out = new Uint8Array(Math.floor((normalized.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let offset = 0;

  for (const ch of normalized) {
    buffer = (buffer << 6) | BASE64_ALPHABET.indexOf(ch);
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out[offset++] = (buffer >> bits) & 0xff;
    }
  }

  return offset === out.length ? out : out.subarray(0, offset);
}

/**
 * Decode a base64 string into a `Uint8Array`. Counterpart of
 * {@link bytesToBase64}. Pre-validates padding + alphabet + trailing
 * bits, then delegates to `globalThis.atob` when available or to the
 * pure-JS fallback otherwise. Pre-validating before `atob` keeps
 * behavior consistent across runtimes that differ in strictness.
 *
 * @throws Error when the input contains a character outside the
 *   standard base64 alphabet, has malformed padding, or carries a
 *   length residue that no canonical base64 string can produce.
 */
function base64ToBytes(b64: string): Uint8Array {
  /**
   * Pre-strip padding and validate alphabet so both decode paths see
   * the same canonical body.
   */
  const normalized = stripBase64Padding(b64);
  let lastValue = 0;
  for (const ch of normalized) {
    const value = BASE64_ALPHABET.indexOf(ch);
    if (value < 0) {
      throw new Error('base64ToBytes: invalid base64 input');
    }
    lastValue = value;
  }
  /**
   * Trailing low-bit invariant native `atob` is allowed to skip:
   * remainder 2 (1 payload byte) requires low 4 bits == 0; remainder 3
   * (2 payload bytes) requires low 2 bits == 0. Catches inputs like
   * `AC` that decode silently on some runtimes.
   */
  const remainder = normalized.length % 4;
  if (
    (remainder === 2 && (lastValue & 0x0f) !== 0) ||
    (remainder === 3 && (lastValue & 0x03) !== 0)
  ) {
    throw new Error('base64ToBytes: invalid base64 input');
  }

  if (typeof globalThis.atob !== 'function') {
    return fallbackBase64Decode(b64);
  }

  /**
   * Re-pad to a canonical 4-char-aligned form so the native decoder
   * sees a shape it accepts on every host.
   */
  const padding = (4 - remainder) % 4;
  const padded = padding === 0 ? normalized : normalized + '='.repeat(padding);
  const binary = globalThis.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    /**
     * Loop guard keeps `i` inside the string, so `codePointAt` never
     * returns undefined here; the non-null assertion is safe.
     */
    bytes[i] = binary.codePointAt(i)!;
  }
  return bytes;
}

export { base64ToBytes, bytesToBase64 };
