/**
 * Args and dependency-injection types for the Expo
 * `StorageAdapter` implementation.
 */

/**
 * String encodings the Expo file-system methods accept.
 */
type ExpoFileEncoding = 'base64' | 'utf8';

/**
 * Optional encoding selector accepted by `writeAsStringAsync` and
 * `readAsStringAsync`. Extracted to keep the two signatures in sync.
 *
 * encoding - String encoding tag. Defaults are method-specific; pass
 *   explicitly to avoid surprises.
 */
interface ExpoEncodingOption {
  encoding?: ExpoFileEncoding;
}

/**
 * Optional `{ idempotent: true }` flag accepted by `deleteAsync`.
 *
 * idempotent - When true, a missing path resolves successfully instead
 *   of throwing.
 */
interface ExpoDeleteOption {
  idempotent?: boolean;
}

/**
 * Optional `{ size: true }` flag accepted by `getInfoAsync`. The
 * returned `size` field is populated only when this is set.
 *
 * size - Request the byte length be included in the result.
 */
interface ExpoGetInfoOption {
  size?: boolean;
}

/**
 * Optional `{ intermediates: true }` flag accepted by
 * `makeDirectoryAsync`. Mirrors `mkdir -p`.
 *
 * intermediates - Create missing parent directories as needed.
 */
interface ExpoMakeDirectoryOption {
  intermediates?: boolean;
}

/**
 * Result of `getInfoAsync`. `size` is populated only when the call
 * passes `{ size: true }`; `isDirectory` is populated only when the
 * path exists.
 *
 * exists - True when the URI resolves to a real entry.
 * size - Byte length, when requested.
 * isDirectory - True for directories, false for regular files.
 */
interface ExpoFileInfo {
  exists: boolean;
  size?: number;
  isDirectory?: boolean;
}

/**
 * Args bag for `moveAsync`.
 *
 * from - Source URI.
 * to - Destination URI. Must not already exist.
 */
interface ExpoMoveArgs {
  from: string;
  to: string;
}

/**
 * Subset of `expo-file-system` actually used by `ExpoStorageAdapter`.
 *
 * documentDirectory - URI of the host app's document directory, or
 *   `null` when unavailable.
 * writeAsStringAsync - Write a string to a URI in the given encoding.
 * readAsStringAsync - Read a URI's contents as a string in the given
 *   encoding.
 * deleteAsync - Delete a URI. Pass `{ idempotent: true }` to suppress
 *   the throw on a missing path.
 * getInfoAsync - Probe a URI. Resolve includes `size` only when
 *   `{ size: true }` is passed.
 * readDirectoryAsync - List the direct children of a directory URI.
 * makeDirectoryAsync - Create a directory; `{ intermediates: true }`
 *   is mkdir -p semantics.
 * moveAsync - Move / rename a URI. Fails if the destination already
 *   exists.
 */
interface ExpoFileSystemLike {
  documentDirectory: string | null;
  writeAsStringAsync(uri: string, contents: string, options?: ExpoEncodingOption): Promise<void>;
  readAsStringAsync(uri: string, options?: ExpoEncodingOption): Promise<string>;
  deleteAsync(uri: string, options?: ExpoDeleteOption): Promise<void>;
  getInfoAsync(uri: string, options?: ExpoGetInfoOption): Promise<ExpoFileInfo>;
  readDirectoryAsync(uri: string): Promise<string[]>;
  makeDirectoryAsync(uri: string, options?: ExpoMakeDirectoryOption): Promise<void>;
  moveAsync(args: ExpoMoveArgs): Promise<void>;
}

/**
 * Constructor args for `ExpoStorageAdapter`.
 *
 * rootDir - Sandbox root URI used as the prefix for all file-store
 *   paths. Defaults to `{documentDirectory}keewano/`. Must end with a
 *   slash.
 * fileSystem - Override the FileSystem module. Pass a mock in tests;
 *   in production, imported lazily from `expo-file-system`.
 */
interface ExpoStorageAdapterArgs {
  fileSystem?: ExpoFileSystemLike;
  rootDir?: string;
}

export type {
  ExpoDeleteOption,
  ExpoEncodingOption,
  ExpoFileEncoding,
  ExpoFileInfo,
  ExpoFileSystemLike,
  ExpoGetInfoOption,
  ExpoMakeDirectoryOption,
  ExpoMoveArgs,
  ExpoStorageAdapterArgs,
};
