/**
 * Expo storage layer. Re-exports the `StorageAdapter` contract from
 * `@keewano/core` for convenience and the Expo-specific
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
export type { ExpoFileSystemLike, ExpoStorageAdapterArgs } from './types/expoStorageAdapter';
export { ExpoStorageAdapter } from './expoStorageAdapter';
