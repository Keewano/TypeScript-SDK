/**
 * Bare React Native storage layer. Re-exports the `StorageAdapter`
 * contract from `@keewano/core` for convenience so consumers do not
 * need a separate dependency on the core package, plus the bare-RN
 * `StorageAdapter` implementation.
 */

export type {
  DeleteFileArgs,
  FileSizeArgs,
  ListFilesArgs,
  ReadFileArgs,
  StorageAdapter,
  WriteFileArgs,
} from '@keewano/core';
export type { BareRNStorageAdapterArgs, RNFSLike } from './types/nativeStorageAdapter';
export { BareRNStorageAdapter } from './nativeStorageAdapter';
