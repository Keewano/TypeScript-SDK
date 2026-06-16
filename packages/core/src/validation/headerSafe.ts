/**
 * Shared predicates for strings that will travel verbatim in an HTTP
 * header value (`K-Token`, `K-Tester`, ...). The Fetch spec restricts
 * header values to ByteString (code points 0x00-0xFF) and forbids
 * ASCII control characters; a string that fails either check crashes
 * the request constructor mid-send. Every producer of a header-bound
 * string (the transport boundary, the dispatcher's test-user marker,
 * the identity persistence layer, the public facade) rejects bad input
 * up front through these predicates so the failure surfaces as a clean
 * `TypeError` at the call site instead of deep inside `fetch`.
 *
 * Pure leaf module with no dependencies, so every layer can import it
 * without a circular reference.
 */

/**
 * `true` when `code` is an ASCII control character: the C0 range
 * (0x00-0x1F) or DEL (0x7F). Both are illegal in an HTTP header value.
 */
function isControlCharCode(code: number | undefined): boolean {
  return code !== undefined && (code < 0x20 || code === 0x7f);
}

/**
 * `true` when `code` does not fit in a single byte (> 0xFF), i.e. it is
 * not a valid ByteString code point.
 */
function isNonByteStringCharCode(code: number | undefined): boolean {
  return code !== undefined && code > 0xff;
}

/** `true` when any character of `value` is an ASCII control character. */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    if (isControlCharCode(ch.codePointAt(0))) return true;
  }
  return false;
}

/**
 * `true` when every character of `value` fits in a single byte
 * (0x00-0xFF), i.e. the whole string is a valid ByteString. Multi-byte
 * Unicode (Cyrillic, emoji) fails.
 */
function isByteString(value: string): boolean {
  for (const ch of value) {
    if (isNonByteStringCharCode(ch.codePointAt(0))) return false;
  }
  return true;
}

export { hasControlChar, isByteString, isControlCharCode, isNonByteStringCharCode };
