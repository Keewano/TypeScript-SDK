import type { StorageAdapter } from '../../storage';

/**
 * Args bag for `loadTestUserName` and `clearTestUserName`.
 *
 * storage - Storage adapter that backs the test-user marker file.
 */
interface TestUserStorageArgs {
  storage: StorageAdapter;
}

/**
 * Args bag for `persistTestUserName`.
 *
 * storage - Storage adapter that backs the test-user marker file.
 * testUserName - Identifier to persist. Trimmed empty / oversized
 *   values are rejected at the boundary (write becomes a no-op or
 *   delete) so the disk never holds a value the HTTP header layer
 *   would refuse.
 */
interface PersistTestUserNameArgs {
  storage: StorageAdapter;
  testUserName: string;
}

export type { PersistTestUserNameArgs, TestUserStorageArgs };
