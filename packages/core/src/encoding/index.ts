/**
 * Encoding primitives for the SDK wire protocol: varint, UUID, FNV-1a,
 * and the growable binary stream they compose into. Internal helpers
 * (`assertions.ts`, `random.ts`) are intentionally not re-exported.
 *
 * Module-level wire constants (`BOOL_BYTES`, `LIMITS`, `FNV1A_32`) stay
 * in their impl files and are not part of the package's public API
 * surface; this barrel does not re-export them. Their impl modules keep
 * them exported only so the in-module tests can assert on raw byte
 * values - do not reach for them through deep import paths.
 */

export type { ReadVarintUArgs, ReadVarintUResult, WriteVarintUArgs } from './varint';
export { BinaryStream } from './binaryStream';
export { fnv1a32 } from './fnv1a';
export { bigintToUuidBytes, uuidBytesToString, uuidToBytes, newUuid } from './uuid';
export { readVarintU, writeVarintU } from './varint';
