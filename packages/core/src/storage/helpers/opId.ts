/**
 * Per-operation id generator used by adapters to disambiguate scratch
 * siblings (`__kwtmp__.<opId>` / `__kwbak__.<opId>`) from real user
 * files at the same path. The id is NOT a security token - the
 * destination is already protected by per-path serialization queues -
 * but uses `crypto.getRandomValues` when available so static analyzers
 * stop flagging the helper and so the entropy is meaningful on
 * runtimes that do expose a CSPRNG.
 *
 * On hosts without a Web Crypto-style CSPRNG the helper falls back to
 * a monotonic 32-bit counter. The counter is deliberately NOT a PRNG
 * (no `Math.random` involved) so SAST tools cannot flag it as a weak
 * random source - it is just a process-lifetime-unique disambiguator.
 *
 * @example
 * ```ts
 * const id = generateOpId();
 * // -> e.g. "1717252800000-9f3a8b1c4d5e6a7b"
 * ```
 */

const OP_ID_RANDOM_BYTES = 8;

/**
 * 32-bit monotonic counter. 2^32 calls would take billions of write
 * operations in a single process lifetime; wrap-around is intentionally
 * unhandled because reaching it is not a realistic failure mode.
 */
let counter = 0;

/**
 * Fill `bytes` with 4 zero bytes followed by the next 4 bytes of the
 * monotonic counter, big-endian. The high half stays zero so the
 * counter branch is trivially distinguishable from the CSPRNG branch
 * in a test environment (the hex output starts with `00000000`).
 */
function fillCounter(bytes: Uint8Array): void {
  counter = (counter + 1) >>> 0;
  bytes[0] = 0;
  bytes[1] = 0;
  bytes[2] = 0;
  bytes[3] = 0;
  bytes[4] = (counter >>> 24) & 0xff;
  bytes[5] = (counter >>> 16) & 0xff;
  bytes[6] = (counter >>> 8) & 0xff;
  bytes[7] = counter & 0xff;
}

/**
 * Produce a uniqueness suffix for scratch sibling filenames. Composed
 * of `${Date.now()}-${hex}` where `hex` is 16 hex characters drawn
 * from `crypto.getRandomValues` when available and from a monotonic
 * counter otherwise. The counter branch is reachable only on hosts
 * that do not expose a Web Crypto-style CSPRNG; serialization in
 * adapters makes the suffix's actual unpredictability immaterial to
 * correctness.
 */
function generateOpId(): string {
  const bytes = new Uint8Array(OP_ID_RANDOM_BYTES);
  const cryptoLike = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } })
    .crypto;
  if (typeof cryptoLike?.getRandomValues === 'function') {
    cryptoLike.getRandomValues(bytes);
  } else {
    fillCounter(bytes);
  }
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return `${Date.now()}-${hex}`;
}

export { generateOpId };
