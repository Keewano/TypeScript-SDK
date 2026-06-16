/**
 * Args types for the Expo path helpers. Each helper takes a small
 * options bag so the call sites read self-documentingly and adding
 * new fields stays non-breaking.
 */

import type { ExpoFileSystemLike } from './expoStorageAdapter';

/**
 * explicit - User-supplied `rootDir` override or `undefined` when
 *   none was given.
 * documentDirectory - Runtime `documentDirectory` URI from
 *   `expo-file-system`, or `null` when the host does not expose one.
 */
interface ComputeRootDirArgs {
  documentDirectory: string | null;
  explicit: string | undefined;
}

/**
 * rootDir - Sandbox root URI (must end with a slash).
 * relativePath - Adapter-relative path to concatenate.
 */
interface ResolveUnderRootArgs {
  relativePath: string;
  rootDir: string;
}

/**
 * fileSystem - File-system handle used to probe / create the parent
 *   directory.
 * fullUri - Fully-qualified URI whose parent must exist.
 */
interface EnsureParentDirArgs {
  fileSystem: ExpoFileSystemLike;
  fullUri: string;
}

export type { ComputeRootDirArgs, EnsureParentDirArgs, ResolveUnderRootArgs };
