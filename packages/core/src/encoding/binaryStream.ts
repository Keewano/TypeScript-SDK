/**
 * Growable little-endian byte buffer.
 *
 * All multi-byte integer writes are little-endian. Strings are prefixed
 * with an LEB128 varint of their UTF-8 byte length, followed by the
 * UTF-8 bytes themselves. Booleans are encoded as 0x02 (true) /
 * 0x01 (false), reserving 0x00 for distinct "absent" semantics in
 * future event types.
 *
 * Capacity doubles on demand. The constructor accepts an initial size
 * hint to skip early reallocations when the expected payload size is
 * known.
 *
 * @example
 * ```ts
 * const stream = new BinaryStream();
 * stream.writeUint32LE(timestamp);
 * stream.writeUint16LE(eventId);
 * stream.writeString('PlayerName');
 * const bytes = stream.toBytes();
 * ```
 */

import { assertIntInRange, assertUint8Array } from './assertions';
import { LIMITS } from './limits';
import { writeVarintU } from './varint';
import { guidToBytes } from './guid';

const INITIAL_CAPACITY = 1024;

/**
 * Sanity ceiling for the constructor's `initialCapacity` hint, not a
 * wire limit. The buffer doubles on demand, so the initial hint is
 * purely a reallocation-avoidance knob; any value above this is almost
 * certainly a bug (a typo at the call site, or a MB->bytes miscalc)
 * that would otherwise trigger a multi-hundred-MB allocation up front.
 */
const MAX_INITIAL_CAPACITY = 16 * 1024 * 1024;

/**
 * Wire bytes representing boolean values. The 0x00 byte is reserved on
 * the wire and is never used for booleans, leaving it free for future
 * event types to encode "absent" distinctly from "false".
 */
const BOOL_BYTES = {
  FALSE: 0x01,
  TRUE: 0x02,
} as const;

// TextEncoder is stateless; allocate once at module load instead of per write.
const utf8Encoder = new TextEncoder();

class BinaryStream {
  private buffer: Uint8Array;
  private view: DataView;
  private size: number;

  /**
   * @param initialCapacity - Initial buffer size in bytes. Defaults to
   *                          1024, capped at 16 MB. Use a larger hint
   *                          when the expected payload size is known to
   *                          skip early doubling reallocations.
   * @throws RangeError when `initialCapacity` is negative, not an
   *   integer, or above the 16 MB sanity ceiling.
   */
  constructor(initialCapacity: number = INITIAL_CAPACITY) {
    assertIntInRange({
      fnName: 'BinaryStream constructor initialCapacity',
      max: MAX_INITIAL_CAPACITY,
      min: 0,
      n: initialCapacity,
    });
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
    this.size = 0;
  }

  /**
   * Number of bytes currently written to the stream.
   */
  get length(): number {
    return this.size;
  }

  /**
   * Return a view (not a copy) over the bytes written so far. The view
   * shares memory with the stream - if you continue writing after
   * calling this, the view's contents may change. Call `.slice()` on
   * the result if you need a stable, owned copy.
   *
   * @returns Length-bounded view over the written bytes.
   */
  toBytes(): Uint8Array {
    return this.buffer.subarray(0, this.size);
  }

  /**
   * Reset the stream to empty state while preserving the allocated
   * buffer capacity. Subsequent writes begin at offset 0. Useful when
   * reusing a single stream across multiple serialization cycles to
   * avoid repeat allocations.
   *
   * @returns This stream instance for chaining.
   */
  reset(): this {
    this.size = 0;
    return this;
  }

  /**
   * Write an unsigned 8-bit integer.
   *
   * @param value - Integer in `[0, 255]`.
   * @throws RangeError when `value` is not an integer in `[0, 255]`.
   */
  writeUint8(value: number): void {
    assertIntInRange({
      fnName: 'writeUint8',
      max: LIMITS.UINT8_MAX,
      min: 0,
      n: value,
    });
    this.ensureCapacity(1);
    this.buffer[this.size++] = value;
  }

  /**
   * Write an unsigned 16-bit integer, little-endian.
   *
   * @param value - Integer in `[0, 65535]`.
   * @throws RangeError when `value` is not an integer in `[0, 65535]`.
   */
  writeUint16LE(value: number): void {
    assertIntInRange({
      fnName: 'writeUint16LE',
      max: LIMITS.UINT16_MAX,
      min: 0,
      n: value,
    });
    this.ensureCapacity(2);
    this.view.setUint16(this.size, value, true);
    this.size += 2;
  }

  /**
   * Write an unsigned 32-bit integer, little-endian.
   *
   * @param value - Integer in `[0, 2^32 - 1]`.
   * @throws RangeError when `value` is not an integer in `[0, 2^32 - 1]`.
   */
  writeUint32LE(value: number): void {
    assertIntInRange({
      fnName: 'writeUint32LE',
      max: LIMITS.UINT32_MAX,
      min: 0,
      n: value,
    });
    this.ensureCapacity(4);
    this.view.setUint32(this.size, value, true);
    this.size += 4;
  }

  /**
   * Write a signed 32-bit integer, little-endian.
   *
   * @param value - Integer in `[-2^31, 2^31 - 1]`.
   * @throws RangeError when `value` is not an integer in `[-2^31, 2^31 - 1]`.
   */
  writeInt32LE(value: number): void {
    assertIntInRange({
      fnName: 'writeInt32LE',
      max: LIMITS.INT32_MAX,
      min: LIMITS.INT32_MIN,
      n: value,
    });
    this.ensureCapacity(4);
    this.view.setInt32(this.size, value, true);
    this.size += 4;
  }

  /**
   * Write an IEEE 754 single-precision float, little-endian.
   *
   * @param value - Float value to encode. NaN and +/-Infinity are accepted.
   * @throws TypeError when `value` is not a number.
   */
  writeFloat32LE(value: number): void {
    if (typeof value !== 'number') {
      throw new TypeError('writeFloat32LE: not a number');
    }
    this.ensureCapacity(4);
    this.view.setFloat32(this.size, value, true);
    this.size += 4;
  }

  /**
   * Append a raw byte sequence with no length prefix.
   *
   * @param bytes - Buffer to append. Length is not written to the stream;
   *                callers that need framing must encode their own prefix.
   * @throws TypeError when `bytes` is not a `Uint8Array`.
   */
  writeBytes(bytes: Uint8Array): void {
    assertUint8Array({
      fnName: 'writeBytes',
      value: bytes,
    });
    this.ensureCapacity(bytes.length);
    this.buffer.set(bytes, this.size);
    this.size += bytes.length;
  }

  /**
   * Encode a string as UTF-8, prefixed with an LEB128 varint of the
   * UTF-8 byte length. The prefix counts UTF-8 bytes, not JavaScript
   * characters - non-ASCII strings produce a length larger than their
   * character count.
   *
   * @param value - String to encode. Empty string is valid and emits a
   *                single `0x00` length-prefix byte with no payload.
   * @throws TypeError when `value` is not a string.
   */
  writeString(value: string): void {
    if (typeof value !== 'string') {
      throw new TypeError('writeString: not a string');
    }

    const bytes = utf8Encoder.encode(value);

    writeVarintU({
      n: bytes.length,
      out: this,
    });

    this.writeBytes(bytes);
  }

  /**
   * Encode a boolean as a single byte: 0x02 for true, 0x01 for false.
   * The 0x00 byte is reserved on the wire and never written by this
   * method.
   *
   * @param value - Boolean to encode. Truthy/falsy values are rejected;
   *                only the literal `true` and `false` are accepted.
   * @throws TypeError when `value` is not a boolean.
   */
  writeBool(value: boolean): void {
    if (typeof value !== 'boolean') {
      throw new TypeError('writeBool: not a boolean');
    }
    this.writeUint8(value ? BOOL_BYTES.TRUE : BOOL_BYTES.FALSE);
  }

  /**
   * Write a GUID as 16 bytes in mixed-endian layout. See
   * {@link guidToBytes} for the exact byte order.
   *
   * @param guidStr - GUID in canonical "D" form
   *                  `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.
   *                  Case-insensitive on input.
   * @throws TypeError when `guidStr` is not a valid GUID string.
   */
  writeGuid(guidStr: string): void {
    this.writeBytes(guidToBytes(guidStr));
  }

  /**
   * Allocate a new backing buffer of `newCapacity` bytes, copy the
   * already-written prefix into it, and rebind `this.buffer` / `this.view`.
   *
   * @param newCapacity - Target capacity in bytes. Must be >= `this.size`.
   */
  private reallocate(newCapacity: number): void {
    const newBuffer = new Uint8Array(newCapacity);
    newBuffer.set(this.buffer.subarray(0, this.size));
    this.buffer = newBuffer;
    this.view = new DataView(this.buffer.buffer);
  }

  /**
   * Smallest power-of-two capacity that fits `needed` bytes, doubling
   * from the current buffer length (or 1 if the buffer is empty).
   *
   * @param needed - Required capacity in bytes.
   * @returns Capacity in bytes, always >= `needed` and a power of two
   *          (or 1 in the degenerate empty-buffer case).
   */
  private nextCapacity(needed: number): number {
    let capacity = Math.max(this.buffer.length, 1);
    while (capacity < needed) capacity *= 2;
    return capacity;
  }

  /**
   * Grow the buffer so that another `additional` bytes can be written.
   * No-op when there is already enough room.
   *
   * @param additional - Number of additional bytes the caller is about
   *                     to append after this call returns.
   */
  private ensureCapacity(additional: number): void {
    const needed = this.size + additional;
    if (needed <= this.buffer.length) return;
    this.reallocate(this.nextCapacity(needed));
  }
}

export { BinaryStream, BOOL_BYTES };
