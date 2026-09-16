/**
 * IndexedDB `StorageAdapter`: the durable browser event queue. One
 * database, two flat stores keyed by the normalized path: `files`
 * holds the payload bytes, `meta` the byte length - written in the
 * same transaction so `fileSize` never structured-clones a payload.
 * Logical-directory semantics mirror the filesystem-backed adapters,
 * and every mutation runs its guards AND its writes inside ONE
 * readwrite transaction (IndexedDB serializes overlapping readwrite
 * transactions, so interleaved calls cannot persist a file/directory
 * collision). The adapter itself grants no cross-tab exclusivity: the
 * tabs of an origin share this database, and it is their per-session
 * batch filenames that keep two queues from colliding on one path.
 */

import type {
  GuardNoChildrenArgs,
  GuardParentsAreFreeArgs,
  IndexedDbStorageAdapterArgs,
  MigrateSchemaArgs,
  MutateContext,
  ThrowIfDirectoryArgs,
} from './types/indexedDbStorageAdapter';

import {
  type DeleteFileArgs,
  type FileSizeArgs,
  type ListFilesArgs,
  type ReadFileArgs,
  type StorageAdapter,
  type WriteFileArgs,
  globToRegex,
  normalizeRelativePath,
  validPath,
} from '@keewano/core';

import { probeGlobal } from '../probeGlobal';

const DB_DEFAULTS = {
  /**
   * Database names share the origin namespace with the host page; the
   * `-sdk` suffix keeps a host's own `keewano` database from colliding.
   */
  NAME: 'keewano-sdk',
  VERSION: 1,
  FILES_STORE: 'files',
  META_STORE: 'meta',
} as const;

/** Settle an `IDBRequest` as a promise. */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = (): void => {
      resolve(request.result);
    };
    request.onerror = (): void => {
      reject(request.error ?? new Error('requestToPromise: request failed'));
    };
  });
}

/**
 * Schema migrations, run in ascending order so a database created at
 * any historical version replays every later step.
 */
function migrateSchema({ db, oldVersion }: MigrateSchemaArgs): void {
  if (oldVersion < 1) {
    db.createObjectStore(DB_DEFAULTS.FILES_STORE);
    db.createObjectStore(DB_DEFAULTS.META_STORE);
  }
}

class IndexedDbStorageAdapter implements StorageAdapter {
  private readonly factory: IDBFactory;
  private readonly dbName: string;
  private dbPromise: Promise<IDBDatabase> | null;

  constructor(args: IndexedDbStorageAdapterArgs = {}) {
    /**
     * Probed rather than read: the property getter throws a
     * SecurityError where storage is blocked for the context, and an
     * unavailable factory must reach the caller as this constructor's
     * own error, not as whatever the host chose to throw.
     */
    const factory =
      args.indexedDB ?? probeGlobal<IDBFactory>({ path: ['indexedDB'], methods: ['open'] });
    if (factory === undefined || factory === null) {
      throw new Error('IndexedDbStorageAdapter: indexedDB unavailable');
    }
    this.factory = factory;
    this.dbName = args.dbName ?? DB_DEFAULTS.NAME;
    this.dbPromise = null;
  }

  /**
   * Lazily open (and cache) the database connection. Cache lifecycle:
   * `versionchange` (a newer tab wants to upgrade) closes this
   * connection and drops the cache; `close` (browser force-closed:
   * eviction, corruption) drops the cache so the next call reconnects;
   * `blocked` (an older tab holds another version and will not close)
   * rejects instead of letting every storage call hang on a
   * never-settling open. Any rejection - including a synchronous
   * `factory.open` throw - drops the cache, so one transient denial
   * does not poison every later call.
   */
  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise !== null) {
      return this.dbPromise;
    }
    const opened = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.dbName, DB_DEFAULTS.VERSION);
      request.onupgradeneeded = (event): void => {
        migrateSchema({ db: request.result, oldVersion: event.oldVersion });
      };
      request.onblocked = (): void => {
        reject(new Error('openDb: open blocked'));
      };
      request.onsuccess = (): void => {
        const db = request.result;
        db.onversionchange = (): void => {
          db.close();
          this.invalidateDb(opened);
        };
        db.onclose = (): void => {
          this.invalidateDb(opened);
        };
        resolve(db);
      };
      request.onerror = (): void => {
        reject(request.error ?? new Error('openDb: open failed'));
      };
    });
    opened.catch((): void => {
      this.invalidateDb(opened);
    });
    this.dbPromise = opened;
    return opened;
  }

  /** Drop the cached connection promise if it is still the current one. */
  private invalidateDb(stale: Promise<IDBDatabase>): void {
    if (this.dbPromise === stale) {
      this.dbPromise = null;
    }
  }

  /**
   * Close the cached connection and forget it. The probe's timeout
   * path uses this so a late-resolving `open()` does not keep a
   * connection (and a potential versionchange lock) alive after the
   * selection already fell back to memory. Safe when nothing ever
   * opened or the open failed; a later operation reopens on demand.
   */
  async close(): Promise<void> {
    const pending = this.dbPromise;
    if (pending === null) return;
    this.dbPromise = null;
    let db: IDBDatabase;
    try {
      db = await pending;
    } catch {
      /** A failed open holds no connection. */
      return;
    }
    db.close();
  }

  private async readStore(storeName: string): Promise<IDBObjectStore> {
    const db = await this.openDb();
    return db.transaction(storeName, 'readonly').objectStore(storeName);
  }

  /**
   * Run one mutation - guards AND writes - in a single readwrite
   * transaction spanning both stores, settling on TRANSACTION
   * completion, not request success: IndexedDB can abort at commit
   * time (quota exhaustion) after the requests already fired
   * `onsuccess`, and resolving early would report a durable write
   * that never happened. `fail` records a guard error and aborts, so
   * guard rejections carry their own terse message instead of the
   * transaction's (null on manual abort) error.
   */
  private async mutate(run: (context: MutateContext) => void): Promise<void> {
    const db = await this.openDb();
    const transaction = db.transaction(
      [DB_DEFAULTS.FILES_STORE, DB_DEFAULTS.META_STORE],
      'readwrite',
    );
    return new Promise<void>((resolve, reject) => {
      let guardError: Error | null = null;
      transaction.oncomplete = (): void => {
        resolve();
      };
      transaction.onabort = (): void => {
        reject(guardError ?? transaction.error ?? new Error('mutate: transaction aborted'));
      };
      transaction.onerror = (): void => {
        reject(guardError ?? transaction.error ?? new Error('mutate: transaction failed'));
      };
      run({
        files: transaction.objectStore(DB_DEFAULTS.FILES_STORE),
        meta: transaction.objectStore(DB_DEFAULTS.META_STORE),
        fail: (error: Error): void => {
          guardError = error;
          transaction.abort();
        },
      });
    });
  }

  /**
   * All keys under `prefix + '/'`. No upper bound on the range: a
   * string bound built from a sentinel code unit (prefix + '/' +
   * U+FFFF) still sorts BELOW longer keys starting with that sentinel,
   * silently hiding them. Scan from the prefix and filter instead.
   */
  private async childKeys(prefix: string): Promise<string[]> {
    const store = await this.readStore(DB_DEFAULTS.FILES_STORE);
    const childPrefix = `${prefix}/`;
    const range = IDBKeyRange.lowerBound(childPrefix);
    const keys = (await requestToPromise(store.getAllKeys(range))) as string[];
    return keys.filter((key) => key.startsWith(childPrefix));
  }

  private async throwIfDirectory({ path, fnName }: ThrowIfDirectoryArgs): Promise<void> {
    const children = await this.childKeys(path);
    if (children.length > 0) {
      throw new Error(`${fnName}: path is a directory`);
    }
  }

  /**
   * In-transaction guard: reject when any ancestor of `key` is
   * occupied by a file. Each `getKey` probe is issued from the
   * previous request's `onsuccess`, which keeps the transaction alive
   * until the continuation runs.
   */
  private guardParentsAreFree({ store, key, fail, onClear }: GuardParentsAreFreeArgs): void {
    const segments = key.split('/');
    const checkFrom = (index: number): void => {
      if (index >= segments.length) {
        onClear();
        return;
      }
      const request = store.getKey(segments.slice(0, index).join('/'));
      request.onsuccess = (): void => {
        if (request.result !== undefined) {
          fail(new Error('writeFile: parent path is not a directory'));
          return;
        }
        checkFrom(index + 1);
      };
    };
    checkFrom(1);
  }

  /**
   * In-transaction guard: reject with `errorMessage` when `key` is a
   * logical directory. One `getKey(lowerBound(key + '/'))` probe
   * suffices: the first stored key at or after the child prefix
   * starts with it if and only if a child exists.
   */
  private guardNoChildren({ store, key, errorMessage, fail, onClear }: GuardNoChildrenArgs): void {
    const childPrefix = `${key}/`;
    const request = store.getKey(IDBKeyRange.lowerBound(childPrefix));
    request.onsuccess = (): void => {
      const first = request.result;
      if (typeof first === 'string' && first.startsWith(childPrefix)) {
        fail(new Error(errorMessage));
        return;
      }
      onClear();
    };
  }

  async writeFile({ path, bytes }: WriteFileArgs): Promise<void> {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('writeFile: not a Uint8Array');
    }
    validPath({ path, fnName: 'writeFile' });
    const key = normalizeRelativePath({ relativePath: path, fnName: 'writeFile' });
    /**
     * Snapshot synchronously, before the first await: (a) structured
     * clone serializes a view's ENTIRE underlying buffer (a 3-byte
     * subarray over a 1 MB buffer would persist 1 MB), and (b) the
     * caller may reuse its buffer once this call yields, corrupting
     * the bytes before the transaction clones them.
     */
    const snapshot = bytes.slice();

    /**
     * Guards and put share one readwrite transaction, so the
     * parent-is-file / destination-is-directory checks cannot go
     * stale between reading and writing (single-tab TOCTOU).
     */
    await this.mutate(({ files, meta, fail }) => {
      this.guardParentsAreFree({
        store: files,
        key,
        fail,
        onClear: (): void => {
          this.guardNoChildren({
            store: files,
            key,
            errorMessage: 'writeFile: destination path is a directory',
            fail,
            onClear: (): void => {
              files.put(snapshot, key);
              meta.put(snapshot.byteLength, key);
            },
          });
        },
      });
    });
  }

  async readFile({ path }: ReadFileArgs): Promise<Uint8Array | null> {
    validPath({ path, fnName: 'readFile' });
    const key = normalizeRelativePath({ relativePath: path, fnName: 'readFile' });
    const store = await this.readStore(DB_DEFAULTS.FILES_STORE);
    const stored = (await requestToPromise(store.get(key))) as Uint8Array | undefined;
    if (stored !== undefined) {
      return stored;
    }
    await this.throwIfDirectory({ path: key, fnName: 'readFile' });
    return null;
  }

  async deleteFile({ path }: DeleteFileArgs): Promise<void> {
    validPath({ path, fnName: 'deleteFile' });
    const key = normalizeRelativePath({ relativePath: path, fnName: 'deleteFile' });
    /** Directory guard and delete share one transaction; see `writeFile`. */
    await this.mutate(({ files, meta, fail }) => {
      this.guardNoChildren({
        store: files,
        key,
        errorMessage: 'deleteFile: path is a directory',
        fail,
        onClear: (): void => {
          files.delete(key);
          meta.delete(key);
        },
      });
    });
  }

  async listFiles({ dir, pattern }: ListFilesArgs): Promise<string[]> {
    validPath({ path: dir, fnName: 'listFiles' });
    const normalizedDir = normalizeRelativePath({ relativePath: dir, fnName: 'listFiles' });

    /**
     * Filesystem-backed adapters fail `readdir(file)`; mirror that so
     * a file target cannot silently look like an empty directory.
     */
    const store = await this.readStore(DB_DEFAULTS.FILES_STORE);
    const asFile = await requestToPromise(store.getKey(normalizedDir));
    if (asFile !== undefined) {
      throw new Error('listFiles: path is not a directory');
    }

    const dirPrefixLength = normalizedDir.length + 1;
    const directChildren = (await this.childKeys(normalizedDir))
      .map((key) => key.substring(dirPrefixLength))
      .filter((basename) => !basename.includes('/'));

    // Compare raw code units, not locale-sensitive collation, so the order matches IndexedDB key
    // order and stays stable across browsers/locales.
    directChildren.sort((a, b) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });

    if (pattern === undefined) {
      return directChildren;
    }
    const regex = globToRegex(pattern);
    return directChildren.filter((name) => regex.test(name));
  }

  async fileSize({ path }: FileSizeArgs): Promise<number | null> {
    validPath({ path, fnName: 'fileSize' });
    const key = normalizeRelativePath({ relativePath: path, fnName: 'fileSize' });
    /** Answered from the meta store: the payload is never deserialized. */
    const store = await this.readStore(DB_DEFAULTS.META_STORE);
    const size = (await requestToPromise(store.get(key))) as number | undefined;
    if (size !== undefined) {
      return size;
    }
    await this.throwIfDirectory({ path: key, fnName: 'fileSize' });
    return null;
  }
}

export { IndexedDbStorageAdapter };
