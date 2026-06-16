/**
 * Args types for the internal validation helpers in `../assertions.ts`.
 * Not re-exported from the encoding barrel - these mirror the helpers'
 * private status and only exist so impl files have a named shape to
 * destructure against.
 */

/**
 * Arguments for the internal `assertIntInRange` helper.
 *
 * fnName - Caller name embedded in the thrown error message.
 * max - Upper bound, inclusive.
 * min - Lower bound, inclusive.
 * n - Value to validate.
 */
interface AssertIntInRangeArgs {
  fnName: string;
  max: number;
  min: number;
  n: number;
}

/**
 * Arguments for the internal `assertUint8Array` helper.
 *
 * expectedLength - Optional exact byte-length to enforce.
 * fnName - Caller name embedded in the thrown error message.
 * value - Value to validate.
 */
interface AssertUint8ArrayArgs {
  expectedLength?: number;
  fnName: string;
  value: unknown;
}

/**
 * Arguments for the internal `assertNonZeroBytes` helper.
 *
 * bytes - The buffer to check. Must be a `Uint8Array`; the caller is
 *   expected to have already validated length and type via
 *   `assertUint8Array`.
 * fnName - Caller name embedded in the thrown error message.
 */
interface AssertNonZeroBytesArgs {
  bytes: Uint8Array;
  fnName: string;
}

export type { AssertIntInRangeArgs, AssertNonZeroBytesArgs, AssertUint8ArrayArgs };
