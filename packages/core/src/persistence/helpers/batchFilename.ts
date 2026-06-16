/**
 * Parse and format the on-disk batch filename. The canonical shape
 * is `${batchEndTime}_${batchNum}.kwub` so a cross-platform dump is
 * interchangeable between any wire-compatible producer.
 *
 * `batchEndTime` (the dominant sort key) leads so a lexicographic
 * directory listing is already chronological for batches captured
 * inside any single second; ties within a second are broken by
 * `batchNum` (the secondary sort key) which is monotonic per
 * dispatcher instance.
 *
 * @example
 * ```ts
 * formatBatchFilename({ batchEndTime: 1717252800, batchNum: 5 });
 * // -> '1717252800_5.kwub'
 *
 * parseBatchFilename('1717252800_5.kwub');
 * // -> { batchEndTime: 1717252800, batchNum: 5 }
 *
 * parseBatchFilename('not-a-batch.txt');
 * // -> null
 * ```
 */

/**
 * `(digits)_(digits).kwub` shape. Anchored on both ends so a partial
 * match (e.g. embedded inside a scratch sibling name) is rejected.
 */
const BATCH_FILENAME_PATTERN = /^(\d+)_(\d+)\.kwub$/;

const BATCH_FILE_EXTENSION = '.kwub';

/**
 * Args bag for {@link formatBatchFilename}.
 *
 * batchEndTime - Unix seconds (UTC). Must be a non-negative integer.
 * batchNum - Monotonic per-dispatcher sequence. Must be a non-negative
 *   integer.
 */
interface FormatBatchFilenameArgs {
  batchEndTime: number;
  batchNum: number;
}

/**
 * Args bag for {@link batchFilePath}.
 *
 * dir - Adapter-relative directory holding the batch files. Trailing
 *   slashes are normalized to a single separator before joining.
 * batchEndTime - See {@link FormatBatchFilenameArgs}.
 * batchNum - See {@link FormatBatchFilenameArgs}.
 */
interface BatchFilePathArgs {
  dir: string;
  batchEndTime: number;
  batchNum: number;
}

/**
 * Parsed view of the batch filename returned by
 * {@link parseBatchFilename}.
 */
interface ParsedBatchFilename {
  batchEndTime: number;
  batchNum: number;
}

function formatBatchFilename({ batchEndTime, batchNum }: FormatBatchFilenameArgs): string {
  /**
   * Bounds mirror `writeKFileHeader` so a filename can never describe a
   * batch the header layer cannot encode. `batchEndTime` is written as
   * `uint32 LE`, `batchNum` as the non-negative half of `int32 LE`.
   * Permitting larger values here would let `listBatches` surface a path
   * that later blows up on rewrite (e.g. the `reduceStorageSize`
   * tombstone path) instead of failing at the boundary.
   */
  if (!Number.isSafeInteger(batchEndTime) || batchEndTime < 0 || batchEndTime > 0xffffffff) {
    throw new RangeError('formatBatchFilename: batchEndTime must be a uint32');
  }
  if (!Number.isSafeInteger(batchNum) || batchNum < 0 || batchNum > 0x7fffffff) {
    throw new RangeError('formatBatchFilename: batchNum must be a non-negative int32');
  }
  return `${batchEndTime}_${batchNum}${BATCH_FILE_EXTENSION}`;
}

/**
 * Resolve a batch file to its adapter-relative path under `dir`.
 * Strips any run of trailing slashes so a caller that passes
 * `'foo//'` or `'foo///'` still gets a single canonical separator
 * before the filename - matches `storage.resolveUnderRoot`'s
 * doubled-separator rejection.
 */
function batchFilePath({ dir, batchEndTime, batchNum }: BatchFilePathArgs): string {
  const filename = formatBatchFilename({ batchEndTime, batchNum });
  if (dir.length === 0) {
    return filename;
  }
  let trimEnd = dir.length;
  while (trimEnd > 0 && dir.codePointAt(trimEnd - 1) === 0x2f /* '/' */) {
    trimEnd -= 1;
  }
  if (trimEnd === 0) {
    return filename;
  }
  return `${dir.substring(0, trimEnd)}/${filename}`;
}

/**
 * Try to parse the basename of a batch file. Returns `null` for any
 * basename that does not match the canonical `<digits>_<digits>.kwub`
 * shape so a foreign file in the batch directory cannot leak into a
 * batch listing.
 */
function parseBatchFilename(basename: string): ParsedBatchFilename | null {
  const match = BATCH_FILENAME_PATTERN.exec(basename);
  if (match === null) {
    return null;
  }
  /**
   * The regex captured two `\d+` groups, so `Number(...)` is safe and
   * `Number.isSafeInteger` rejects values that would round-trip
   * differently through JS's double-precision representation.
   */
  const batchEndTime = Number(match[1]);
  const batchNum = Number(match[2]);
  /**
   * Same bounds as `formatBatchFilename` / `writeKFileHeader`: a path
   * that parses to values the header cannot encode would later fail
   * inside `listBatches` consumers (notably `reduceStorageSize`), so
   * quarantine the basename here instead.
   */
  if (
    !Number.isSafeInteger(batchEndTime) ||
    batchEndTime < 0 ||
    batchEndTime > 0xffffffff ||
    !Number.isSafeInteger(batchNum) ||
    batchNum < 0 ||
    batchNum > 0x7fffffff
  ) {
    return null;
  }
  /**
   * Reject non-canonical spellings such as `001_2.kwub` that parse to
   * the same numeric pair as `1_2.kwub`. Two aliases pointing at the
   * same parsed numbers would cause `listBatches` to rebuild a single
   * canonical path and stat / return the wrong on-disk file (or
   * duplicate the same entry). Round-tripping through
   * `formatBatchFilename` enforces the canonical leading-digit shape
   * with no extra regex complexity.
   */
  if (basename !== formatBatchFilename({ batchEndTime, batchNum })) {
    return null;
  }
  return { batchEndTime, batchNum };
}

export type { BatchFilePathArgs, FormatBatchFilenameArgs, ParsedBatchFilename };
export {
  BATCH_FILENAME_PATTERN,
  BATCH_FILE_EXTENSION,
  batchFilePath,
  formatBatchFilename,
  parseBatchFilename,
};
