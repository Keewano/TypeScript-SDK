/**
 * `StorageAdapter` shim that reroutes the core identifiers and
 * consent-state files through the web value-store ladder while every
 * other path passes through to the queue adapter: IndexedDB can be
 * denied or evicted wholesale, and the install identity plus a
 * recorded consent decision must degrade independently of the event
 * queue.
 *
 * Known limitation: on an http page the cookie rung cannot use the
 * `__Host-` name prefix, so a foreign `Domain`/`Path`-scoped copy of
 * the identity cookie may exist there and cannot be deleted from JS.
 * After a wipe, an in-memory session tombstone suppresses re-adoption
 * of any stored identity for the rest of the page's life.
 */

import type {
  ConsentState,
  DeleteFileArgs,
  FileSizeArgs,
  ListFilesArgs,
  ReadFileArgs,
  StorageAdapter,
  WriteFileArgs,
} from '@keewano/core';

import type { WebIdentityStorageAdapterArgs } from './types/identityStorageAdapter';
import type { WebValueStore } from './types/webValueStore';

import {
  CONSENT_FILENAME,
  IDS_FILE_SIZE,
  IDS_FILENAME,
  decodeConsentState,
  isAllZeroUuid,
  newUuid,
  uuidBytesToString,
  uuidToBytes,
} from '@keewano/core';

const UUID_SIZE = 16;

const RECORD_SEPARATOR = ':';

/** Ladder keys the rerouted files land on. */
const LADDER_KEYS = {
  /** Atomic identifiers record: `${installId}:${userId}`. */
  IDENTITY: 'keewano.identity',
  /** Pre-record split layout, read once for forward migration. */
  LEGACY_INSTALL_ID: 'keewano.installId',
  LEGACY_USER_ID: 'keewano.userId',
  /** Consent-state file bytes, hex-encoded. */
  CONSENT: 'keewano.consent',
} as const;

/**
 * Corruption maps to `null` instead of throwing so the read path can
 * repair the broken half without discarding the other.
 */
function parseStoredUuid(value: string | null): Uint8Array | null {
  if (value === null) return null;
  try {
    return uuidToBytes(value);
  } catch {
    return null;
  }
}

/**
 * The all-zero UUID also maps to `null`: core's read path treats it
 * as corruption and would regenerate the WHOLE record (losing the
 * userId half), so it counts as a broken half here.
 */
function parseStoredInstallId(value: string | null): Uint8Array | null {
  const bytes = parseStoredUuid(value);
  if (bytes === null || isAllZeroUuid(bytes)) {
    return null;
  }
  return bytes;
}

/**
 * Discriminates a concurrent tab's record (adopt) from a stale value
 * returned by a silent-drop storage engine (fail the rung).
 */
function isIdentityRecord(value: string): boolean {
  const separator = value.indexOf(RECORD_SEPARATOR);
  if (separator === -1) {
    return false;
  }
  return (
    parseStoredInstallId(value.substring(0, separator)) !== null &&
    parseStoredUuid(value.substring(separator + 1)) !== null
  );
}

/** `true` when a ladder read-back is a well-formed hex consent value. */
function isConsentHex(value: string): boolean {
  return value.length % 2 === 0 && /^[0-9a-f]*$/.test(value);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/** Malformed hex maps to "no file" so core falls back to its fresh-state default. */
function hexToBytes(value: string): Uint8Array | null {
  if (!isConsentHex(value)) {
    return null;
  }
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(value.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function composeIdsBytes(installId: Uint8Array, userId: Uint8Array): Uint8Array {
  const out = new Uint8Array(IDS_FILE_SIZE);
  out.set(installId, 0);
  out.set(userId, UUID_SIZE);
  return out;
}

/**
 * `deleteFile` on a rerouted path is a real ladder delete (every
 * rung), so a GDPR wipe removes the identity for good instead of
 * letting a lower rung resurrect it.
 */
class WebIdentityStorageAdapter implements StorageAdapter {
  private readonly store: WebValueStore;
  private readonly fallback: StorageAdapter;
  /** GDPR-wipe tombstone (see module header); cleared by the next identity write. */
  private idsWipedThisSession: boolean;

  constructor(args: WebIdentityStorageAdapterArgs) {
    this.store = args.store;
    this.fallback = args.fallback;
    this.idsWipedThisSession = false;
  }

  async writeFile(args: WriteFileArgs): Promise<void> {
    if (args.path === CONSENT_FILENAME) {
      this.store.set({
        key: LADDER_KEYS.CONSENT,
        value: bytesToHex(args.bytes),
        isValid: isConsentHex,
      });
      return;
    }
    if (args.path !== IDS_FILENAME) {
      return this.fallback.writeFile(args);
    }
    if (args.bytes.length !== IDS_FILE_SIZE) {
      throw new TypeError('writeFile: bad identifiers record');
    }
    const record = [
      uuidBytesToString(args.bytes.slice(0, UUID_SIZE)),
      uuidBytesToString(args.bytes.slice(UUID_SIZE, IDS_FILE_SIZE)),
    ].join(RECORD_SEPARATOR);
    /**
     * One key = one atomic rung write; two separate keys could tear
     * under a cross-tab race into a mixed installId / userId pair.
     * `set` adopts a racing tab's record when it landed between our
     * write and the read-back; `readFile` serves the same key.
     */
    this.store.set({ key: LADDER_KEYS.IDENTITY, value: record, isValid: isIdentityRecord });
    this.idsWipedThisSession = false;
  }

  /**
   * The recorded consent decision, read without awaiting anything.
   *
   * Every rung of the ladder answers synchronously, so the `Promise`
   * that {@link readFile} returns is a formality of the storage
   * contract rather than real asynchrony. The exit path needs the
   * answer inside the event task that is tearing the page down, where
   * no continuation is guaranteed to run, and this is what lets it
   * have one.
   *
   * @returns The decoded state, or `null` when no valid record exists.
   */
  readRecordedConsentSync(): ConsentState | null {
    const stored = this.store.get(LADDER_KEYS.CONSENT);
    return stored === null ? null : decodeConsentState(hexToBytes(stored));
  }

  async readFile(args: ReadFileArgs): Promise<Uint8Array | null> {
    if (args.path === CONSENT_FILENAME) {
      const stored = this.store.get(LADDER_KEYS.CONSENT);
      return stored === null ? null : hexToBytes(stored);
    }
    if (args.path !== IDS_FILENAME) {
      return this.fallback.readFile(args);
    }
    if (this.idsWipedThisSession) {
      return null;
    }
    const record = this.store.get(LADDER_KEYS.IDENTITY) ?? this.migrateLegacyRecord();
    if (record === null) {
      return null;
    }
    const separator = record.indexOf(RECORD_SEPARATOR);
    if (separator === -1) {
      return null;
    }
    /**
     * The halves parse independently: one corrupted half must not
     * discard the other. A broken installId is regenerated in place
     * (and persisted, or every read would mint a new identity); a
     * broken userId falls back to the zero "not set" sentinel while
     * the installId survives.
     */
    const installId = parseStoredInstallId(record.substring(0, separator));
    const userId = parseStoredUuid(record.substring(separator + 1));
    if (installId === null && userId === null) {
      return null;
    }
    if (installId === null) {
      const fallbackUserId = userId ?? new Uint8Array(UUID_SIZE);
      const freshInstallId = uuidToBytes(newUuid());
      /**
       * `set` can adopt a concurrent writer's record on read-back;
       * serve what actually persisted (mirroring `migrateLegacyRecord`)
       * so consecutive reads cannot flip identity, with the fresh
       * halves as the fallback for an unparseable return.
       */
      const stored = this.store.set({
        key: LADDER_KEYS.IDENTITY,
        value: [uuidBytesToString(freshInstallId), uuidBytesToString(fallbackUserId)].join(
          RECORD_SEPARATOR,
        ),
        isValid: isIdentityRecord,
      });
      const storedSeparator = stored.indexOf(RECORD_SEPARATOR);
      return composeIdsBytes(
        parseStoredInstallId(stored.substring(0, storedSeparator)) ?? freshInstallId,
        parseStoredUuid(stored.substring(storedSeparator + 1)) ?? fallbackUserId,
      );
    }
    return composeIdsBytes(installId, userId ?? new Uint8Array(UUID_SIZE));
  }

  async deleteFile(args: DeleteFileArgs): Promise<void> {
    if (args.path === CONSENT_FILENAME) {
      this.store.delete(LADDER_KEYS.CONSENT);
      return;
    }
    if (args.path !== IDS_FILENAME) {
      return this.fallback.deleteFile(args);
    }
    /**
     * Legacy keys included: leaving the pre-migration split keys
     * behind would let `migrateLegacyRecord` resurrect the deleted
     * identity on the next read - a GDPR-wipe violation.
     */
    this.store.delete(LADDER_KEYS.IDENTITY);
    this.store.delete(LADDER_KEYS.LEGACY_INSTALL_ID);
    this.store.delete(LADDER_KEYS.LEGACY_USER_ID);
    this.idsWipedThisSession = true;
  }

  async listFiles(args: ListFilesArgs): Promise<string[]> {
    /** The rerouted files live at the adapter root and core never lists them. */
    return this.fallback.listFiles(args);
  }

  async fileSize(args: FileSizeArgs): Promise<number | null> {
    if (args.path === CONSENT_FILENAME || args.path === IDS_FILENAME) {
      const bytes = await this.readFile(args);
      return bytes === null ? null : bytes.length;
    }
    return this.fallback.fileSize(args);
  }

  /**
   * The `set` return adopts a concurrent migrator's write. The legacy
   * keys stay in place: an older bundle cached in another tab keeps
   * reading them; they simply go stale.
   */
  private migrateLegacyRecord(): string | null {
    const legacyInstall = parseStoredInstallId(this.store.get(LADDER_KEYS.LEGACY_INSTALL_ID));
    const legacyUser = parseStoredUuid(this.store.get(LADDER_KEYS.LEGACY_USER_ID));
    if (legacyInstall === null && legacyUser === null) {
      return null;
    }
    const installId = legacyInstall ?? uuidToBytes(newUuid());
    const userId = legacyUser ?? new Uint8Array(UUID_SIZE);
    return this.store.set({
      key: LADDER_KEYS.IDENTITY,
      value: [uuidBytesToString(installId), uuidBytesToString(userId)].join(RECORD_SEPARATOR),
      isValid: isIdentityRecord,
    });
  }
}

export { LADDER_KEYS, WebIdentityStorageAdapter };
