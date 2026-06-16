/**
 * Bare React Native `StorageAdapter` backed entirely by
 * `react-native-fs`. Every value the SDK persists is a file under an
 * SDK-owned subdirectory of the app's document directory by default;
 * callers may override the root with the `rootDir` arg.
 *
 * Writes route through a per-operation scratch sibling that is moved
 * over the destination on success. The fresh-write case is atomic;
 * the overwrite case is best-effort because `react-native-fs.moveFile`
 * does not expose an atomic replace-and-rename primitive, so the
 * adapter falls back to delete-then-move and a reader may briefly
 * observe `null` for the destination during that window.
 *
 * @example
 * ```ts
 * import { BareRNStorageAdapter } from '@keewano/react-native-sdk';
 *
 * const storage = new BareRNStorageAdapter();
 * await storage.writeFile({ path: 'batches/1.kwub', bytes });
 * ```
 */

import type {
  BareRNStorageAdapterArgs,
  RNFSDirEntry,
  RNFSLike,
  RNFSStatResult,
} from './types/nativeStorageAdapter';

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

import { loadRNFS } from './helpers/loadNativeModules';
import { ensureParentDir, resolveUnderRoot } from './helpers/pathHelpers';

const ENCODING_BASE64 = 'base64';

/**
 * Strip a run of trailing `/` characters with an explicit loop, but
 * preserve filesystem roots so `'/'` stays `'/'` and `'C:/'` stays
 * `'C:/'`. Trimming a root-only input down to `''` or `'C:'` would
 * make a legitimate absolute `rootDir` fail the absolute-path check.
 * Using a regex like `/\/+$/` for the strip would be flagged by SAST
 * tools as a potential backtracking surface even though the anchored
 * greedy quantifier is actually linear-time in ECMAScript engines;
 * the slice form makes the linear-time guarantee obvious.
 */
function stripTrailingSlashes(s: string): string {
  const isDriveRoot =
    s.length >= 3 &&
    s.codePointAt(1) === 0x3a /* ':' */ &&
    /^[A-Za-z]$/.test(s[0] ?? '') &&
    s.codePointAt(2) === 0x2f; /* '/' */
  let minEndIdx = 0;
  if (isDriveRoot) {
    minEndIdx = 3;
  } else if (s.startsWith('/')) {
    minEndIdx = 1;
  }
  let endIdx = s.length;
  while (endIdx > minEndIdx && s.codePointAt(endIdx - 1) === 0x2f /* '/' */) {
    endIdx -= 1;
  }
  return s.substring(0, endIdx);
}

class BareRNStorageAdapter implements StorageAdapter {
  /**
   * Per-`rootDir` coordinator registry. Two adapter instances pointed
   * at the same sandbox root share the same serialization queue so
   * path-level mutation safety follows the on-disk location, not the
   * wrapper instance.
   *
   * KNOWN LIMITATION: keys are EXACT paths, so two concurrent
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
  private readonly rnfs: RNFSLike;
  private readonly mutations: MutationCoordinator;

  /**
   * Construct an adapter bound to the host's React Native runtime
   * modules. The native bindings are loaded lazily so a host that
   * imports the adapter without instantiating it pays no startup cost.
   *
   * @param args - Optional sandbox root override and a DI hook for
   *   `react-native-fs`. Pass a mock in tests.
   */
  constructor(args: BareRNStorageAdapterArgs = {}) {
    if (args.rootDir?.length === 0) {
      throw new Error('BareRNStorageAdapter: empty rootDir');
    }
    /* istanbul ignore next - native loader fallback only fires outside test runtime */
    const rnfs = args.rnfs ?? loadRNFS();

    if (args.rootDir === undefined && !rnfs.DocumentDirectoryPath) {
      /**
       * Hard-fail when the native runtime does not expose a document
       * directory: the default `${undefined}/keewano` would otherwise
       * turn into an invalid sandbox root.
       */
      throw new Error('BareRNStorageAdapter: DocumentDirectoryPath unavailable');
    }
    /**
     * Require an absolute resolved root so a relative `rootDir`
     * override cannot escape the app document sandbox. Normalize the
     * default `DocumentDirectoryPath` the same way as an explicit
     * override so a trailing slash or Windows backslash never produces
     * two different strings for the same on-disk directory and split
     * the shared mutation queue. The trailing-slash strip uses an
     * explicit loop instead of `/\/+$/` so SAST tools cannot flag it
     * as backtracking-sensitive.
     */
    const baseRoot = (args.rootDir ?? rnfs.DocumentDirectoryPath).replaceAll('\\', '/');
    const normalizedBase = stripTrailingSlashes(baseRoot);
    /**
     * Join `keewano` without doubling the separator when
     * `normalizedBase` is a filesystem root preserved as `/` or `C:/`:
     * `${root}/keewano` for `/` would produce `//keewano` and split
     * `sharedMutations` from any explicit-rootDir override pointing at
     * the same on-disk location.
     */
    const separator = normalizedBase.endsWith('/') ? '' : '/';
    const normalizedRoot =
      args.rootDir === undefined ? `${normalizedBase}${separator}keewano` : normalizedBase;
    if (!normalizedRoot.startsWith('/') && !/^[A-Za-z]:\//.test(normalizedRoot)) {
      throw new Error('BareRNStorageAdapter: rootDir must be an absolute path');
    }
    /**
     * Reject UNC roots. `replaceAll('\\', '/')` turns a Windows UNC
     * path (`\\server\share`) into `//server/share`, which passes the
     * leading-slash check above and would sandbox the file pool onto a
     * remote, possibly attacker-controlled, network share. A genuine
     * POSIX root is exactly one leading slash, so a second leading
     * slash can only be a UNC authority.
     */
    if (normalizedRoot.startsWith('//')) {
      throw new Error('BareRNStorageAdapter: rootDir must not be a UNC path');
    }
    this.rootDir = normalizedRoot;
    this.rnfs = rnfs;

    const shared =
      BareRNStorageAdapter.sharedMutations.get(this.rootDir) ?? new MutationCoordinator();
    BareRNStorageAdapter.sharedMutations.set(this.rootDir, shared);
    this.mutations = shared;
  }

  /**
   * Bytes are base64-encoded (react-native-fs's `writeFile` is
   * string-only) and routed through a per-operation scratch sibling
   * moved into place via `moveFile`. See the class-level JSDoc for
   * the overwrite atomicity caveat.
   *
   * Scratch sibling names embed a per-operation id (`__kwtmp__.<id>`
   * and `__kwbak__.<id>`) so a real user file living at
   * `${fullPath}.tmp` or `${fullPath}.bak` cannot collide with our
   * scratch state: serialization protects only the destination path,
   * not arbitrary suffixes a caller might already be using.
   *
   * @param args - Adapter-relative path and binary contents.
   */
  async writeFile({ path, bytes }: WriteFileArgs): Promise<void> {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('writeFile: not a Uint8Array');
    }
    validPath({ path, fnName: 'writeFile' });
    const fullPath = resolveUnderRoot({ rootDir: this.rootDir, relativePath: path });
    /**
     * `opId` is a uniqueness suffix, NOT a security token. The
     * mutation queue prevents two live writes sharing the same
     * destination; the shared helper prefers `crypto.getRandomValues`
     * so SAST tools stop flagging `Math.random`.
     */
    const opId = generateOpId();
    const tmpPath = `${fullPath}.${SCRATCH_TMP_INFIX}.${opId}`;
    const backupPath = `${fullPath}.${SCRATCH_BAK_INFIX}.${opId}`;

    /**
     * Serialize concurrent writes to the same logical path so two
     * overlapping calls cannot stomp each other mid-flight.
     */
    await this.mutations.run({
      key: fullPath,
      op: () => this.doWriteFile(tmpPath, fullPath, backupPath, bytes),
    });
  }

  /**
   * Full write pipeline: prepare parent, stage to `.tmp`, swap the
   * existing destination aside to `.bak`, commit the tmp into place
   * (restoring from backup if the final move fails), and clean up.
   */
  private async doWriteFile(
    tmpPath: string,
    fullPath: string,
    backupPath: string,
    bytes: Uint8Array,
  ): Promise<void> {
    await ensureParentDir({ rnfs: this.rnfs, fullPath });

    try {
      await this.rnfs.writeFile(tmpPath, bytesToBase64(bytes), ENCODING_BASE64);
      const hasBackup = await this.moveExistingToBackup(fullPath, backupPath);
      await this.commitTmpOrRestore(tmpPath, fullPath, backupPath, hasBackup);
    } catch (error) {
      await this.bestEffortUnlink(tmpPath);
      throw error;
    }
  }

  /**
   * Rename the existing destination file (if any) aside to `backupPath`
   * so a failed move of the tmp file can be undone. Returns `true`
   * when a backup was made. Throws when the destination resolves to a
   * directory.
   */
  private async moveExistingToBackup(fullPath: string, backupPath: string): Promise<boolean> {
    /**
     * Route the initial probe through `recoverMissingOrRethrow` so a
     * concurrent removal surfacing as an `exists` throw resolves to
     * "no backup needed" instead of failing the write after tmp was
     * already staged.
     */
    let initialExists: boolean;
    try {
      initialExists = await this.rnfs.exists(fullPath);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullPath, error);
      return false;
    }
    if (!initialExists) {
      return false;
    }
    /**
     * Race-recover stat failures via `recoverMissingOrRethrow` so a
     * concurrent removal preserves the original `stat` error if the
     * path is still present. The contract-violation throw on
     * `isDirectory` escapes either way.
     */
    let existing: RNFSStatResult;
    try {
      existing = await this.rnfs.stat(fullPath);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullPath, error);
      return false;
    }
    if (existing.isDirectory()) {
      throw new Error('writeFile: destination path is a directory');
    }
    /**
     * Re-check before the rename to narrow the TOCTOU window. Route
     * the probe through `recoverMissingOrRethrow` so a transient
     * native failure here does not abort the write when the
     * destination has simply disappeared.
     */
    let recheckExists: boolean;
    try {
      recheckExists = await this.rnfs.exists(fullPath);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullPath, error);
      return false;
    }
    if (!recheckExists) {
      return false;
    }
    let latest: RNFSStatResult;
    try {
      latest = await this.rnfs.stat(fullPath);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullPath, error);
      return false;
    }
    if (latest.isDirectory()) {
      throw new Error('writeFile: destination path is a directory');
    }
    /**
     * Clear any stale backup left by a crashed prior run before
     * staging the new one.
     */
    await this.bestEffortUnlink(backupPath);
    /**
     * Race-recover moveFile failures via the shared helper so a
     * concurrent removal mid-rename preserves the original error if
     * the path is still present. The native rename may complete on
     * the OS layer and only THEN reject at the JS bridge (post-move
     * observer / bridge serialization), so re-probe `backupPath`
     * first: a backup that actually landed means the rename succeeded
     * and we must continue with `hasBackup = true` instead of
     * silently dropping the previous file under the scratch name. If
     * the probe ITSELF throws AND the source is also confirmed gone,
     * we cannot tell whether the backup landed - rethrow the original
     * move error so a later failing commit does not silently drop the
     * previous file contents that may be sitting at `backupPath`.
     */
    try {
      await this.rnfs.moveFile(fullPath, backupPath);
    } catch (error) {
      const outcome = await this.classifyPostRenameThrow(fullPath, backupPath, error);
      if (outcome === 'sourceGone') {
        return false;
      }
    }
    await this.verifyBackupOrRestore(fullPath, backupPath);
    return true;
  }

  /**
   * Confirm the entry that landed at `backupPath` after the rename is
   * still an explicit file. If the stat fails OR reports a directory
   * (file-to-directory swap after the last guard), best-effort restore
   * the backup to `fullPath` so a failed overwrite is never
   * destructive, then surface the original failure / contract
   * violation. Counterpart of the Expo `verifyBackupOrRestore` helper.
   */
  private async verifyBackupOrRestore(fullPath: string, backupPath: string): Promise<void> {
    let moved: RNFSStatResult;
    try {
      moved = await this.rnfs.stat(backupPath);
    } catch (verifyError) {
      /**
       * Distinguish a confirmed-missing backup from a generic stat I/O
       * failure: a confirmed vanish gets the explicit
       * `backup vanished during overwrite` diagnostic so callers can
       * tell apart "concurrent removal of our scratch sibling" from
       * "stat failed for another reason." Parity with the Expo
       * `verifyBackupOrRestore` `!moved.exists` branch.
       */
      let backupStillThere: boolean;
      try {
        backupStillThere = await this.rnfs.exists(backupPath);
      } catch {
        backupStillThere = true;
      }
      try {
        await this.rnfs.moveFile(backupPath, fullPath);
      } catch {
        /* Preserve the original verification failure even if restore fails. */
      }
      if (!backupStillThere) {
        throw new Error('writeFile: backup vanished during overwrite');
      }
      throw verifyError;
    }
    if (moved.isDirectory()) {
      try {
        await this.rnfs.moveFile(backupPath, fullPath);
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
    tmpPath: string,
    fullPath: string,
    backupPath: string,
    hasBackup: boolean,
  ): Promise<void> {
    try {
      await this.rnfs.moveFile(tmpPath, fullPath);
    } catch (moveError) {
      /**
       * Native rename may complete on the OS layer and only THEN
       * reject. Classify the post-throw state across THREE outcomes:
       * - LANDED (`tmp` absent + `full` present): the rename actually
       *   committed. Clean up the backup and treat as success.
       * - FAILED (`tmp` present, OR `tmp` absent + `full` absent): the
       *   rename did not happen. Restore the backup if any.
       * - AMBIGUOUS (any probe `unknown`): we cannot tell. The backup
       *   may be the only copy of the old data, so DO NOT restore (it
       *   could overwrite a successful commit) and DO NOT clean it up
       *   (caller may need to recover). Rethrow the move error.
       */
      const tmpState = await this.probePresence(tmpPath);
      const fullState = await this.probePresence(fullPath);
      if (tmpState === 'absent' && fullState === 'present') {
        if (hasBackup) {
          await this.bestEffortUnlink(backupPath);
        }
        return;
      }
      if (tmpState === 'unknown' || fullState === 'unknown') {
        throw moveError;
      }
      if (hasBackup) {
        try {
          await this.rnfs.moveFile(backupPath, fullPath);
        } catch {
          /* Preserve the original move failure even if restore fails. */
        }
      }
      throw moveError;
    }
    if (hasBackup) {
      await this.bestEffortUnlink(backupPath);
    }
  }

  /**
   * Best-effort unlink used for tmp / backup cleanup so a cleanup
   * error never masks the original write failure. The targets are
   * always our own per-operation scratch siblings (suffix
   * `.__kwtmp__.<opId>` / `.__kwbak__.<opId>`), so a directory cannot
   * realistically land there - no defensive isDirectory check is
   * needed.
   */
  private async bestEffortUnlink(target: string): Promise<void> {
    try {
      if (!(await this.rnfs.exists(target))) {
        return;
      }
      await this.rnfs.unlink(target);
    } catch {
      /* Preserve any concurrent error. */
    }
  }

  /**
   * The read is attempted first, then `exists` confirms whether a
   * thrown error means "absent" or a genuine I/O failure. Avoids the
   * check-then-read race window opened by the `unlink` + `moveFile`
   * pair in `writeFile`.
   *
   * The recovery wrap is scoped to `rnfs.readFile` only: a
   * `base64ToBytes` decode failure on legitimately-read bytes must
   * surface as itself, never as `null`, even if the path happens to
   * vanish between the successful read and a later stat.
   *
   * @param args - Adapter-relative path.
   * @returns File contents, or `null` when the path does not exist.
   */
  async readFile({ path }: ReadFileArgs): Promise<Uint8Array | null> {
    validPath({ path, fnName: 'readFile' });
    const fullPath = resolveUnderRoot({ rootDir: this.rootDir, relativePath: path });

    let b64: string;
    try {
      b64 = await this.rnfs.readFile(fullPath, ENCODING_BASE64);
    } catch (error) {
      /**
       * Preserve the original read error if the follow-up `exists`
       * / `stat` calls also fail; only translate the recovery shape
       * (missing -> null, directory -> explicit error).
       */
      let exists: boolean;
      try {
        exists = await this.rnfs.exists(fullPath);
      } catch {
        throw error;
      }
      if (!exists) {
        return null;
      }
      let dirStat: RNFSStatResult;
      try {
        dirStat = await this.rnfs.stat(fullPath);
      } catch {
        /**
         * Stat itself fails (race, permission): surface the original
         * read error rather than a synthetic recovery diagnostic.
         */
        throw error;
      }
      if (dirStat.isDirectory()) {
        throw new Error('readFile: path is a directory');
      }
      throw error;
    }
    return base64ToBytes(b64);
  }

  /**
   * `react-native-fs.unlink` throws on a missing path, so the adapter
   * pre-checks `exists` and returns silently when the destination is
   * already absent. A `stat` guard rejects directory targets up-front
   * because `unlink` removes directories recursively, which would
   * violate the file-only contract and risk wiping an entire subtree
   * from a mistaken caller.
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
    const fullPath = resolveUnderRoot({ rootDir: this.rootDir, relativePath: path });

    /**
     * Chain off the same per-path serialization queue `writeFile`
     * uses so an in-flight write cannot make this delete observe the
     * destination as temporarily missing during the backup/tmp swap
     * and return a false silent success.
     */
    await this.mutations.run({
      key: fullPath,
      op: () => this.doDeleteFile(fullPath),
    });
  }

  /** Inner delete pipeline run by `deleteFile` under the mutation chain. */
  private async doDeleteFile(fullPath: string): Promise<void> {
    let initialExists: boolean;
    try {
      initialExists = await this.rnfs.exists(fullPath);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullPath, error);
      return;
    }
    if (!initialExists) {
      return;
    }

    /**
     * First stat: classify file vs directory. The contract-violation
     * throw escapes immediately - never wrapped in a race-recovery
     * catch.
     */
    let stat: RNFSStatResult;
    try {
      stat = await this.rnfs.stat(fullPath);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullPath, error);
      return;
    }
    if (stat.isDirectory()) {
      throw new Error('deleteFile: path is a directory');
    }

    /**
     * Re-check before `unlink` to narrow the TOCTOU window against a
     * file-to-directory swap.
     */
    let recheckExists: boolean;
    try {
      recheckExists = await this.rnfs.exists(fullPath);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullPath, error);
      return;
    }
    if (!recheckExists) {
      return;
    }
    let latest: RNFSStatResult;
    try {
      latest = await this.rnfs.stat(fullPath);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullPath, error);
      return;
    }
    if (latest.isDirectory()) {
      throw new Error('deleteFile: path is a directory');
    }

    /**
     * Final TOCTOU guard: route through a per-operation trash sibling
     * so a file-to-directory swap cannot trick `rnfs.unlink` into
     * recurse-wiping a subtree. See `unlinkViaTrash` for the verify +
     * restore flow.
     */
    await this.unlinkViaTrash(fullPath);
  }

  /**
   * Three-state existence probe: `present` / `absent` / `unknown`.
   * `unknown` is returned when the native `exists` call itself throws
   * (transient I/O, permission flap, bridge serialization). Post-
   * mutation recovery branches MUST distinguish `absent` from
   * `unknown` so a thrown probe is not silently conflated with a
   * confirmed-missing entry: if a rename actually landed and the
   * follow-up probe throws, treating it as `absent` leaves data
   * orphaned at the scratch path.
   */
  private async probePresence(path: string): Promise<'present' | 'absent' | 'unknown'> {
    try {
      return (await this.rnfs.exists(path)) ? 'present' : 'absent';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Stat `path`. If `stat` throws but the three-state probe confirms
   * the path is gone, return `null` so the caller can treat it as
   * "vanished". Otherwise rethrow the original stat error so a real
   * I/O failure (or an ambiguous probe throw) surfaces. Using
   * `probePresence` instead of a 2-state silent probe makes a
   * thrown follow-up `exists` count as ambiguous rather than as a
   * confirmed-missing entry - which would otherwise let an orphan at
   * the scratch path silently pass as a completed delete.
   */
  private async statOrTreatVanished(path: string): Promise<RNFSStatResult | null> {
    try {
      return await this.rnfs.stat(path);
    } catch (statError) {
      if ((await this.probePresence(path)) === 'absent') {
        return null;
      }
      throw statError;
    }
  }

  /**
   * Move `fullPath` to a per-operation trash sibling, verify the moved
   * entry is still an explicit file, and only then unlink the trash.
   * If anything later fails (verify stat throw, contract-violation
   * throw, or unlink throw) AFTER the move-to-trash succeeded, the
   * helper best-effort restores the file to its original path before
   * rethrowing so a failed delete is never silently destructive.
   * Counterpart of the Expo `unlinkViaTrash` helper.
   */
  /**
   * Classify a post-rename throw using the three-state probe pattern.
   * Returns:
   *   - `'landed'`: probe confirms the destination is present - the
   *     rename actually succeeded despite the throw; caller continues
   *     as if the rename returned cleanly.
   *   - `'sourceGone'`: destination is confirmed missing AND source is
   *     confirmed missing - caller may treat as a benign concurrent
   *     removal (silent no-op).
   * Throws `originalError` when the source is still present (standard
   * rethrow path) OR when the destination probe was ambiguous and the
   * source is confirmed gone (orphan risk - fail loudly).
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
   * `unlink` may complete on the OS layer and only THEN reject. If
   * BOTH the trash entry AND the source path are confirmed gone, the
   * delete intent is satisfied even though the call threw.
   */
  private async unlinkLanded(trashPath: string, fullPath: string): Promise<boolean> {
    return (
      (await this.probePresence(trashPath)) === 'absent' &&
      (await this.probePresence(fullPath)) === 'absent'
    );
  }

  private async unlinkViaTrash(fullPath: string): Promise<void> {
    const trashPath = `${fullPath}.${SCRATCH_DEL_INFIX}.${generateOpId()}`;
    let movedToTrash = false;
    let deleteCompleted = false;
    try {
      await this.rnfs.moveFile(fullPath, trashPath);
      movedToTrash = true;
    } catch (moveError) {
      const outcome = await this.classifyPostRenameThrow(fullPath, trashPath, moveError);
      if (outcome === 'sourceGone') {
        return;
      }
      movedToTrash = true;
    }
    try {
      const moved = await this.statOrTreatVanished(trashPath);
      /**
       * Concurrent cleanup removed the trash entry between our move and
       * this stat. The delete is effectively complete, so resolve
       * silently per the idempotent contract.
       */
      if (moved === null) {
        return;
      }
      if (moved.isDirectory()) {
        throw new Error('deleteFile: path is a directory');
      }
      await this.rnfs.unlink(trashPath);
      deleteCompleted = true;
    } catch (error) {
      if (movedToTrash && !deleteCompleted) {
        if (await this.unlinkLanded(trashPath, fullPath)) {
          return;
        }
        try {
          await this.rnfs.moveFile(trashPath, fullPath);
        } catch {
          /* Preserve the original failure even if restore fails. */
        }
        throw error;
      }
      await this.recoverMissingOrRethrow(fullPath, error);
    }
  }

  /**
   * After a filesystem call throws, re-check existence so a confirmed
   * missing path resolves silently per the idempotent contract. Throws
   * `originalError` when the path still exists or when the recovery
   * `exists` call itself throws. Returning normally signals "missing",
   * leaving the caller to issue its own `return` / `return null`.
   */
  private async recoverMissingOrRethrow(fullPath: string, originalError: unknown): Promise<void> {
    let exists: boolean;
    try {
      exists = await this.rnfs.exists(fullPath);
    } catch {
      throw originalError;
    }
    if (exists) {
      throw originalError;
    }
  }

  /**
   * `rnfs.exists` reports `true` for both files and directories, and
   * `rnfs.readDir` throws on a non-directory entry, so a `stat` is
   * needed to distinguish the two cases. A non-directory path is
   * treated the same as a missing directory.
   *
   * @param args - Adapter-relative directory and optional glob filter.
   * @returns Basenames of matching entries, or an empty array when
   *   the directory does not exist, is not a directory, or no entries
   *   match.
   */
  async listFiles({ dir, pattern }: ListFilesArgs): Promise<string[]> {
    validPath({ path: dir, fnName: 'listFiles' });
    const fullDir = resolveUnderRoot({ rootDir: this.rootDir, relativePath: dir });
    /**
     * Route the initial probe through `recoverMissingOrRethrow` so a
     * concurrent removal surfacing as an `exists` throw resolves to
     * `[]` per the missing-directory contract.
     */
    let exists: boolean;
    try {
      exists = await this.rnfs.exists(fullDir);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullDir, error);
      return [];
    }
    if (!exists) {
      return [];
    }

    /**
     * Stat classification is kept outside the `readDir` recovery
     * block: a file target must surface as `listFiles: path is not a
     * directory` even if the file disappears before the recovery
     * `exists` check runs, and the contract throw must never degrade
     * to `[]`.
     */
    let dirStat: RNFSStatResult;
    try {
      dirStat = await this.rnfs.stat(fullDir);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullDir, error);
      return [];
    }
    if (!dirStat.isDirectory()) {
      throw new Error('listFiles: path is not a directory');
    }

    let entries: RNFSDirEntry[];
    try {
      entries = await this.rnfs.readDir(fullDir);
    } catch (error) {
      /**
       * Directory may have vanished between `stat` and `readDir`;
       * missing directory -> `[]`. Preserve the original failure if
       * recovery `exists` also throws.
       */
      let exists: boolean;
      try {
        exists = await this.rnfs.exists(fullDir);
      } catch {
        throw error;
      }
      if (!exists) {
        return [];
      }
      throw error;
    }

    /**
     * Drop subdirectories AND adapter-owned scratch siblings
     * (`.__kwtmp__.*`, `.__kwbak__.*`, `.__kwdel__.*`) so an in-flight
     * mutation or a crashed prior run cannot leak internal bookkeeping
     * into the public listing.
     */
    const names = entries
      .filter((entry) => !entry.isDirectory() && !isScratchSibling(entry.name))
      .map((entry) => entry.name);
    /**
     * Sort lexicographically so order is deterministic across adapters
     * - native `readDir` makes no order guarantee.
     */
    names.sort((a, b) => a.localeCompare(b));
    if (pattern === undefined) {
      return names;
    }
    const regex = globToRegex(pattern);
    return names.filter((name) => regex.test(name));
  }

  /**
   * `react-native-fs.stat` returns size as a number on iOS and a
   * numeric string on Android, so the value is normalized via
   * `Number(...)` (strict whole-string parse) when needed. Directories
   * are rejected explicitly and any non-integer or negative parsed
   * size is treated as a hard failure so callers never receive `NaN`
   * or a silently-truncated value like `Number.parseInt('123abc')`.
   *
   * The recovery wrap is scoped to `rnfs.stat` only: contract-violation
   * throws (directory target, invalid size) live OUTSIDE the catch so
   * a concurrent removal cannot swallow them as a silent `null`.
   *
   * @param args - Adapter-relative path.
   * @returns Byte length, or `null` when the path does not exist.
   * @throws Error when the path is a directory or when `stat.size`
   *   cannot be parsed as a non-negative integer.
   */
  async fileSize({ path }: FileSizeArgs): Promise<number | null> {
    validPath({ path, fnName: 'fileSize' });
    const fullPath = resolveUnderRoot({ rootDir: this.rootDir, relativePath: path });

    let stat: RNFSStatResult;
    try {
      stat = await this.rnfs.stat(fullPath);
    } catch (error) {
      await this.recoverMissingOrRethrow(fullPath, error);
      return null;
    }
    if (stat.isDirectory()) {
      throw new Error('fileSize: path is a directory');
    }
    /**
     * `Number('')` and `Number('  ')` both coerce to 0, which would
     * silently misreport a non-empty file as empty. Reject any string
     * not matching a strict-decimal non-negative integer shape.
     */
    let size: number;
    if (typeof stat.size === 'number') {
      size = stat.size;
    } else if (/^(0|[1-9]\d*)$/.test(stat.size)) {
      size = Number(stat.size);
    } else {
      size = Number.NaN;
    }
    if (!Number.isInteger(size) || size < 0) {
      throw new TypeError('fileSize: invalid size');
    }
    return size;
  }
}

export { BareRNStorageAdapter };
