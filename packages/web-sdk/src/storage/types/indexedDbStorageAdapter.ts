/** Args types for the IndexedDB storage adapter. */

/**
 * indexedDB - `IDBFactory` override; tests inject `fake-indexeddb`.
 *   Defaults to `globalThis.indexedDB`.
 * dbName - Database name override. Defaults to `'keewano-sdk'`;
 *   override only in tests that need isolated databases.
 */
interface IndexedDbStorageAdapterArgs {
  indexedDB?: IDBFactory;
  dbName?: string;
}

/**
 * db - Database handle inside the `upgradeneeded` event.
 * oldVersion - Schema version the database was at before this open.
 */
interface MigrateSchemaArgs {
  db: IDBDatabase;
  oldVersion: number;
}

/**
 * path - Normalized key to check for logical-directory children.
 * fnName - Calling function's name, prefixed onto the thrown message.
 */
interface ThrowIfDirectoryArgs {
  path: string;
  fnName: string;
}

/**
 * Live readwrite-transaction context handed to a mutation callback.
 *
 * files - Object store holding the payload bytes.
 * meta - Object store holding the byte length per path.
 * fail - Abort the transaction; the mutation promise rejects with
 *   `error` instead of the transaction's own (null on manual abort)
 *   error.
 */
interface MutateContext {
  files: IDBObjectStore;
  meta: IDBObjectStore;
  fail(error: Error): void;
}

/**
 * store - Object store of the LIVE readwrite transaction the guard
 *   must run inside.
 * key - Normalized destination key whose ancestors are checked.
 * fail - Abort-and-reject callback from the transaction context.
 * onClear - Continuation issued (still inside the transaction) when
 *   no ancestor is occupied by a file.
 */
interface GuardParentsAreFreeArgs {
  store: IDBObjectStore;
  key: string;
  fail(error: Error): void;
  onClear(): void;
}

/**
 * store - Object store of the LIVE readwrite transaction the guard
 *   must run inside.
 * key - Normalized key that must not be a logical directory.
 * errorMessage - Terse message the transaction rejects with when a
 *   child key exists.
 * fail - Abort-and-reject callback from the transaction context.
 * onClear - Continuation issued (still inside the transaction) when
 *   `key` has no children.
 */
interface GuardNoChildrenArgs {
  store: IDBObjectStore;
  key: string;
  errorMessage: string;
  fail(error: Error): void;
  onClear(): void;
}

export type {
  GuardNoChildrenArgs,
  GuardParentsAreFreeArgs,
  IndexedDbStorageAdapterArgs,
  MigrateSchemaArgs,
  MutateContext,
  ThrowIfDirectoryArgs,
};
