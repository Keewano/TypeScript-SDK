/**
 * Feature-probe and adapter selection for the durable event queue.
 * Private-mode and locked-down browsers can deny IndexedDB entirely,
 * reject `open()`, fail on the first write (quota), or never settle
 * the open (an older tab blocking a version change); the SDK must
 * degrade to in-memory storage, not crash or hang. The probe is a
 * real write-delete round-trip, not a presence check: only a
 * completed readwrite transaction proves the environment persists.
 */

import type { SelectWebStorageAdapterArgs } from './types/selectWebStorageAdapter';

import { type StorageAdapter, MemoryStorageAdapter } from '@keewano/core';

import { IndexedDbStorageAdapter } from './indexedDbStorageAdapter';
import { probeGlobal } from '../probeGlobal';

const PROBE = {
  PATH: 'probe/keewano.probe',
  /**
   * Hard deadline: IndexedDB opens can hang forever (blocked version
   * change, wedged profile); a bounded probe keeps `init` from
   * stalling the host page.
   */
  TIMEOUT_MS: 2000,
} as const;

/**
 * Classify the probe failure so the warning names the likely cause:
 * `NotFoundError` / `VersionError` mean another party owns a database
 * with our name at an incompatible shape; everything else is the
 * generic denied/quota story.
 */
function probeFailureWarning(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotFoundError' || name === 'VersionError') {
    return 'selectWebStorageAdapter: conflicting IndexedDB database; events will not survive this page.';
  }
  return 'selectWebStorageAdapter: IndexedDB unusable; events will not survive this page.';
}

/**
 * Write-delete round trip. The delete is best-effort cleanup in a
 * `finally`: a stale probe file must neither fail an otherwise
 * healthy probe nor be leaked by a failing one.
 */
async function runProbe(adapter: IndexedDbStorageAdapter): Promise<void> {
  try {
    await adapter.writeFile({ path: PROBE.PATH, bytes: new Uint8Array([1]) });
  } finally {
    try {
      await adapter.deleteFile({ path: PROBE.PATH });
    } catch {
      /** Best-effort cleanup; the write outcome decides the probe. */
    }
  }
}

/**
 * Pick the durable adapter when IndexedDB survives the write probe
 * within the deadline, else fall back to `MemoryStorageAdapter`.
 * Degradation is logged once per selection and never thrown.
 */
async function selectWebStorageAdapter(
  args: SelectWebStorageAdapterArgs = {},
): Promise<StorageAdapter> {
  /**
   * Probed, not read: where storage is blocked for the context - a
   * sandboxed or cross-site frame, a browser configured to refuse
   * third-party storage - the property getter THROWS a SecurityError
   * rather than returning undefined. A raw read would escape this
   * function past every guard below and reject `init` outright, which
   * is the one outcome this module exists to prevent.
   */
  const factory =
    args.indexedDB === undefined
      ? probeGlobal<IDBFactory>({ path: ['indexedDB'], methods: ['open'] })
      : args.indexedDB;

  if (factory === undefined || factory === null) {
    console.warn('selectWebStorageAdapter: IndexedDB missing; events will not survive this page.');
    return new MemoryStorageAdapter();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const adapter = new IndexedDbStorageAdapter({
    indexedDB: factory,
    ...(args.dbName === undefined ? {} : { dbName: args.dbName }),
  });
  try {
    const probe = runProbe(adapter);
    /** A probe that loses the race and rejects later must not surface as unhandled. */
    probe.catch(() => undefined);
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout');
      }, PROBE.TIMEOUT_MS);
    });

    const outcome = await Promise.race([probe.then((): 'ok' => 'ok'), deadline]);
    if (outcome === 'timeout') {
      /**
       * Whenever the abandoned probe finally settles, close the
       * adapter it ran on: a late-resolving open() would otherwise
       * keep a connection (and a potential versionchange lock) alive
       * for a page that already fell back to memory.
       */
      const closeStraggler = (): void => {
        adapter.close().catch(() => undefined);
      };
      probe.then(closeStraggler, closeStraggler);
      console.warn(
        'selectWebStorageAdapter: IndexedDB probe timeout; events will not survive this page.',
      );
      return new MemoryStorageAdapter();
    }
    return adapter;
  } catch (error) {
    /**
     * A failed probe still leaves whatever the open() succeeded at: a
     * quota denial fails the WRITE, not the connection, which would
     * then outlive the fallback holding a versionchange lock.
     */
    adapter.close().catch(() => undefined);
    console.warn(probeFailureWarning(error));
    return new MemoryStorageAdapter();
  } finally {
    clearTimeout(timer);
  }
}

export { selectWebStorageAdapter };
