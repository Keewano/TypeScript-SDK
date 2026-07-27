/**
 * Internal argument-validation helpers shared across the encoding
 * primitives. Deliberately not re-exported from the encoding barrel
 * or the package root - they exist to give the public primitives
 * (`writeVarintU`, `BinaryStream`, `fnv1a32`, UUID codec) a consistent
 * way to throw on invalid input without leaking internals into the
 * SDK surface.
 *
 * Each helper:
 *   - Throws `RangeError` for out-of-range numeric values.
 *   - Throws `TypeError` for unexpected runtime types.
 *   - Embeds the caller's `fnName` in the error message so that thrown
 *     errors point at the actual SDK entry point, not at this file.
 *
 * @example
 * ```ts
 * function writeUint8(n: number): void {
 *   assertIntInRange({ fnName: 'writeUint8', max: 0xff, min: 0, n });
 *   // ... actual write logic
 * }
 * ```
 */

import type {
  AssertIntInRangeArgs,
  AssertNonZeroBytesArgs,
  AssertUint8ArrayArgs,
} from './types/assertions';

/**
 * Throw `TypeError` unless `value` is a `Uint8Array` of the expected length.
 *
 * @param value - Value to validate.
 * @param fnName - Caller name embedded in the thrown error message.
 * @param expectedLength - Optional exact byte-length to enforce.
 * @throws TypeError when `value` is not a `Uint8Array` or its length differs
 *   from `expectedLength` (when provided).
 */
function assertUint8Array({ value, fnName, expectedLength }: AssertUint8ArrayArgs): void {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${fnName}: not a Uint8Array`);
  }
  if (expectedLength !== undefined && value.length !== expectedLength) {
    throw new TypeError(`${fnName}: length ${value.length} != ${expectedLength}`);
  }
}

/**
 * Throw `RangeError` unless `n` is an integer in `[min, max]`.
 *
 * @param n - Value to validate.
 * @param min - Lower bound, inclusive.
 * @param max - Upper bound, inclusive.
 * @param fnName - Caller name embedded in the thrown error message.
 * @throws RangeError when `n` fails any constraint.
 */
function assertIntInRange({ n, min, max, fnName }: AssertIntInRangeArgs): void {
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new RangeError(`${fnName}: out of range ${n}`);
  }
}

/**
 * Throw `TypeError` when every byte of `bytes` is zero. Intended as a
 * boundary check at the wire layer for UUID buffers (`installId`,
 * `userId`, `dataSessionId`) - an all-zero UUID on the wire is a
 * known corruption signal and is treated as a ghost identity by the
 * server.
 *
 * @throws TypeError when every byte of `bytes` equals 0.
 */
function assertNonZeroBytes({ bytes, fnName }: AssertNonZeroBytesArgs): void {
  if (bytes.every((b) => b === 0)) {
    throw new TypeError(`${fnName}: all-zero bytes`);
  }
}

export { assertIntInRange, assertNonZeroBytes, assertUint8Array };
