/**
 * Pack and unpack the fixed 56-byte `.kwub` header. The byte layout
 * is the canonical wire shape so files produced by any compliant
 * writer are interchangeable on the receiving side.
 *
 * Layout (offsets in bytes, all multi-byte integers little-endian):
 * ```
 *  0..3   FourCC          = 0x57554242 ('BBUW' on disk)
 *  4..7   BatchVersion    = uint32 LE (writer emits 2; reader accepts 1 and 2)
 *  8..23  UserId          = 16 raw GUID bytes (Microsoft mixed-endian)
 * 24..39  DataSessionId   = 16 raw GUID bytes
 * 40..43  BatchNum        = int32 LE
 * 44..47  BatchStartTime  = uint32 LE (Unix seconds, UTC)
 * 48..51  BatchEndTime    = uint32 LE (Unix seconds, UTC)
 * 52..55  DataSize        = int32 LE (payload length in bytes)
 * ```
 *
 * Helpers are intentionally byte-explicit so the format stays
 * inspectable without leaning on a general-purpose serializer.
 */

/** Total header length in bytes. */
const KFILE_HEADER_SIZE = 56;

/**
 * Written as `uint32 LE`, which yields the on-disk bytes `42 42 55 57`
 * (ASCII `BBUW`). The `.kwub` file extension is unrelated to the
 * FourCC and is purely a directory-listing convention.
 */
const BATCH_FOURCC = 0x57554242;

/** Current writer batch-protocol version. */
const CURRENT_BATCH_VERSION = 2;

/** Batch-protocol versions accepted by the reader. */
const ACCEPTED_BATCH_VERSIONS: readonly number[] = [1, CURRENT_BATCH_VERSION];

/**
 * `true` when `version` is in the reader's accepted set. Avoids a
 * `version as ...` cast at the call site that would silently lie
 * for out-of-range values.
 */
function isAcceptedBatchVersion(version: number): boolean {
  return ACCEPTED_BATCH_VERSIONS.includes(version);
}

/** Byte length of the GUID buffers embedded in the header. */
const GUID_SIZE = 16;

/**
 * Args bag for {@link writeKFileHeader}.
 *
 * batchVersion - Wire-protocol batch-format version stamp.
 * userId - 16 raw GUID bytes (Microsoft mixed-endian). Length is
 *   validated to keep a misshapen identity buffer from silently
 *   corrupting downstream offsets.
 * dataSessionId - 16 raw GUID bytes.
 * batchNum - Monotonic batch sequence number; written as int32 LE.
 * batchStartTime - Unix seconds (UTC).
 * batchEndTime - Unix seconds (UTC).
 * dataSize - Length of the event-stream payload that follows the
 *   header. Written as int32 LE.
 */
interface WriteKFileHeaderArgs {
  batchVersion: number;
  userId: Uint8Array;
  dataSessionId: Uint8Array;
  batchNum: number;
  batchStartTime: number;
  batchEndTime: number;
  dataSize: number;
}

/**
 * Parsed view of the 56-byte header returned by
 * {@link readKFileHeader}.
 */
interface ParsedKFileHeader {
  batchVersion: number;
  userId: Uint8Array;
  dataSessionId: Uint8Array;
  batchNum: number;
  batchStartTime: number;
  batchEndTime: number;
  dataSize: number;
}

/**
 * Serialize the header into a fresh 56-byte `Uint8Array`.
 *
 * @throws RangeError when a GUID buffer is the wrong length, or when
 *   a numeric field is not a non-negative integer (batchVersion /
 *   batchNum / timestamps / dataSize).
 */
function writeKFileHeader({
  batchVersion,
  userId,
  dataSessionId,
  batchNum,
  batchStartTime,
  batchEndTime,
  dataSize,
}: WriteKFileHeaderArgs): Uint8Array {
  /**
   * `Uint8Array.prototype.set` accepts any `ArrayLike<number>` and
   * silently coerces non-byte values, so a plain 16-element JS array
   * would slip through a length-only check and emit a corrupted
   * header. Require an actual `Uint8Array` so the boundary fails
   * loudly instead of writing garbage. Matches the symmetric guard
   * in `saveBatch`.
   */
  if (!(userId instanceof Uint8Array) || userId.length !== GUID_SIZE) {
    throw new RangeError(`writeKFileHeader: userId must be a ${String(GUID_SIZE)}-byte Uint8Array`);
  }
  if (!(dataSessionId instanceof Uint8Array) || dataSessionId.length !== GUID_SIZE) {
    throw new RangeError(
      `writeKFileHeader: dataSessionId must be a ${String(GUID_SIZE)}-byte Uint8Array`,
    );
  }
  if (!Number.isSafeInteger(batchVersion) || batchVersion < 0 || batchVersion > 0xffffffff) {
    throw new RangeError('writeKFileHeader: batchVersion must be a uint32');
  }
  if (!Number.isSafeInteger(batchNum) || batchNum < 0 || batchNum > 0x7fffffff) {
    throw new RangeError('writeKFileHeader: batchNum must be a non-negative int32');
  }
  if (!Number.isSafeInteger(batchStartTime) || batchStartTime < 0 || batchStartTime > 0xffffffff) {
    throw new RangeError('writeKFileHeader: batchStartTime must be a uint32');
  }
  if (!Number.isSafeInteger(batchEndTime) || batchEndTime < 0 || batchEndTime > 0xffffffff) {
    throw new RangeError('writeKFileHeader: batchEndTime must be a uint32');
  }
  if (!Number.isSafeInteger(dataSize) || dataSize < 0 || dataSize > 0x7fffffff) {
    throw new RangeError('writeKFileHeader: dataSize must be a non-negative int32');
  }

  const header = new Uint8Array(KFILE_HEADER_SIZE);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  view.setUint32(0, BATCH_FOURCC, true);
  view.setUint32(4, batchVersion, true);
  header.set(userId, 8);
  header.set(dataSessionId, 24);
  view.setInt32(40, batchNum, true);
  view.setUint32(44, batchStartTime, true);
  view.setUint32(48, batchEndTime, true);
  view.setInt32(52, dataSize, true);
  return header;
}

/**
 * Parse a 56-byte header. Returns `null` when the input is too short,
 * the FourCC does not match, or the batch version is unsupported.
 * The reader never throws on corruption - a malformed file collapses
 * into a `null` result so the caller can simply skip it.
 */
function readKFileHeader(bytes: Uint8Array): ParsedKFileHeader | null {
  if (bytes.length < KFILE_HEADER_SIZE) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fourcc = view.getUint32(0, true);
  if (fourcc !== BATCH_FOURCC) {
    return null;
  }
  const batchVersion = view.getUint32(4, true);
  if (!isAcceptedBatchVersion(batchVersion)) {
    return null;
  }
  /**
   * Slice the GUID buffers so the caller owns independent memory and
   * mutating the parsed result cannot ripple back into the source
   * `Uint8Array`.
   */
  const userId = bytes.slice(8, 24);
  const dataSessionId = bytes.slice(24, 40);
  const batchNum = view.getInt32(40, true);
  const batchStartTime = view.getUint32(44, true);
  const batchEndTime = view.getUint32(48, true);
  const dataSize = view.getInt32(52, true);
  /**
   * Quarantine a malformed on-disk batch with a negative `batchNum`
   * or `dataSize` here so it cannot propagate downstream. A negative
   * `batchNum` would later fail `writeKFileHeader`'s non-negative
   * int32 check from inside `reduceStorageSize`'s rewrite path; we
   * reject it on read so the corruption surfaces as `loadBatch ->
   * null` instead of a deep stack trace.
   */
  if (batchNum < 0 || dataSize < 0) {
    return null;
  }
  return {
    batchVersion,
    userId,
    dataSessionId,
    batchNum,
    batchStartTime,
    batchEndTime,
    dataSize,
  };
}

export type { ParsedKFileHeader, WriteKFileHeaderArgs };
export {
  ACCEPTED_BATCH_VERSIONS,
  BATCH_FOURCC,
  CURRENT_BATCH_VERSION,
  GUID_SIZE,
  KFILE_HEADER_SIZE,
  isAcceptedBatchVersion,
  readKFileHeader,
  writeKFileHeader,
};
