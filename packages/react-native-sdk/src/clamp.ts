/**
 * Numeric coercion helpers shared across the report and init layers.
 * Negative or non-finite inputs collapse to `0`; oversized inputs
 * saturate at the type ceiling so an older platform API that
 * returns `-1` for "unknown" cannot ride through as a giant
 * unsigned number.
 */

/** Upper bound for a uint8 LE wire field (AdType byte, AB-test group letter). */
const UINT8_MAX = 0xff;

/** Upper bound for a uint16 LE wire field (SCREEN_RESOLUTION x/y). */
const UINT16_MAX = 0xffff;

/** Upper bound for a uint32 LE wire field (RAM_SIZE, purchase amounts, revenue amounts). */
const UINT32_MAX = 0xffffffff;

/** Upper bound for a non-negative int32 LE wire field (item-array element counts). */
const INT32_NON_NEGATIVE_MAX = 0x7fffffff;

/**
 * Coerce `value` into the inclusive `[0, UINT8_MAX]` integer range.
 * Same fail-closed contract as {@link clampUint16}: a TS host that
 * goes around the type system (any-typed call site, JS-only host)
 * cannot wire a non-numeric value through to the dispatcher.
 *
 * @returns `0` for negative / non-finite input; `Math.floor(value)`
 *   when in range; {@link UINT8_MAX} when above range.
 */
function clampUint8(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), UINT8_MAX);
}

/**
 * Coerce `value` into the inclusive `[0, UINT16_MAX]` integer range.
 *
 * @returns `0` for negative / non-finite input; `Math.floor(value)`
 *   when in range; {@link UINT16_MAX} when above range.
 */
function clampUint16(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), UINT16_MAX);
}

/**
 * Coerce `value` into the inclusive `[0, UINT32_MAX]` integer range.
 * Same fail-closed contract as {@link clampUint16}.
 *
 * @returns `0` for negative / non-finite input; `Math.floor(value)`
 *   when in range; {@link UINT32_MAX} when above range.
 */
function clampUint32(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), UINT32_MAX);
}

/**
 * Coerce `value` into a non-negative finite float for monetary
 * payloads (localized purchase / revenue amounts written as float32
 * LE). NaN, +/-Infinity, and negative numbers collapse to `0` so the
 * wire never carries an invalid IEEE 754 bit pattern the server-side
 * parser would reject (which would drop the whole batch).
 *
 * @returns `0` for non-finite / negative input; `value` otherwise.
 */
function clampNonNegativeFloat(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * Coerce `value` into the inclusive `[0, INT32_NON_NEGATIVE_MAX]`
 * integer range. Item-array element counts are written via
 * `writeInt32LE`, so a wrap into the negative half (or a NaN / float
 * input) would corrupt the serialized quantity. Floats are floored,
 * negatives / non-finites collapse to `0`, and values above
 * 0x7FFFFFFF saturate at that ceiling.
 *
 * @returns `0` for negative / non-finite input; `Math.floor(value)`
 *   when in range; {@link INT32_NON_NEGATIVE_MAX} when above range.
 */
function clampInt32NonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), INT32_NON_NEGATIVE_MAX);
}

export { clampInt32NonNegative, clampNonNegativeFloat, clampUint16, clampUint32, clampUint8 };
