/**
 * On-disk persistence of the QA test-user marker name. The name is
 * loaded on SDK init so the marker survives an app restart; it is
 * written through every `Keewano.markAsTestUser` call. Absence of
 * the file means the current install is not flagged as a test user
 * and no `K-Tester` HTTP header should travel with outgoing batches.
 *
 * The on-disk payload is the raw UTF-8 encoding of the name and
 * each layer (persist / load) revalidates against the same
 * ByteString contract the HTTP header layer enforces, so a value
 * that survives the round-trip is guaranteed to ship as a valid
 * header.
 */

import type { PersistTestUserNameArgs, TestUserStorageArgs } from './types/testUser';

import { hasControlChar, isByteString } from '../validation';

import { TEST_USER_FILENAME, TEST_USER_MAX_LENGTH } from './helpers/constants';

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

/**
 * `true` when `value` is empty, whitespace-only, oversized, contains
 * a CR or LF (header-injection vector), or contains a code point
 * above 0xFF. The persistence boundary refuses to write such values
 * to disk, and the load boundary refuses to return them. Mirrors the
 * dispatcher's `markAsTestUser` runtime contract so a value that
 * survives the disk round-trip is guaranteed to ship as a valid
 * `K-Tester` header.
 *
 * Uses `trim().length === 0` rather than a raw length check so a
 * corrupted on-disk marker like `'   '` (whitespace-only) is also
 * rejected at the load boundary - the persist boundary already
 * trims its input, so this aligns the two layers on the same
 * "non-blank" contract.
 */
function isRejected(value: string): boolean {
  return (
    value.trim().length === 0 ||
    value.length > TEST_USER_MAX_LENGTH ||
    hasControlChar(value) ||
    !isByteString(value)
  );
}

/**
 * Read the persisted test-user name from disk, or `null` when no
 * marker exists or the persisted value is no longer header-safe.
 *
 * A corrupted file (invalid UTF-8, non-ByteString characters,
 * oversized) is treated as no marker AND deleted from disk so the
 * SDK does not keep re-reading the same poison on every launch.
 *
 * @returns The validated name, or `null` when no usable marker is
 *   on disk.
 */
async function loadTestUserName(args: TestUserStorageArgs): Promise<string | null> {
  const { storage } = args;
  /**
   * Invalid-marker cleanup is best-effort. The JSDoc above promises
   * "no marker" semantics for corrupted / empty / out-of-spec
   * files, so a transient `storage.deleteFile` failure must NOT
   * propagate out of `loadTestUserName` and reject the surrounding
   * `init()`. The next launch will retry the delete; the in-memory
   * return remains `null` so the K-Tester header is suppressed for
   * this session either way.
   */
  const safeDeleteMarker = async (): Promise<void> => {
    try {
      await storage.deleteFile({ path: TEST_USER_FILENAME });
    } catch {
      /** Cleanup is best-effort; invalid markers should not block init. */
    }
  };
  /**
   * Bound the read BEFORE pulling bytes into memory and decoding. A
   * valid name is at most `TEST_USER_MAX_LENGTH` ByteString chars, so
   * its UTF-8 encoding is at most 2 bytes per char; `* 4` is a
   * generous ceiling that still covers benign surrounding whitespace
   * stripped on load. A larger file is corrupt or hostile (an
   * appended-garbage / inflated marker), and decoding it would
   * allocate a giant string only to reject it via the length check
   * below - on every launch. Probe `fileSize` first and short-circuit
   * to delete + `null` so an oversized marker is cleaned up without a
   * full read.
   */
  const size = await storage.fileSize({ path: TEST_USER_FILENAME });
  if (size !== null && size > TEST_USER_MAX_LENGTH * 4) {
    await safeDeleteMarker();
    return null;
  }
  const bytes = await storage.readFile({ path: TEST_USER_FILENAME });
  if (bytes === null) {
    return null;
  }
  if (bytes.length === 0) {
    /**
     * Zero-byte marker file: nothing to load AND nothing useful to
     * keep on disk. Delete so the SDK does not have to re-handle
     * the same empty payload on every launch.
     */
    await safeDeleteMarker();
    return null;
  }
  let decoded: string;
  try {
    decoded = decoder.decode(bytes);
  } catch {
    /** Corrupted UTF-8; discard so we do not keep re-decoding garbage. */
    await safeDeleteMarker();
    return null;
  }
  /**
   * Validate the RAW decoded value for header-control characters
   * AND for ByteString conformance BEFORE the trim. JS
   * `String.prototype.trim()` strips much more than ASCII spaces
   * (CR / LF / TAB plus every Unicode-whitespace code point like
   * `<U+1680>`, `<U+2028>`, etc.). Without these raw checks a marker
   * like `'\rqa-user'` or `'<U+1680>qa-user'` would be silently
   * normalized to a clean-looking name and pass validation,
   * bypassing the dispatcher's runtime contract. Catching the raw
   * value here keeps the load layer aligned with that contract:
   * corrupted / out-of-spec markers get deleted, never normalized.
   */
  if (hasControlChar(decoded) || !isByteString(decoded)) {
    await safeDeleteMarker();
    return null;
  }
  /**
   * Trim on load to match `persistTestUserName`'s trim-on-write
   * contract for benign whitespace (spaces). A marker file written
   * directly (by an older SDK version, by a host's diagnostic
   * tool, etc.) might contain surrounding spaces; returning it raw
   * would put a different value in the K-Tester header than what
   * the persist boundary would have produced for the same input.
   * The load is read-only - the on-disk bytes are NOT rewritten,
   * only the returned value is canonicalized.
   */
  const name = decoded.trim();
  if (isRejected(name)) {
    await safeDeleteMarker();
    return null;
  }
  return name;
}

/**
 * Persist `testUserName` so it survives the next launch. The
 * persistence boundary mirrors the HTTP header contract: empty /
 * whitespace-only / oversized / non-ByteString names short-circuit
 * to a delete instead of writing, so the disk never holds a value
 * the network layer would reject.
 *
 * @throws Whatever the storage adapter throws on `writeFile` /
 *   `deleteFile`. The public API wrapper catches and surfaces via
 *   `console.error` since the call is fire-and-forget.
 */
async function persistTestUserName(args: PersistTestUserNameArgs): Promise<void> {
  const { storage, testUserName } = args;
  /**
   * Reject raw header-control characters AND raw non-ByteString
   * input BEFORE the trim. JS `trim()` strips much more than
   * ASCII spaces (CR / LF / TAB plus every Unicode-whitespace
   * code point like `<U+1680>`, `<U+2028>`, etc.). Without these raw
   * checks an input like `'\rqa-user'` or `'<U+1680>qa-user'`
   * would be silently normalized to a clean-looking name and
   * persisted - hiding out-of-contract caller input instead of
   * enforcing the dispatcher boundary. On rejection we delete the
   * existing marker so a re-flag with the same raw input does not
   * leave a stale value on disk.
   */
  if (
    typeof testUserName !== 'string' ||
    hasControlChar(testUserName) ||
    !isByteString(testUserName)
  ) {
    await storage.deleteFile({ path: TEST_USER_FILENAME });
    return;
  }
  const trimmed = testUserName.trim();
  if (isRejected(trimmed)) {
    await storage.deleteFile({ path: TEST_USER_FILENAME });
    return;
  }
  await storage.writeFile({
    path: TEST_USER_FILENAME,
    bytes: encoder.encode(trimmed),
  });
}

/**
 * Remove the persisted test-user marker. Idempotent: deleting a
 * missing file is a no-op per the `StorageAdapter` contract.
 */
async function clearTestUserName(args: TestUserStorageArgs): Promise<void> {
  const { storage } = args;
  await storage.deleteFile({ path: TEST_USER_FILENAME });
}

export { clearTestUserName, loadTestUserName, persistTestUserName };
