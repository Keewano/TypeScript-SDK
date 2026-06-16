/**
 * Args and contract types for the storage abstraction.
 *
 * The `StorageAdapter` interface is the SDK's single boundary between
 * the platform-agnostic core and whatever persistence the host
 * environment provides. Every durable value - identifiers, consent,
 * the test-user marker, and the serialized `.kwub` batches - is a file
 * under an SDK-owned root directory, so an adapter needs only one
 * native file API.
 *
 * All methods are Promise-based so adapters can wrap async native
 * APIs without leaking that asynchrony detail into the interface.
 *
 * Lookup operations return `null` when the requested path is absent;
 * they do not throw. Delete is idempotent: deleting a missing path is
 * a no-op, not an error. `writeFile` provides best-effort atomicity: a
 * fresh write is atomic; overwriting an existing file is only atomic
 * on platforms that expose a single replace-and-rename primitive (see
 * `writeFile` JSDoc for details).
 */

/**
 * path - Adapter-relative file path. Adapters resolve it against an
 *   SDK-owned root directory; callers must not pass absolute paths.
 * bytes - File contents. Adapters take a defensive snapshot before
 *   returning, so the caller may safely mutate the buffer afterwards.
 */
interface WriteFileArgs {
  path: string;
  bytes: Uint8Array;
}

/**
 * path - Adapter-relative file path.
 */
interface ReadFileArgs {
  path: string;
}

/**
 * path - Adapter-relative file path. Deleting a missing path is a
 *   no-op, not an error.
 */
interface DeleteFileArgs {
  path: string;
}

/**
 * dir - Adapter-relative directory path. Only direct children are
 *   returned; the listing does not recurse.
 * pattern - Optional glob filter applied to the returned basenames.
 *   Supports `*` (any run of characters) and `?` (any single
 *   character). Other regex metacharacters are treated as literals.
 */
interface ListFilesArgs {
  dir: string;
  pattern?: string;
}

/**
 * path - Adapter-relative file path.
 */
interface FileSizeArgs {
  path: string;
}

/**
 * Platform-agnostic persistence contract used by the SDK's storage,
 * batch persistence, identity, and consent layers. Concrete adapters
 * live in the platform packages (`@keewano/react-native-sdk` for bare
 * RN, `@keewano/react-native-expo-sdk` for Expo). Tests use
 * `MemoryStorageAdapter` from `@keewano/core`.
 *
 * writeFile - Write a file with best-effort atomicity. Adapters route
 *   the bytes through a tmp-file sibling and rename it over the
 *   destination. A fresh write to a new path is atomic on all
 *   platforms; overwriting an existing file is only atomic when the
 *   host filesystem exposes a single replace-and-rename primitive
 *   (e.g. POSIX `rename(2)`). React Native's `moveFile` and Expo's
 *   `moveAsync` do NOT expose such a primitive; adapters fall back to
 *   delete-then-move, which opens a short window in which the
 *   destination does not exist. Readers may observe `null` from
 *   `readFile` during that window. Callers needing strict atomicity
 *   on overwrite must write to a fresh path and update the pointer
 *   separately.
 * readFile - Read a file in full. Resolves with `null` when the path
 *   does not exist; throws only on lower-level I/O errors.
 * deleteFile - Remove a file. Resolves successfully when the path did
 *   not exist. Throws only on lower-level I/O errors.
 * listFiles - List the direct children of a directory, optionally
 *   filtered by a glob pattern. Resolves with an empty array when the
 *   directory is missing or has no matching entries.
 * fileSize - Return the byte length of a file. Resolves with `null`
 *   when the path does not exist.
 */
interface StorageAdapter {
  writeFile(args: WriteFileArgs): Promise<void>;
  readFile(args: ReadFileArgs): Promise<Uint8Array | null>;
  deleteFile(args: DeleteFileArgs): Promise<void>;
  listFiles(args: ListFilesArgs): Promise<string[]>;
  fileSize(args: FileSizeArgs): Promise<number | null>;
}

export type {
  DeleteFileArgs,
  FileSizeArgs,
  ListFilesArgs,
  ReadFileArgs,
  StorageAdapter,
  WriteFileArgs,
};
