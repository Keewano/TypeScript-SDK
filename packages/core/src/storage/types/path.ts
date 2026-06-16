/**
 * Args type for the path-shape validator.
 */

/**
 * path - Adapter-relative path or directory to validate.
 * fnName - Name of the calling function. Embedded in the thrown
 *   error message so the violation points at the caller, not at the
 *   validator.
 */
interface ValidPath {
  path: string;
  fnName: string;
}

/**
 * relativePath - Adapter-relative path to normalize and validate.
 * fnName - Name of the calling function. Embedded in the thrown error
 *   message so the violation points at the caller, not at the helper.
 */
interface NormalizeRelativePathArgs {
  relativePath: string;
  fnName: string;
}

export type { NormalizeRelativePathArgs, ValidPath };
