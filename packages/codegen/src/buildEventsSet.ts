/**
 * Encode a parsed event list into the deterministic binary custom-event
 * map: per-event byte stream -> gzip -> cross-OS header normalization ->
 * FNV-1a version stamp. The result matches the public `CustomEventSet`
 * shape the SDK consumes at runtime.
 */

import type { BuildResult } from './types/buildCustomEventSet';
import type { ParsedEvent } from './types/event';

import { BinaryStream, fnv1a32 } from '@keewano/core';
import { gzip as pakoGzip } from 'pako';

/**
 * Deterministic settings applied to the per-build pipeline.
 *
 * GZIP_LEVEL - 9 = maximum compression; deterministic for a fixed
 *   pako version (pinned in package.json).
 * MIN_GZIP_HEADER_LENGTH - 10 = the RFC 1952 fixed-size gzip header
 *   length; any shorter buffer is malformed and cannot be normalized.
 * GZIP_HEADER_MASK - byte values applied to the informational fields
 *   of the gzip header (RFC 1952 bytes 4..9). MTIME (4..7) and XFL (8)
 *   are zeroed; OS (9) is set to 0xFF ("unknown") so the FNV-1a hash
 *   is identical across Windows / Linux / macOS builders.
 */
const PIPELINE = {
  GZIP_LEVEL: 9,
  MIN_GZIP_HEADER_LENGTH: 10,
  GZIP_HEADER_MASK: { MTIME_0: 4, MTIME_1: 5, MTIME_2: 6, MTIME_3: 7, XFL: 8, OS: 9 },
  GZIP_OS_UNKNOWN: 0xff,
} as const;

/**
 * Compute the binary payload for the custom-events map.
 *
 * Pipeline:
 *
 *   1. For every event in `events` (already sorted ordinal-by-name)
 *      write `[uint16 LE id][varint UTF-8 length][UTF-8 name][uint16 LE type]`
 *      into a `BinaryStream`. `id` was stamped by `parseEventDirectory`
 *      to the canonical `2500 + index`.
 *   2. Gzip the buffer with pako at maximum (deterministic) level.
 *   3. Overwrite gzip header bytes 4..9 with the canonical mask so the
 *      payload + the FNV hash are stable across builders.
 *   4. Compute FNV-1a 32-bit over the normalized bytes -> `version`.
 *
 * The returned object matches the public `CustomEventSet` interface
 * the SDK consumes.
 */
function buildCustomEventSet(events: readonly ParsedEvent[]): BuildResult {
  const eventBytes = serializeEvents(events);
  const gzipped = pakoGzip(eventBytes, { level: PIPELINE.GZIP_LEVEL });
  const normalized = normalizeGzipHeader(gzipped);
  const version = fnv1a32(normalized);
  return {
    version,
    eventCount: events.length,
    gzipData: normalized,
  };
}

/**
 * Encode the per-event byte stream into a contiguous `Uint8Array`.
 * Each event contributes `[uint16 LE id][varint+UTF-8 name][uint16 LE type]`.
 *
 * `serializeEvents` is part of the public API and accepts any
 * `ParsedEvent[]` the caller hands in, so `id` and `type` are
 * validated against the documented `uint16` wire range. Out-of-range
 * values would otherwise silently truncate through `writeUint16LE`
 * and produce a wire map whose `version` hash no longer matches the
 * server-side decoder.
 */
function serializeEvents(events: readonly ParsedEvent[]): Uint8Array {
  const stream = new BinaryStream();
  for (const event of events) {
    assertUint16Field('id', event.id);
    assertUint16Field('type', event.type);
    stream.writeUint16LE(event.id);
    stream.writeString(event.name);
    stream.writeUint16LE(event.type);
  }
  return stream.toBytes();
}

function assertUint16Field(field: 'id' | 'type', value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`serializeEvents: event ${field} ${value} is outside uint16 range`);
  }
}

/**
 * Overwrite gzip header bytes 4..9 with the cross-OS canonical mask
 * (see {@link PIPELINE.GZIP_HEADER_MASK}). RFC 1952: these fields are
 * informational and ignored by every conforming decompressor, so
 * flattening them is byte-safe and makes the FNV-1a stamp identical
 * across builders.
 */
function normalizeGzipHeader(gzipData: Uint8Array): Uint8Array {
  if (gzipData.length < PIPELINE.MIN_GZIP_HEADER_LENGTH) return gzipData;
  const out = new Uint8Array(gzipData);
  out[PIPELINE.GZIP_HEADER_MASK.MTIME_0] = 0;
  out[PIPELINE.GZIP_HEADER_MASK.MTIME_1] = 0;
  out[PIPELINE.GZIP_HEADER_MASK.MTIME_2] = 0;
  out[PIPELINE.GZIP_HEADER_MASK.MTIME_3] = 0;
  out[PIPELINE.GZIP_HEADER_MASK.XFL] = 0;
  out[PIPELINE.GZIP_HEADER_MASK.OS] = PIPELINE.GZIP_OS_UNKNOWN;
  return out;
}

export type { BuildResult } from './types/buildCustomEventSet';
export { buildCustomEventSet, normalizeGzipHeader, PIPELINE, serializeEvents };
