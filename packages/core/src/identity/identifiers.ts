/**
 * Identity persistence: load, generate, and save the 32-byte
 * `installId` + `userId` record on the `StorageAdapter`-backed disk.
 *
 * On first launch (or after a corrupted file is detected) a fresh
 * v4 `installId` is generated and persisted before returning; the
 * `userId` stays zero until the host calls `setUserId` via the
 * public API.
 *
 * The load path treats an all-zero `installId` as a corruption
 * signal and regenerates. Trusting an all-zero buffer as-is would
 * silently bleed a single "ghost user" identity across every
 * install whose file got wiped, which destroys per-install
 * analytics integrity.
 */

import type { StorageAdapter } from '../storage';

import type {
  LoadOrInitIdentifiersArgs,
  PersistIdentifiersArgs,
  UserIdentifiers,
} from './types/identifiers';

import { assertUint8Array } from '../encoding/assertions';
import { guidToBytes, newGuid } from '../encoding/guid';

import { IDS_FILE_SIZE, IDS_FILENAME } from './helpers/constants';

/** Byte length of a single mixed-endian GUID buffer. */
const GUID_SIZE = 16;

/**
 * `true` when every byte in `bytes` is zero. Applied only to
 * `installId` (the corruption signal) and never to `userId` (where
 * all-zero is a legitimate "not set" sentinel).
 */
function isAllZeroGuid(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0);
}

/**
 * Build a fresh `UserIdentifiers` with a new v4 InstallId and an
 * all-zero UserId.
 *
 * Zero is the documented "no developer-supplied user identity yet"
 * marker on this wire protocol - the server treats `K-Uid =
 * 00000000-0000-0000-0000-000000000000` as a legitimate
 * "anonymous host" signal and uses it for some attribution paths.
 * The host promotes the UserId by calling `setUserId` once it has
 * a real one to assign.
 */
function createFreshIdentifiers(): UserIdentifiers {
  return {
    installId: guidToBytes(newGuid()),
    userId: new Uint8Array(GUID_SIZE),
  };
}

/**
 * Per-storage chain of in-flight identifier file operations. Both
 * `loadOrInitIdentifiers` and `persistIdentifiers` queue through
 * the same chain so a first-launch initialization cannot overwrite
 * an in-flight `persistIdentifiers` write (and two concurrent
 * loads cannot race each other into two different installIds).
 * The `WeakMap` lets the entry GC alongside the storage adapter.
 */
const identifierOps = new WeakMap<StorageAdapter, Promise<unknown>>();

/**
 * Args bag for `enqueueIdentifierOp`.
 *
 * storage - Storage adapter that owns the identifiers file.
 *   Identifies the queue.
 * op - The operation to run once the predecessor settles.
 */
interface EnqueueIdentifierOpArgs<T> {
  storage: StorageAdapter;
  op: () => Promise<T>;
}

/**
 * Append `op` to the per-storage identifier queue and return its
 * eventual result. The chain `previous.catch(() => undefined).then(op)`
 * guarantees `op` runs after any in-flight predecessor regardless of
 * whether the predecessor resolved or threw. The trailing `finally`
 * trims the WeakMap entry when this op is the most recent one.
 */
function enqueueIdentifierOp<T>(args: EnqueueIdentifierOpArgs<T>): Promise<T> {
  const { storage, op } = args;
  const previous = identifierOps.get(storage) ?? Promise.resolve();
  const nextPromise = previous.catch(() => undefined).then(() => op());
  identifierOps.set(storage, nextPromise);
  return nextPromise.finally(() => {
    if (identifierOps.get(storage) === nextPromise) {
      identifierOps.delete(storage);
    }
  });
}

/**
 * Args bag for the private `writeIdentifiersFile` helper.
 *
 * storage - Storage adapter that backs the identifiers file.
 * identifiers - Already-validated identity to serialize.
 */
interface WriteIdentifiersFileArgs {
  storage: StorageAdapter;
  identifiers: UserIdentifiers;
}

/**
 * Pack the 32-byte identity record and write it via the storage
 * adapter's atomic-write contract. Validation lives in
 * `persistIdentifiers` (so TypeError / RangeError surface before
 * the write enters the queue).
 */
async function writeIdentifiersFile(args: WriteIdentifiersFileArgs): Promise<void> {
  const { storage, identifiers } = args;
  const out = new Uint8Array(IDS_FILE_SIZE);
  out.set(identifiers.installId, 0);
  out.set(identifiers.userId, GUID_SIZE);
  await storage.writeFile({ path: IDS_FILENAME, bytes: out });
}

/**
 * Load the identity record from disk, or initialize a fresh one
 * when the file is missing, not exactly `IDS_FILE_SIZE` bytes long,
 * or carries an all-zero `installId`. The fresh record is persisted
 * before returning so the next launch reads back the same identity
 * instead of generating yet another one.
 *
 * The size check is exact (not `>=`) because the on-disk record is
 * a fixed-width 32-byte struct. A file longer than that is either
 * upstream corruption (appended garbage) or a forward-incompatible
 * format; reading the first 32 bytes in those cases would pin the
 * SDK to a wrong identity. Fail closed and regenerate instead.
 *
 * `userId` is read back verbatim, including the all-zero buffer
 * which is the documented "no developer-supplied user identity"
 * marker. Only `installId` is treated as corruption-prone here.
 *
 * Queued through the shared identifier chain: concurrent first-
 * launch loads cannot produce different `installId` values, and a
 * load racing with `persistIdentifiers` cannot overwrite an
 * already-persisted record.
 */
async function loadOrInitIdentifiers(args: LoadOrInitIdentifiersArgs): Promise<UserIdentifiers> {
  const { storage } = args;
  return enqueueIdentifierOp({
    storage,
    op: async () => {
      const bytes = await storage.readFile({ path: IDS_FILENAME });
      if (bytes !== null && bytes.length === IDS_FILE_SIZE) {
        const installId = bytes.slice(0, GUID_SIZE);
        const userId = bytes.slice(GUID_SIZE, IDS_FILE_SIZE);
        if (!isAllZeroGuid(installId)) {
          return { installId, userId };
        }
      }
      const fresh = createFreshIdentifiers();
      await writeIdentifiersFile({ storage, identifiers: fresh });
      return fresh;
    },
  });
}

/**
 * Atomically write the 32-byte identity record. Validates that both
 * buffers are 16 bytes and that `installId` is non-zero, so the
 * file on disk never carries the all-zero `installId` marker that
 * the read path treats as corruption (writing a self-invalidating
 * record would silently churn identities across launches).
 *
 * `userId` is allowed to be all-zero - that is the documented
 * "no developer-supplied user identity yet" marker and the server
 * relies on it for some attribution paths.
 *
 * Validation runs synchronously BEFORE the write enters the
 * shared identifier queue so a malformed identity surfaces as a
 * `TypeError` immediately instead of being delayed behind unrelated
 * in-flight operations.
 *
 * @throws TypeError when either `installId` or `userId` is not a
 *   16-byte `Uint8Array`, or when `installId` is the all-zero
 *   buffer.
 */
async function persistIdentifiers(args: PersistIdentifiersArgs): Promise<void> {
  const { storage, identifiers } = args;
  assertUint8Array({
    expectedLength: GUID_SIZE,
    fnName: 'persistIdentifiers: identifiers.installId',
    value: identifiers.installId,
  });
  assertUint8Array({
    expectedLength: GUID_SIZE,
    fnName: 'persistIdentifiers: identifiers.userId',
    value: identifiers.userId,
  });
  if (isAllZeroGuid(identifiers.installId)) {
    throw new TypeError('persistIdentifiers: zero installId');
  }
  /*
   * Snapshot the validated buffers before scheduling the async
   * write. The caller owns the source `Uint8Array`s and is free to
   * mutate them between this call returning and the queued write
   * actually running; without a defensive copy, a `.set()` on a
   * shared buffer would persist bytes different from the ones we
   * just validated.
   */
  const snapshot: UserIdentifiers = {
    installId: identifiers.installId.slice(),
    userId: identifiers.userId.slice(),
  };
  await enqueueIdentifierOp({
    storage,
    op: () => writeIdentifiersFile({ storage, identifiers: snapshot }),
  });
}

export { loadOrInitIdentifiers, persistIdentifiers };
