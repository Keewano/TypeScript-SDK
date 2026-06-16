/**
 * LEB128-style unsigned variable-length integer codec.
 *
 * Each byte carries the next 7 bits of the value in its low bits; the
 * high bit signals "more bytes follow" (1) or "this is the last byte"
 * (0). Lowest 7 bits come first.
 *
 * Used as the length prefix for variable-length strings on the wire.
 *
 * @example
 * ```ts
 * const out = new BinaryStream();
 *
 * writeVarintU({
 *   n: 128,
 *   out,
 * });
 * // appends [0x80, 0x01]
 *
 * writeVarintU({
 *   n: 16384,
 *   out,
 * });
 * // appends [0x80, 0x80, 0x01]
 * ```
 */

import type { ReadVarintUArgs, ReadVarintUResult, WriteVarintUArgs } from './types/varint';

import { assertIntInRange, assertUint8Array } from './assertions';
import { LIMITS } from './limits';

/**
 * LEB128 algorithm constants.
 *
 * HIGH_BIT - Continuation flag in the high bit of each byte.
 * LOW_7_MASK - Mask for the low 7 data bits.
 * MAX_BYTES - Maximum byte length of a uint32 varint (ceil(32 / 7)).
 * RADIX - Base for the 7-bit value groups (2^7 = 128).
 */
const LEB128 = {
  HIGH_BIT: 0x80,
  LOW_7_MASK: 0x7f,
  MAX_BYTES: 5,
  RADIX: 128,
} as const;

/**
 * Decode an LEB128 unsigned varint starting at `offset`.
 *
 * @returns Decoded value and the number of bytes consumed.
 * @throws TypeError when `bytes` is not a `Uint8Array`.
 * @throws RangeError when `offset` is invalid, the buffer is too short,
 *   the decoded value exceeds uint32, or the encoding extends past
 *   five bytes.
 */
function readVarintU({ bytes, offset }: ReadVarintUArgs): ReadVarintUResult {
  assertUint8Array({ fnName: 'readVarintU', value: bytes });
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`readVarintU: invalid offset ${offset}`);
  }
  if (offset >= bytes.length) {
    throw new RangeError(`readVarintU: offset ${offset} past length ${bytes.length}`);
  }

  let multiplier = 1;
  let value = 0;

  for (let i = 0; i < LEB128.MAX_BYTES; i++) {
    const byte = bytes[offset + i];
    if (byte === undefined) {
      throw new RangeError('readVarintU: truncated');
    }

    value += (byte & LEB128.LOW_7_MASK) * multiplier;

    // High bit clear -> last byte of this varint.
    if ((byte & LEB128.HIGH_BIT) === 0) {
      if (value > LIMITS.UINT32_MAX) {
        throw new RangeError('readVarintU: overflow');
      }
      return {
        bytesRead: i + 1,
        value,
      };
    }

    multiplier *= LEB128.RADIX;
  }

  throw new RangeError('readVarintU: too long');
}

/**
 * Encode an unsigned integer as an LEB128 varint into the stream.
 *
 * @throws RangeError when `n` is not a non-negative integer in uint32 range.
 */
function writeVarintU({ out, n }: WriteVarintUArgs): void {
  assertIntInRange({
    fnName: 'writeVarintU',
    max: LIMITS.UINT32_MAX,
    min: 0,
    n,
  });

  let remaining = n;
  while (remaining >= LEB128.HIGH_BIT) {
    out.writeUint8((remaining & LEB128.LOW_7_MASK) | LEB128.HIGH_BIT);
    remaining = Math.floor(remaining / LEB128.RADIX);
  }
  out.writeUint8(remaining & LEB128.LOW_7_MASK);
}

export type { ReadVarintUArgs, ReadVarintUResult, WriteVarintUArgs } from './types/varint';
export { readVarintU, writeVarintU };
