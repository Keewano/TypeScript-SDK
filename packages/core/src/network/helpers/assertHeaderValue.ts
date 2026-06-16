/**
 * Boundary guard for any string value the transport layer copies
 * verbatim into an HTTP header (`K-Token`, `K-Tester`, etc.).
 * Rejects the four malformed shapes that would otherwise be
 * collapsed into a `false` transport return inside the `fetch`
 * try / catch, hiding a permanent configuration bug behind what
 * looks like a transient retry:
 *
 *   - Empty string when the field is required (e.g. apiKey). An
 *     empty token would yield 401 / 403 on every send; the SDK
 *     would retry forever against a value that cannot authenticate.
 *   - Surrounding whitespace. Almost always a copy-paste mistake
 *     in the host config. The server sees the verbatim value (not
 *     trimmed), so a leading space silently changes which token
 *     the server is asked to recognise.
 *   - ASCII control characters (0x00-0x1F plus 0x7F). CR / LF
 *     embedded in the value let an attacker splice extra headers
 *     into the outgoing request. The `fetch` Headers validator
 *     would also reject these, but only AFTER the value reached
 *     the transport - too late to surface as a clean TypeError.
 *   - Non-ByteString characters (code point > 0xFF). HTTP header
 *     values are restricted to ByteString per the Fetch spec;
 *     multi-byte Unicode (Cyrillic, emoji, etc.) fails header
 *     validation. Reject up front instead of letting the request
 *     fail mid-send.
 */

import { isControlCharCode, isNonByteStringCharCode } from '../../validation';

interface AssertHeaderValueArgs {
  value: string;
  fnName: string;
  field: string;
  allowEmpty: boolean;
}

function assertHeaderValue(args: AssertHeaderValueArgs): void {
  const { value, fnName, field, allowEmpty } = args;
  /*
   * Runtime guard for JS callers that bypass the `value: string`
   * TS signature (e.g., legacy hosts, untyped configs). Without
   * it, `null.length` or `(42).trim()` would still throw a
   * TypeError, but with an internal stack trace and a message
   * that does not identify the offending field. Surface a clean
   * boundary error instead.
   */
  if (typeof value !== 'string') {
    throw new TypeError(`${fnName}: ${field} is not a string`);
  }
  if (value.length === 0) {
    if (allowEmpty) return;
    throw new TypeError(`${fnName}: empty ${field}`);
  }
  if (value !== value.trim()) {
    throw new TypeError(`${fnName}: ${field} has surrounding whitespace`);
  }
  const chars = Array.from(value);
  if (chars.some((char) => isControlCharCode(char.codePointAt(0)))) {
    throw new TypeError(`${fnName}: ${field} contains control character`);
  }
  if (chars.some((char) => isNonByteStringCharCode(char.codePointAt(0)))) {
    throw new TypeError(`${fnName}: ${field} contains non-ByteString character`);
  }
}

export type { AssertHeaderValueArgs };
export { assertHeaderValue };
