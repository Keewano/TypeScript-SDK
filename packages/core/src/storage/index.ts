/**
 * Storage abstraction: the `StorageAdapter` contract used by the SDK's
 * batch persistence, identity, and consent layers, plus an in-memory
 * implementation for tests and helpers shared by the platform adapters
 * (`bytesToBase64`/`base64ToBytes`, `globToRegex`).
 *
 * Platform-specific adapters (bare RN, Expo) live in their respective
 * platform packages and consume this contract.
 */

export type {
  DeleteFileArgs,
  FileSizeArgs,
  ListFilesArgs,
  ReadFileArgs,
  StorageAdapter,
  WriteFileArgs,
} from './types/adapter';
export type { MutationCoordinatorRunArgs } from './types/mutationCoordinator';
export type { ValidPath } from './types/path';
export { base64ToBytes, bytesToBase64 } from './helpers/base64';
export { globToRegex } from './helpers/glob';
export { MutationCoordinator } from './helpers/mutationCoordinator';
export { generateOpId } from './helpers/opId';
export {
  URI_SCHEME_PREFIX,
  WINDOWS_DRIVE_LETTER,
  normalizeRelativePath,
  validPath,
} from './helpers/path';
export {
  SCRATCH_BAK_INFIX,
  SCRATCH_DEL_INFIX,
  SCRATCH_SIBLING_PATTERN,
  SCRATCH_TMP_INFIX,
  isScratchSibling,
} from './helpers/scratchSiblings';
export { MemoryStorageAdapter } from './adapter';
