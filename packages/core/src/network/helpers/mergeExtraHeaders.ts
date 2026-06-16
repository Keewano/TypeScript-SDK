/**
 * Merge caller-supplied extra HTTP headers into the reserved set a
 * transport function builds. Used so a host can attach an auth header
 * (for example `Authorization: Bearer <token>` to clear an
 * identity-aware proxy in front of a staging endpoint) without the
 * transport hard-coding it.
 *
 * Two invariants:
 *   1. Reserved headers always win. An extra header whose name
 *      case-insensitively matches a reserved one (K-Token, Content-*,
 *      etc.) is dropped, so a caller cannot override the API key or
 *      the content negotiation the wire format depends on.
 *   2. Every extra name and value is validated as header-safe (no
 *      control chars, ByteString only). A hostile provider returning
 *      a value with an embedded CRLF cannot smuggle a second header.
 */

import { hasControlChar, isByteString } from '../../validation';

/**
 * Args for {@link mergeExtraHeaders}.
 *
 * reserved - Headers the transport built; these always win a collision.
 * extra - Caller-supplied headers, or `undefined` for none.
 * fnName - Owning function name, used as the thrown-error prefix.
 */
interface MergeExtraHeadersArgs {
  reserved: Record<string, string>;
  extra: Record<string, string> | undefined;
  fnName: string;
}

/** A header name must be non-empty and free of control / non-ByteString chars. */
function isUnsafeHeaderName(name: string): boolean {
  return name.length === 0 || hasControlChar(name) || !isByteString(name);
}

function mergeExtraHeaders({
  reserved,
  extra,
  fnName,
}: MergeExtraHeadersArgs): Record<string, string> {
  if (extra == null) return reserved;
  const reservedLower = new Set(Object.keys(reserved).map((name) => name.toLowerCase()));
  const merged: Record<string, string> = {};
  for (const name of Object.keys(extra)) {
    const value = extra[name];
    if (isUnsafeHeaderName(name)) {
      throw new TypeError(`${fnName}: invalid extra header name`);
    }
    /**
     * The `value === undefined` arm both rejects a hole under
     * `noUncheckedIndexedAccess` and narrows `value` to `string` for
     * the assignment below. A value may be empty but never carry a
     * control char or a non-ByteString code point.
     */
    if (value === undefined || hasControlChar(value) || !isByteString(value)) {
      throw new TypeError(`${fnName}: invalid extra header value`);
    }
    /** Reserved headers win: drop a case-insensitive collision. */
    if (reservedLower.has(name.toLowerCase())) continue;
    merged[name] = value;
  }
  /** Spread reserved last so a missed collision still resolves their way. */
  return { ...merged, ...reserved };
}

export type { MergeExtraHeadersArgs };
export { mergeExtraHeaders };
