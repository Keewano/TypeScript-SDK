/**
 * Glob-to-RegExp translator used by `StorageAdapter.listFiles` to
 * filter directory listings by a simple wildcard pattern.
 *
 * Supports two metacharacters:
 *   - `*` matches any run of characters (including the empty run).
 *   - `?` matches any single character.
 * All other regex metacharacters are escaped so they match literally,
 * keeping the surface compatible with filenames that contain `.`, `+`,
 * brackets, and other punctuation. There is no escape syntax: a literal
 * `*` or `?` cannot be matched, since both are always wildcards.
 *
 * @example
 * ```ts
 * const regex = globToRegex('*.kwub');
 * regex.test('batch_1.kwub'); // true
 * regex.test('notes.txt');    // false
 * ```
 */

/**
 * Translate a simple glob (`*` for any run, `?` for any single char)
 * into an anchored regular expression.
 */
function globToRegex(pattern: string): RegExp {
  /**
   * Collapse runs of consecutive `*` into one before translating.
   * `**` is semantically identical to `*` for a flat basename match,
   * but `.*.*` is a regex backtracking trap on a long non-matching
   * subject. Collapsing removes that trap while preserving the match
   * set exactly.
   */
  const collapsed = pattern.replaceAll(/\*+/g, '*');
  const escaped = collapsed.replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`);
  const wildcarded = escaped.replaceAll('*', '.*').replaceAll('?', '.');
  return new RegExp(`^${wildcarded}$`);
}

export { globToRegex };
