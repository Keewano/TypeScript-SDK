/**
 * Return shape of {@link buildCustomEventSet}. Matches the public
 * `CustomEventSet` interface that the SDK consumes, but kept as a
 * separate local symbol so the codegen does not pull a runtime
 * dependency on the SDK package surface.
 *
 * version - FNV-1a 32-bit hash of the gzip-normalized event map; uint32.
 * eventCount - Number of events encoded in `gzipData`.
 * gzipData - Gzipped event map with header bytes 4..9 normalized for
 *   cross-OS determinism.
 */
interface BuildResult {
  version: number;
  eventCount: number;
  gzipData: Uint8Array;
}

export type { BuildResult };
