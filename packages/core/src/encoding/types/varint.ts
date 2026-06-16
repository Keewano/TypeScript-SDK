/**
 * Args and result types for the LEB128 varint codec in `../varint.ts`.
 * Exported through the encoding barrel so consumers can spell the
 * function signatures explicitly when needed.
 */

import type { BinaryStream } from '../binaryStream';

/**
 * Arguments for `readVarintU`.
 *
 * bytes - Source buffer to decode from.
 * offset - Starting byte offset within `bytes`.
 */
interface ReadVarintUArgs {
  bytes: Uint8Array;
  offset: number;
}

/**
 * Result of `readVarintU`.
 *
 * bytesRead - Number of bytes consumed from the buffer.
 * value - Decoded unsigned integer value.
 */
interface ReadVarintUResult {
  bytesRead: number;
  value: number;
}

/**
 * Arguments for `writeVarintU`.
 *
 * n - Unsigned integer to encode. Must be in `[0, 2^32 - 1]`.
 * out - Target stream to append the encoded bytes to.
 */
interface WriteVarintUArgs {
  n: number;
  out: BinaryStream;
}

export type { ReadVarintUArgs, ReadVarintUResult, WriteVarintUArgs };
