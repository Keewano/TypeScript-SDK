/**
 * Shared path-shape validator for the file-pool side of
 * `StorageAdapter` implementations. Rejects:
 *   - empty paths,
 *   - absolute paths (POSIX `/foo`, Windows `\foo` / `C:\foo`, URI
 *     scheme `file:///foo` / `http://...`, single-slash URI
 *     `file:/foo`),
 *   - traversal segments (`..`),
 *   - non-canonical aliases (`.`, doubled separators, percent-encoded
 *     forms, `?` / `#`).
 *
 * Adapters call this on every public entry point that accepts a path
 * so a misbehaving caller cannot escape the SDK-owned sandbox via
 * `../../` or URI aliasing.
 *
 * @example
 * ```ts
 * validPath({ path: '../../etc/passwd', fnName: 'readFile' });
 * // throws: readFile: path traversal
 * ```
 */

import type { NormalizeRelativePathArgs, ValidPath } from '../types/path';

/**
 * Matches a Windows drive-letter absolute path (`C:\foo` / `C:/foo`).
 * Exported so platform adapters can reuse the same shape in their
 * defense-in-depth resolvers.
 */
const WINDOWS_DRIVE_LETTER = /^[A-Za-z]:[\\/]/;
/**
 * Matches both `scheme://` (e.g. `file://`, `http://`) AND `scheme:/`
 * (e.g. `file:/tmp/x`, `content:/foo`). The single-slash shape is
 * still an absolute URI and would otherwise slip past the validator.
 * Exported so platform adapters can reuse the same shape in their
 * defense-in-depth resolvers.
 */
const URI_SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:(?:\/\/|\/)/;

/**
 * Throw `Error` when `path` is not a relative, non-traversing
 * adapter-relative path. The thrown message is prefixed with `fnName`
 * so the caller site is identifiable.
 *
 * @param args - The path to validate and the calling function's name.
 * @throws Error when the path is empty, absolute, contains a `..`
 *   segment, or is non-canonical.
 */
function validPath({ path, fnName }: ValidPath): void {
  if (path.length === 0) {
    throw new Error(`${fnName}: empty path`);
  }
  /** Normalize backslashes so raw and decoded views share separators. */
  const rawNormalized = path.replaceAll('\\', '/');
  /**
   * URI-based filesystems decode `%XX` before resolving, so percent-
   * encoded `/` and `..` would bypass plain string checks. Pre-escape
   * stray `%` (literal-percent like `100% complete.txt`) so decode
   * expands genuine `%XX` while preserving literal `%`.
   */
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawNormalized.replaceAll(/%(?![0-9A-Fa-f]{2})/g, '%25'));
  } catch {
    throw new Error(`${fnName}: invalid percent-encoding`);
  }
  /** Re-normalize so a decoded `\` (from `%5c`) lines up. */
  const decodedNormalized = decoded.replaceAll('\\', '/');
  if (
    decodedNormalized.startsWith('/') ||
    WINDOWS_DRIVE_LETTER.test(decodedNormalized) ||
    URI_SCHEME_PREFIX.test(decodedNormalized)
  ) {
    throw new Error(`${fnName}: absolute path`);
  }
  /**
   * Reject ANY input whose decoded form differs from its raw view.
   * `with%20space` decodes to a different on-disk name than
   * `with space` but URI-based filesystems treat them as the same
   * file, so accept only the canonical (decoded) spelling.
   */
  if (decodedNormalized !== rawNormalized) {
    throw new Error(`${fnName}: non-canonical path`);
  }
  /**
   * Reject `?` and `#`: URI-based filesystems treat them as the
   * query / fragment delimiters and would address the wrong file.
   */
  if (decodedNormalized.includes('?') || decodedNormalized.includes('#')) {
    throw new Error(`${fnName}: non-canonical path`);
  }
  const segments = decodedNormalized.split('/');
  if (segments.includes('..')) {
    throw new Error(`${fnName}: path traversal`);
  }
  /**
   * Reject `.` segments and doubled separators (`foo//bar`, leading
   * `./foo`). A single trailing separator (`batches/`) is allowed.
   */
  if (segments.includes('.') || segments.slice(0, -1).includes('')) {
    throw new Error(`${fnName}: non-canonical path`);
  }
}

/**
 * Normalize and security-validate an adapter-relative path for the
 * platform storage adapters, returning the canonical relative form to
 * join under a sandbox root. Shared by the bare-RN and Expo adapters
 * so the traversal / URI-aliasing / percent-encoding defenses live in
 * one place instead of drifting between two near-identical copies.
 *
 * Rejects multiple trailing slashes, strips a single trailing slash,
 * percent-decodes (to defeat encoded `..` / `/` / `\`), and rejects
 * absolute shapes, traversal, `?` / `#`, and non-canonical aliases.
 * The caller appends the returned value to its own root (the bare-RN
 * root needs a separator, the Expo root already ends with one), so
 * this helper deliberately returns the relative form and not the
 * joined path.
 *
 * @param args - Adapter-relative path and the calling function's name.
 * @returns The canonical, sandbox-safe relative path.
 * @throws Error when the path escapes the sandbox or is non-canonical.
 */
function normalizeRelativePath({ relativePath, fnName }: NormalizeRelativePathArgs): string {
  const rawNormalized = relativePath.replaceAll('\\', '/');
  /**
   * Reject multiple trailing slashes: `foo//` and `foo///` would alias
   * `foo/` after the single-slash strip below, and the segments-empty
   * check ignores the last segment.
   */
  let trailingSlashes = 0;
  let probeIdx = rawNormalized.length - 1;
  while (probeIdx >= 0 && rawNormalized.codePointAt(probeIdx) === 0x2f /* '/' */) {
    trailingSlashes += 1;
    probeIdx -= 1;
  }
  if (trailingSlashes > 1) {
    throw new Error(`${fnName}: path must stay within the storage root`);
  }
  /**
   * `validPath` accepts `foo/`, so strip the single trailing slash to
   * match the `MemoryStorageAdapter` on-disk shape.
   */
  const normalized = rawNormalized.substring(0, rawNormalized.length - trailingSlashes);
  /**
   * Decode percent escapes before checking so encoded `%2e%2e/secret`,
   * `%2fetc`, `%5cfoo` cannot slip past defense-in-depth. Stray `%`
   * (literal-percent like `100% complete.txt`) is preserved by
   * pre-escaping to `%25`.
   */
  let decoded: string;
  try {
    decoded = decodeURIComponent(normalized.replaceAll(/%(?![0-9A-Fa-f]{2})/g, '%25'));
  } catch {
    throw new Error(`${fnName}: invalid percent-encoding`);
  }
  /** Re-normalize so a decoded `\` (from `%5c`) is treated as a separator. */
  decoded = decoded.replaceAll('\\', '/');
  /**
   * Reject every absolute shape, traversal, any percent-encoded
   * character (decoded != raw), and non-canonical aliases.
   */
  const segments = decoded.split('/');
  if (
    decoded.length === 0 ||
    decoded.startsWith('/') ||
    WINDOWS_DRIVE_LETTER.test(decoded) ||
    URI_SCHEME_PREFIX.test(decoded) ||
    decoded !== normalized ||
    decoded.includes('?') ||
    decoded.includes('#') ||
    segments.includes('..') ||
    segments.includes('.') ||
    segments.slice(0, -1).includes('')
  ) {
    throw new Error(`${fnName}: path must stay within the storage root`);
  }
  return normalized;
}

export { URI_SCHEME_PREFIX, WINDOWS_DRIVE_LETTER, normalizeRelativePath, validPath };
