/**
 * Args types for the bare-RN path helpers. Each helper takes a small
 * options bag so the call sites read self-documentingly and adding
 * new fields stays non-breaking.
 */

import type { RNFSLike } from './nativeStorageAdapter';

/**
 * rootDir - Sandbox root (no trailing slash).
 * relativePath - Adapter-relative path to join with the root.
 */
interface ResolveUnderRootArgs {
  rootDir: string;
  relativePath: string;
}

/**
 * rnfs - File-system handle used to probe / create the parent
 *   directory.
 * fullPath - Fully-qualified path whose parent must exist.
 */
interface EnsureParentDirArgs {
  rnfs: RNFSLike;
  fullPath: string;
}

export type { EnsureParentDirArgs, ResolveUnderRootArgs };
