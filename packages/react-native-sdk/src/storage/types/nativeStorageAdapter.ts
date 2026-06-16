/**
 * Args and dependency-injection types for the bare-React-Native
 * `StorageAdapter` implementation.
 */

/**
 * Stat-style entry returned by `readDir`. The real `react-native-fs`
 * module also exposes `path`/`mtime`/`ctime`; the adapter only needs
 * the basename and the type discriminators so the contract narrows.
 *
 * isDirectory - True when the entry is a directory.
 * isFile - True when the entry is a regular file.
 * name - Basename of the entry.
 */
interface RNFSDirEntry {
  isDirectory(): boolean;
  isFile(): boolean;
  name: string;
}

/**
 * Result of `stat`. `size` is a `number` on iOS and a numeric `string`
 * on Android; callers must coerce defensively.
 *
 * isDirectory - True when the path is a directory.
 * isFile - True when the path is a regular file.
 * size - Byte length. iOS yields `number`, Android yields `string`.
 */
interface RNFSStatResult {
  isDirectory(): boolean;
  isFile(): boolean;
  size: number | string;
}

/**
 * Subset of `react-native-fs` actually used by `BareRNStorageAdapter`.
 *
 * DocumentDirectoryPath - Absolute path to the host app's document
 *   directory.
 * exists - Resolve with `true` when the path exists, `false`
 *   otherwise.
 * mkdir - Create the directory; succeeds idempotently when it
 *   already exists.
 * writeFile - Write `contents` to `path` using the given string
 *   encoding.
 * readFile - Read a file's contents as a string in the given
 *   encoding.
 * unlink - Remove a file. Throws on a missing path.
 * moveFile - Move / rename a file. Fails when the destination
 *   already exists on Android.
 * readDir - List the direct children of a directory.
 * stat - Stat a file or directory.
 */
interface RNFSLike {
  DocumentDirectoryPath: string;
  writeFile(path: string, contents: string, encoding: string): Promise<void>;
  readFile(path: string, encoding: string): Promise<string>;
  moveFile(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  unlink(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  readDir(path: string): Promise<RNFSDirEntry[]>;
  stat(path: string): Promise<RNFSStatResult>;
}

/**
 * Constructor args for `BareRNStorageAdapter`.
 *
 * rootDir - Absolute on-disk directory that the adapter treats as its
 *   sandbox root. Defaults to `{DocumentDirectoryPath}/keewano`. All
 *   file-store paths are resolved relative to this directory.
 * rnfs - Override the react-native-fs module. Pass a mock in tests;
 *   in production, imported lazily from `react-native-fs`.
 */
interface BareRNStorageAdapterArgs {
  rootDir?: string;
  rnfs?: RNFSLike;
}

export type { BareRNStorageAdapterArgs, RNFSDirEntry, RNFSLike, RNFSStatResult };
