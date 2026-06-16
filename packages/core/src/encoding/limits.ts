/**
 * Inclusive value ranges of the fixed-width integer types accepted by
 * wire encoders, dispatcher input validators, and network args parsers.
 * Centralized here so every module that range-checks a wire value uses
 * the same constants; the alternative is six inline `0xffffffff`s that
 * drift the moment someone miscounts the f-s.
 *
 * Internal to `@keewano/core` - not re-exported from the package index.
 * Keys are alphabetical per the project's `as const` canon.
 */
const LIMITS = {
  INT32_MAX: 0x7fffffff,
  INT32_MIN: -0x80000000,
  UINT16_MAX: 0xffff,
  UINT32_MAX: 0xffffffff,
  UINT8_MAX: 0xff,
} as const;

export { LIMITS };
