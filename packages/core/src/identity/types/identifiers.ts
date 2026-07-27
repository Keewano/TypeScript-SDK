/**
 * On-disk identity record. The 32-byte layout is 16 bytes
 * `installId` followed by 16 bytes `userId`, both in Microsoft
 * mixed-endian.
 *
 * installId - 16-byte mixed-endian UUID for the persistent install
 *   identity. Generated once at first launch via `newUuid`, then
 *   kept across app restarts. Never all-zero (corruption guard: a
 *   stored value that reads as all zeros is treated as missing and
 *   regenerated).
 * userId - 16-byte mixed-endian UUID for the developer-assigned
 *   user. Zero-filled until the host calls `setUserId`; the
 *   zero value is a legitimate "not set" sentinel, not a
 *   corruption signal.
 */
import type { StorageAdapter } from '../../storage';

interface UserIdentifiers {
  installId: Uint8Array;
  userId: Uint8Array;
}

/**
 * Args bag for `loadOrInitIdentifiers`.
 *
 * storage - Storage adapter that backs the identifiers file.
 */
interface LoadOrInitIdentifiersArgs {
  storage: StorageAdapter;
}

/**
 * Args bag for `persistIdentifiers`.
 *
 * storage - Storage adapter that backs the identifiers file.
 * identifiers - Identity to write. Both buffers must be 16 bytes.
 */
interface PersistIdentifiersArgs {
  storage: StorageAdapter;
  identifiers: UserIdentifiers;
}

export type { LoadOrInitIdentifiersArgs, PersistIdentifiersArgs, UserIdentifiers };
