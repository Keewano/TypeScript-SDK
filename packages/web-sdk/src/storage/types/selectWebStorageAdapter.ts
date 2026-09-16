/** Args types for the storage probe/selection entry point. */

/**
 * indexedDB - `IDBFactory` override; tests inject `fake-indexeddb`
 *   or `null` to model an environment with no IndexedDB API at all.
 *   Defaults to `globalThis.indexedDB`.
 * dbName - Database name forwarded to the IndexedDB adapter.
 */
interface SelectWebStorageAdapterArgs {
  indexedDB?: IDBFactory | null;
  dbName?: string;
}

export type { SelectWebStorageAdapterArgs };
