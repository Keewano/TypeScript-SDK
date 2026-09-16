/**
 * Environment polyfills, run BEFORE jest.setup.ts (which imports
 * `@keewano/core`, whose binary encoding layer instantiates
 * `TextEncoder` at module load). `jest-environment-jsdom` does not
 * expose Node's TextEncoder / TextDecoder globals, while every real
 * browser has them natively. No-op under the node environment.
 */
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';

const globalRef = globalThis as { TextEncoder?: unknown; TextDecoder?: unknown };

if (globalRef.TextEncoder === undefined) {
  /**
   * jsdom test code runs in its own realm: bytes produced by Node's
   * TextEncoder fail `instanceof Uint8Array` checks inside that realm
   * (core's BinaryStream asserts exactly that). Re-wrap the encoded
   * bytes into a realm-local Uint8Array so the polyfill is
   * indistinguishable from a browser-native encoder.
   */
  class RealmLocalTextEncoder extends NodeTextEncoder {
    override encode(input?: string): Uint8Array {
      return Uint8Array.from(super.encode(input));
    }
  }
  globalRef.TextEncoder = RealmLocalTextEncoder;
}

if (globalRef.TextDecoder === undefined) {
  /** Decoded strings are realm-independent; Node's decoder is safe as-is. */
  globalRef.TextDecoder = NodeTextDecoder;
}
