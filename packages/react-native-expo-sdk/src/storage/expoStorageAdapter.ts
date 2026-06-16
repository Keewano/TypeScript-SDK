/**
 * Expo `StorageAdapter` backed entirely by `expo-file-system`. Every
 * value the SDK persists is a file under an SDK-owned subdirectory of
 * the app's document directory by default; callers may override the
 * root via the `rootDir` arg.
 *
 * Writes route through a per-operation scratch sibling that is moved
 * over the destination on success via `moveAsync`. The fresh-write
 * case is atomic; the overwrite case is best-effort because
 * `expo-file-system.moveAsync` refuses to overwrite an existing
 * target, so the adapter calls `deleteAsync({ idempotent: true })`
 * first and a reader may briefly observe `null` for the destination
 * during that window.
 *
 * @example
 * ```ts
 * import { ExpoStorageAdapter } from '@keewano/react-native-expo-sdk';
 *
 * const storage = new ExpoStorageAdapter();
 * await storage.writeFile({ path: 'batches/1.kwub', bytes });
 * ```
 */

import type {
  ExpoFileInfo,
  ExpoFileSystemLike,
  ExpoStorageAdapterArgs,
} from './types/expoStorageAdapter';

import {
  type DeleteFileArgs,
  type FileSizeArgs,
  type ListFilesArgs,
  type ReadFileArgs,
  type StorageAdapter,
  type WriteFileArgs,
  MutationCoordinator,
  SCRATCH_BAK_INFIX,
  SCRATCH_DEL_INFIX,
  SCRATCH_TMP_INFIX,
  base64ToBytes,
  bytesToBase64,
  generateOpId,
  globToRegex,
  isScratchSibling,
  validPath,
} from '@keewano/core';

import { loadFileSystem } from './helpers/loadNativeModules';
import { computeRootDir, ensureParentDir, resolveUnderRoot } from './helpers/pathHelpers';

const BASE64_OPTIONS = { encoding: 'base64' } as const;
const IDEMPOTENT_DELETE = { idempotent: true } as const;

class ExpoStorageAdapter implements StorageAdapter {
  /**
   * Per-`rootDir` coordinator registry. Two adapter instances pointed
   * at the same sandbox root share the same serialization queue so
   * path-level mutation safety follows the on-disk location, not the
   * wrapper instance.
   *
   * KNOWN LIMITATION: keys are EXACT URIs, so two concurrent
   * mutations on ancestor/descendant pairs (e.g. write `a/b` while
   * delete `a` is in flight) do not serialize. The dir-vs-file guards
   * + `ensureParentDir` defense usually catch the resulting state
   * mismatch, but a true fix is prefix-aware locking inside
   * `MutationCoordinator`. Coarsening this to `rootDir` would
   * serialize ALL writes which is too expensive for the dispatcher's
   * batch flush path; defer to a dedicated MutationCoordinator
   * upgrade rather than the broad stopgap.
   */
  private static readonly sharedMutations = new Map<string, MutationCoordinator>();

  private readonly rootDir: string;
  private readonly fileSystem: ExpoFileSystemLike;
  private readonly mutations: MutationCoordinator;

  /**
   * Construct an adapter bound to the host's Expo runtime modules.
   * The native bindings are loaded lazily so a host that imports the
   * adapter without instantiating it pays no startup cost.
   *
   * @param args - Optional sandbox root override and DI hooks for
   *   `expo-file-system`. Pass a mock in tests.
   * @throws Error when `args.rootDir` is omitted and the runtime does
   *   not expose `documentDirectory`.
   */
  constructor(args: ExpoStorageAdapterArgs = {}) {
    /* istanbul ignore next - native loader fallback only fires outside test runtime */
    const fileSystem = args.fileSystem ?? loadFileSystem();

    this.rootDir = computeRootDir({
      explicit: args.rootDir,
      documentDirectory: fileSystem.documentDirectory,
    });
    this.fileSystem = fileSystem;

    const shared =
      ExpoStorageAdapter.sharedMutations.get(this.rootDir) ?? new MutationCoordinator();
    ExpoStorageAdapter.sharedMutations.set(this.rootDir, shared);
    this.mutations = shared;
  }

  /**
   * Bytes are base64-encoded (Expo's `writeAsStringAsync` is
   * string-only) and routed through a per-operation scratch sibling
   * moved into place via `moveAsync`. See the class-level JSDoc for
   * the overwrite atomicity caveat.
   *
   * Scratch sibling names embed a per-operation id (`__kwtmp__.<id>`
   * and `__kwbak__.<id>`) so a real user file living at
   * `${fullUri}.tmp` or `${fullUri}.bak` cannot collide with our
   * scratch state: serialization protects only the destination URI,
   * not arbitrary suffixes a caller might already be using.
   *
   * @param args - Adapter-relative path and binary contents.
   */
  async writeFile({ path, bytes }: WriteFileArgs): Promise<void> {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('writeFile: not a Uint8Array');
    }
    validPath({ path, fnName: 'writeFile' });
    const fullUri = resolveUnderRoot({ rootDir: this.rootDir, relativePath: path });
    /**
     * `opId` is a uniqueness suffix, NOT a security token. The
     * mutation queue prevents two live writes sharing the same
     * destination; the shared helper prefers `crypto.getRandomValues`
     * so SAST tools stop flagging `Math.random`.
     */
    const opId = generateOpId();
    const tmpUri = `${fullUri}.${SCRATCH_TMP_INFIX}.${opId}`;
    const backupUri = `${fullUri}.${SCRATCH_BAK_INFIX}.${opId}`;

    /**
     * Serialize concurrent writes to the same logical path so two
     * overlapping calls cannot stomp each other mid-flight.
     */
    await this.mutations.run({
      key: fullUri,
      op: () => this.doWriteFile(tmpUri, fullUri, backupUri, bytes),
    });
  }

  /**
   * Full write pipeline: prepare parent, stage to `.tmp`, swap the
   * existing destination aside to `.bak`, commit the tmp into place
   * (restoring from backup if the final move fails), and clean up.
   */
  private async doWriteFile(
    tmpUri: string,
    fullUri: string,
    backupUri: string,
    bytes: Uint8Array,
  ): Promise<void> {
    await ensureParentDir({ fileSystem: this.fileSystem, fullUri });

    try {
      await this.fileSystem.writeAsStringAsync(tmpUri, bytesToBase64(bytes), BASE64_OPTIONS);
      const hasBackup = await this.moveExistingToBackup(fullUri, backupUri);
      await this.commitTmpOrRestore(tmpUri, fullUri, backupUri, hasBackup);
    } catch (error) {
      await this.bestEffortDelete(tmpUri);
      throw error;
    }
  }

  /**
   * Rename the existing destination file (if any) aside to `backupUri`
   * so a failed move of the tmp file can be undone. Returns `true`
   * when a backup was made. Throws when the destination resolves to a
   * directory (fail-closed against unknown / non-`false` `isDirectory`).
   */
  private async moveExistingToBackup(fullUri: string, backupUri: string): Promise<boolean> {
    /**
     * Race-recover getInfoAsync failures via the shared helper: a
     * concurrent removal surfacing as a throw resolves silently. The
     * contract-violation throw on `isDirectory` lives outside the
     * catch and escapes either way.
     */
    let info: ExpoFileInfo;
    try {
      info = await this.fileSystem.getInfoAsync(fullUri);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullUri, error);
      return false;
    }
    if (!info.exists) {
      return false;
    }
    if (info.isDirectory !== false) {
      throw new Error('writeFile: destination path is a directory');
    }
    /**
     * Re-check before the rename to narrow the TOCTOU window against
     * a file-to-directory swap.
     */
    let latest: ExpoFileInfo;
    try {
      latest = await this.fileSystem.getInfoAsync(fullUri);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullUri, error);
      return false;
    }
    if (!latest.exists) {
      return false;
    }
    if (latest.isDirectory !== false) {
      throw new Error('writeFile: destination path is a directory');
    }
    /**
     * Clear any stale backup left by a crashed prior run, then move
     * the current contents aside.
     */
    await this.bestEffortDelete(backupUri);
    /**
     * Race-recover moveAsync failures via the three-state probe so a
     * probe that itself throws is not silently conflated with "backup
     * absent" - which would drop `hasBackup` to false and let a later
     * failing commit orphan the original bytes sitting at `backupUri`.
     */
    try {
      await this.fileSystem.moveAsync({ from: fullUri, to: backupUri });
    } catch (error) {
      const outcome = await this.classifyPostRenameThrow(fullUri, backupUri, error);
      if (outcome === 'sourceGone') {
        return false;
      }
    }
    await this.verifyBackupOrRestore(fullUri, backupUri);
    return true;
  }

  /**
   * Confirm the entry that landed at `backupUri` after the rename is
   * still an explicit file. If the stat fails OR reports a directory
   * (file-to-directory swap after the last guard), best-effort restore
   * the backup to `fullUri` so a failed overwrite is never destructive,
   * then surface the original failure / contract violation.
   * Counterpart of the BareRN `verifyBackupOrRestore` helper.
   */
  private async verifyBackupOrRestore(fullUri: string, backupUri: string): Promise<void> {
    let moved: ExpoFileInfo;
    try {
      moved = await this.fileSystem.getInfoAsync(backupUri);
    } catch (verifyError) {
      try {
        await this.fileSystem.moveAsync({ from: backupUri, to: fullUri });
      } catch {
        /* Preserve the original verification failure even if restore fails. */
      }
      throw verifyError;
    }
    /**
     * Treat a vanished backup as a hard failure with its own error so
     * the destination is not silently dropped: surface "backup vanished"
     * rather than folding it into the directory branch.
     */
    if (!moved.exists) {
      try {
        await this.fileSystem.moveAsync({ from: backupUri, to: fullUri });
      } catch {
        /* Preserve the verification failure below even if restore fails. */
      }
      throw new Error('writeFile: backup vanished during overwrite');
    }
    if (moved.isDirectory !== false) {
      try {
        await this.fileSystem.moveAsync({ from: backupUri, to: fullUri });
      } catch {
        /* Preserve the contract violation below even if restore fails. */
      }
      throw new Error('writeFile: destination path is a directory');
    }
  }

  /**
   * Move the tmp file into the final destination. On failure, restore
   * the backup so the overwrite is non-destructive. On success, clear
   * the backup best-effort.
   */
  private async commitTmpOrRestore(
    tmpUri: string,
    fullUri: string,
    backupUri: string,
    hasBackup: boolean,
  ): Promise<void> {
    try {
      await this.fileSystem.moveAsync({ from: tmpUri, to: fullUri });
    } catch (moveError) {
      /**
       * Native rename may complete on the OS layer and only THEN
       * reject. Classify across THREE outcomes:
       * - LANDED (`tmp` absent + `full` present): rename committed.
       *   Clean up the backup and treat as success.
       * - FAILED (`tmp` present, OR both absent): rename did not
       *   happen. Restore the backup if any.
       * - AMBIGUOUS (any probe `unknown`): we cannot tell. The backup
       *   may be the only copy of the old data, so DO NOT restore
       *   (could overwrite a successful commit) and DO NOT clean it
       *   up (caller may need to recover). Rethrow the move error.
       */
      const tmpState = await this.probePresence(tmpUri);
      const fullState = await this.probePresence(fullUri);
      if (tmpState === 'absent' && fullState === 'present') {
        if (hasBackup) {
          await this.bestEffortDelete(backupUri);
        }
        return;
      }
      if (tmpState === 'unknown' || fullState === 'unknown') {
        throw moveError;
      }
      if (hasBackup) {
        try {
          await this.fileSystem.moveAsync({ from: backupUri, to: fullUri });
        } catch {
          /* Preserve the original move failure even if restore fails. */
        }
      }
      throw moveError;
    }
    if (hasBackup) {
      await this.bestEffortDelete(backupUri);
    }
  }

  /**
   * Idempotent best-effort delete used for tmp / backup cleanup so a
   * cleanup error never masks the original write failure. The targets
   * are always our own per-operation scratch siblings (suffix
   * `.__kwtmp__.<opId>` / `.__kwbak__.<opId>`), so a directory cannot
   * realistically land there - no defensive isDirectory check is
   * needed. The `{ idempotent: true }` option handles the missing-
   * path case.
   */
  private async bestEffortDelete(uri: string): Promise<void> {
    try {
      await this.fileSystem.deleteAsync(uri, IDEMPOTENT_DELETE);
    } catch {
      /* Preserve any concurrent error. */
    }
  }

  /**
   * The read is attempted first, then `getInfoAsync` confirms whether
   * a thrown error means "absent" or a genuine I/O failure. Avoids the
   * check-then-read race window opened by the `deleteAsync` + `moveAsync`
   * pair in `writeFile`.
   *
   * The recovery wrap is scoped to `readAsStringAsync` only: a
   * `base64ToBytes` decode failure on legitimately-read bytes must
   * surface as itself, never as `null`, even if the path happens to
   * vanish between the successful read and a later stat.
   *
   * @param args - Adapter-relative path.
   * @returns File contents, or `null` when the path does not exist.
   */
  async readFile({ path }: ReadFileArgs): Promise<Uint8Array | null> {
    validPath({ path, fnName: 'readFile' });
    const fullUri = resolveUnderRoot({ rootDir: this.rootDir, relativePath: path });

    let b64: string;
    try {
      b64 = await this.fileSystem.readAsStringAsync(fullUri, BASE64_OPTIONS);
    } catch (error) {
      /**
       * Preserve the original read error if the follow-up
       * `getInfoAsync` also fails; only translate the recovery
       * shape (missing -> null, directory -> explicit error).
       */
      let info: ExpoFileInfo;
      try {
        info = await this.fileSystem.getInfoAsync(fullUri);
      } catch {
        throw error;
      }
      if (!info.exists) {
        return null;
      }
      /**
       * Fail closed: any entry whose type is not an explicit
       * `isDirectory: false` is treated as a non-file so a directory
       * with incomplete metadata cannot leak as file bytes.
       */
      if (info.isDirectory !== false) {
        throw new Error('readFile: path is a directory');
      }
      throw error;
    }
    return base64ToBytes(b64);
  }

  /**
   * Routed through `deleteAsync({ idempotent: true })` so a missing
   * path resolves successfully instead of throwing. A `getInfoAsync`
   * guard rejects directory targets up-front because `deleteAsync`
   * removes directories recursively, which would violate the
   * file-only contract and risk wiping an entire subtree from a
   * mistaken caller.
   *
   * Each filesystem call is wrapped in its own narrow race-recovery
   * try/catch so a concurrent removal mid-flight resolves silently per
   * the idempotent contract. Contract-violation throws (the explicit
   * `deleteFile: path is a directory` errors) live OUTSIDE these
   * try/catch blocks so a directory target never gets swallowed as a
   * silent success - even if the directory disappears between the
   * stat that classified it and the recovery recheck below.
   *
   * @param args - Adapter-relative path.
   * @throws Error when the path exists and resolves to a directory.
   */
  async deleteFile({ path }: DeleteFileArgs): Promise<void> {
    validPath({ path, fnName: 'deleteFile' });
    const fullUri = resolveUnderRoot({ rootDir: this.rootDir, relativePath: path });

    /**
     * Chain off the same per-path serialization queue `writeFile`
     * uses so an in-flight write cannot make this delete observe the
     * destination as temporarily missing during the backup/tmp swap
     * and return a false silent success.
     */
    await this.mutations.run({
      key: fullUri,
      op: () => this.doDeleteFile(fullUri),
    });
  }

  /** Inner delete pipeline run by `deleteFile` under the mutation chain. */
  private async doDeleteFile(fullUri: string): Promise<void> {
    let info: ExpoFileInfo;
    try {
      info = await this.fileSystem.getInfoAsync(fullUri);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullUri, error);
      return;
    }
    if (!info.exists) {
      return;
    }
    /**
     * Fail closed: treat anything other than an explicit
     * `isDirectory: false` as a non-file and refuse to recurse-delete.
     * Escapes immediately - contract violations are not wrapped in a
     * race-recovery catch.
     */
    if (info.isDirectory !== false) {
      throw new Error('deleteFile: path is a directory');
    }

    /**
     * Re-check before `deleteAsync` to narrow the TOCTOU window
     * against a file-to-directory swap.
     */
    let latest: ExpoFileInfo;
    try {
      latest = await this.fileSystem.getInfoAsync(fullUri);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullUri, error);
      return;
    }
    if (!latest.exists) {
      return;
    }
    if (latest.isDirectory !== false) {
      throw new Error('deleteFile: path is a directory');
    }

    /**
     * Final TOCTOU guard: route through a per-operation trash sibling
     * so a file-to-directory swap cannot trick `deleteAsync` into
     * recurse-wiping a subtree. See `deleteViaTrash` for the verify +
     * restore flow.
     */
    await this.deleteViaTrash(fullUri);
  }

  /**
   * Move `fullUri` to a per-operation trash sibling, verify the moved
   * entry is still an explicit file, and only then delete the trash.
   * If anything later fails (verify stat throw, contract-violation
   * throw, or deleteAsync throw) AFTER the move-to-trash succeeded,
   * the helper best-effort restores the file to its original URI
   * before rethrowing so a failed delete is never silently
   * destructive. Counterpart of the BareRN `unlinkViaTrash` helper.
   */
  /**
   * Three-state existence probe: `present` / `absent` / `unknown`.
   * `unknown` is returned when the native `getInfoAsync` call itself
   * throws (transient I/O, permission flap, bridge serialization).
   * Post-mutation recovery branches MUST distinguish `absent` from
   * `unknown` so a thrown probe is not silently conflated with a
   * confirmed-missing entry: if a rename actually landed and the
   * follow-up probe throws, treating it as `absent` leaves data
   * orphaned at the scratch URI.
   */
  private async probePresence(uri: string): Promise<'present' | 'absent' | 'unknown'> {
    try {
      const info = await this.fileSystem.getInfoAsync(uri);
      return info.exists ? 'present' : 'absent';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Classify a post-rename throw using the three-state probe pattern.
   * Returns:
   *   - `'landed'`: probe confirms destination is present - rename
   *     actually succeeded despite the throw; caller continues as if
   *     the rename returned cleanly.
   *   - `'sourceGone'`: destination is confirmed missing AND source is
   *     confirmed missing - caller treats as benign concurrent removal
   *     (silent no-op).
   * Throws `originalError` when source is still present (standard
   * rethrow path) OR when destination probe was ambiguous and source
   * is confirmed gone (orphan risk - fail loudly).
   */
  private async classifyPostRenameThrow(
    source: string,
    destination: string,
    originalError: unknown,
  ): Promise<'landed' | 'sourceGone'> {
    const destState = await this.probePresence(destination);
    if (destState === 'present') {
      return 'landed';
    }
    if (destState === 'unknown' && (await this.probePresence(source)) === 'absent') {
      throw originalError;
    }
    await this.recoverMissingOrRethrow(source, originalError);
    return 'sourceGone';
  }

  /**
   * `deleteAsync` may complete on the OS layer and only THEN reject.
   * If BOTH the trash entry AND the source URI are confirmed gone,
   * the delete intent is satisfied even though the call threw.
   */
  private async deleteLanded(trashUri: string, fullUri: string): Promise<boolean> {
    return (
      (await this.probePresence(trashUri)) === 'absent' &&
      (await this.probePresence(fullUri)) === 'absent'
    );
  }

  private async deleteViaTrash(fullUri: string): Promise<void> {
    const trashUri = `${fullUri}.${SCRATCH_DEL_INFIX}.${generateOpId()}`;
    let movedToTrash = false;
    let deleteCompleted = false;
    /**
     * Native rename may complete on the OS layer and only THEN reject.
     * If the trash sibling is actually in place after a throw, treat as
     * movedToTrash so the outer catch restore branch runs on later
     * failures. Otherwise let `recoverMissingOrRethrow` decide silent-
     * vs-rethrow.
     */
    try {
      await this.fileSystem.moveAsync({ from: fullUri, to: trashUri });
      movedToTrash = true;
    } catch (moveError) {
      const outcome = await this.classifyPostRenameThrow(fullUri, trashUri, moveError);
      if (outcome === 'sourceGone') {
        return;
      }
      movedToTrash = true;
    }
    try {
      const moved = await this.fileSystem.getInfoAsync(trashUri);
      /**
       * Concurrent cleanup removed the trash entry between our move and
       * this re-stat. Treat as a successful delete; only throw the
       * directory error when the entry still exists and is not an
       * explicit file.
       */
      if (!moved.exists) {
        return;
      }
      if (moved.isDirectory !== false) {
        throw new Error('deleteFile: path is a directory');
      }

      await this.fileSystem.deleteAsync(trashUri, IDEMPOTENT_DELETE);
      deleteCompleted = true;
    } catch (error) {
      if (movedToTrash && !deleteCompleted) {
        /**
         * `deleteAsync` may complete on the OS layer and only THEN
         * reject. If BOTH the trash entry AND the source URI are
         * confirmed gone, the delete intent is satisfied even though
         * the call threw. Treat as silent success per the idempotent
         * contract.
         */
        if (await this.deleteLanded(trashUri, fullUri)) {
          return;
        }
        try {
          await this.fileSystem.moveAsync({ from: trashUri, to: fullUri });
        } catch {
          /* Preserve the original failure even if restore fails. */
        }
        throw error;
      }
      await this.recoverMissingOrRethrow(fullUri, error);
    }
  }

  /**
   * After a filesystem call throws, re-check existence so a confirmed
   * missing path resolves silently per the idempotent contract. Throws
   * `originalError` when the path still exists or when the recovery
   * `getInfoAsync` itself throws. Returning normally signals "missing",
   * leaving the caller to issue its own `return` / `return null`.
   */
  private async recoverMissingOrRethrow(fullUri: string, originalError: unknown): Promise<void> {
    let recheck: ExpoFileInfo;
    try {
      recheck = await this.fileSystem.getInfoAsync(fullUri);
    } catch {
      throw originalError;
    }
    if (recheck.exists) {
      throw originalError;
    }
  }

  /**
   * `getInfoAsync` reports `exists: true` for both files and
   * directories, so a non-directory entry has to be treated the same
   * as a missing directory - calling `readDirectoryAsync` on a file
   * would throw.
   *
   * @param args - Adapter-relative directory and optional glob filter.
   * @returns Basenames of matching entries, or an empty array when
   *   the directory does not exist, is not a directory, or no entries
   *   match.
   */
  async listFiles({ dir, pattern }: ListFilesArgs): Promise<string[]> {
    validPath({ path: dir, fnName: 'listFiles' });
    const fullUri = resolveUnderRoot({ rootDir: this.rootDir, relativePath: dir });
    /**
     * Route the initial probe through `recoverMissingOrRethrow` so a
     * concurrent removal surfacing as a getInfoAsync throw resolves
     * to `[]` per the missing-directory contract.
     */
    let info: ExpoFileInfo;
    try {
      info = await this.fileSystem.getInfoAsync(fullUri);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullUri, error);
      return [];
    }
    if (!info.exists) {
      return [];
    }
    /**
     * Throw on a file path so `listFiles` matches `MemoryStorageAdapter`
     * and `BareRNStorageAdapter` - a file cannot be silently treated
     * as an empty directory.
     */
    if (info.isDirectory !== true) {
      throw new Error('listFiles: path is not a directory');
    }

    /**
     * `readDirectoryAsync` returns mixed file and directory basenames,
     * but `listFiles` is file-only. A per-entry `getInfoAsync` is
     * unavoidable on Expo since the API does not expose entry type.
     * The outer try-catch handles directory-vanished races; the
     * per-entry try-catch tolerates concurrent removal of children
     * mid-listing.
     */
    let rawNames: string[];
    try {
      rawNames = await this.fileSystem.readDirectoryAsync(fullUri);
    } catch (error) {
      /**
       * Directory may have vanished or been replaced between the
       * first `getInfoAsync` and `readDirectoryAsync`. Preserve the
       * original failure if the recovery `getInfoAsync` also throws.
       */
      let recheck: ExpoFileInfo;
      try {
        recheck = await this.fileSystem.getInfoAsync(fullUri);
      } catch {
        throw error;
      }
      if (!recheck.exists) {
        return [];
      }
      if (recheck.isDirectory !== true) {
        throw new Error('listFiles: path is not a directory');
      }
      throw error;
    }

    const childBaseUri = fullUri.endsWith('/') ? fullUri : `${fullUri}/`;
    const names = (
      await Promise.all(
        rawNames.map(async (name) => {
          /**
           * Skip adapter-owned scratch siblings (`.__kwtmp__.*`,
           * `.__kwbak__.*`, `.__kwdel__.*`) so an in-flight mutation
           * or a crashed prior run cannot leak internal bookkeeping
           * into the public listing.
           */
          if (isScratchSibling(name)) {
            return null;
          }
          const childUri = `${childBaseUri}${name}`;
          try {
            const childInfo = await this.fileSystem.getInfoAsync(childUri);
            /**
             * Fail closed: drop any entry whose type is not an
             * explicit `isDirectory: false` so a directory with
             * incomplete metadata never leaks into the listing.
             */
            if (!childInfo.exists || childInfo.isDirectory !== false) {
              return null;
            }
            return name;
          } catch (error) {
            /**
             * Only swallow the true "child vanished between listing
             * and per-entry stat" race - surface every other error
             * (permission denied etc.) instead of silently dropping.
             */
            try {
              const recheck = await this.fileSystem.getInfoAsync(childUri);
              if (!recheck.exists) {
                return null;
              }
            } catch {
              /* Preserve the original per-entry failure below. */
            }
            throw error;
          }
        }),
      )
    ).filter((name): name is string => name !== null);
    /**
     * Sort lexicographically so order is deterministic across adapters
     * - native `readDirectoryAsync` makes no order guarantee.
     */
    names.sort((a, b) => a.localeCompare(b));
    if (pattern === undefined) {
      return names;
    }
    const regex = globToRegex(pattern);
    return names.filter((name) => regex.test(name));
  }

  /**
   * Expo's `getInfoAsync` only returns `size` when `{ size: true }`
   * is passed, so the option is threaded through. Directories are
   * rejected explicitly because `getInfoAsync` omits `size` for them.
   * A missing or non-integer `size` on an existing file is also a hard
   * failure so the caller never silently treats a non-empty payload
   * as zero bytes (which would defeat batch-retention logic).
   *
   * @param args - Adapter-relative path.
   * @returns Byte length, or `null` when the path does not exist.
   * @throws Error when the path exists but resolves to a directory,
   *   or when `info.size` is missing / not a non-negative integer.
   */
  async fileSize({ path }: FileSizeArgs): Promise<number | null> {
    validPath({ path, fnName: 'fileSize' });
    const fullUri = resolveUnderRoot({ rootDir: this.rootDir, relativePath: path });

    /**
     * Recovery wrap mirrors readFile / deleteFile: a concurrent
     * removal surfacing as a `getInfoAsync` throw resolves to `null`
     * per the missing-is-no-op contract.
     */
    let info: ExpoFileInfo;
    try {
      info = await this.fileSystem.getInfoAsync(fullUri, { size: true });
    } catch (error) {
      await this.recoverMissingOrRethrow(fullUri, error);
      return null;
    }
    if (!info.exists) {
      return null;
    }
    /**
     * Fail closed: treat anything other than `isDirectory: false` as
     * a non-file and refuse to report a misleading byte count.
     */
    if (info.isDirectory !== false) {
      throw new Error('fileSize: path is a directory');
    }
    /**
     * Reject a missing or malformed `size` for an existing file: the
     * `?? 0` shortcut would let a non-empty payload appear as empty
     * and corrupt downstream "keep this batch?" decisions.
     */
    if (!Number.isInteger(info.size) || (info.size as number) < 0) {
      throw new TypeError('fileSize: invalid size');
    }
    return info.size as number;
  }
}

export { ExpoStorageAdapter };
