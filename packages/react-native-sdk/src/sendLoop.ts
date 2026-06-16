/**
 * Async send loop. Each iteration follows the persistence-first
 * invariant - data lands on disk before any HTTP attempt:
 *
 *   1. Read consent. If `'send'`: ship existing `.kwub` files (POST /in
 *      + delete on 2xx). If `'delete'` (Denied): delete every batch
 *      silently. If `'keep'` (Pending): skip ship pass.
 *   2. Apply 50 MB disk cap via `reduceStorageSize`.
 *   3. Wait for dispatcher signal or idle timeout, raced against abort.
 *   4. After wake (and not aborted): `swapBatches` the dispatcher; if
 *      the resulting `sendingBatch` has bytes, persist it as one or
 *      more `.kwub` files (split at cut points) BEFORE the next
 *      iteration ships them.
 *
 * The K-Tester HTTP header is read live from `dispatcher.pendingTestUserName`
 * per ship so a `markAsTestUser` call between ships takes effect on
 * the next batch.
 */

import type {
  LoopContext,
  PersistAccumulatedBatchArgs,
  RunSendLoopArgs,
  SaveAllSubBatchesArgs,
  TrySaveSubBatchArgs,
  WaitForSignalOrTimeoutArgs,
} from './types/sendLoop';

import {
  consentGate,
  deleteBatch,
  getCustomEventMapStatus,
  hasControlChar,
  isByteString,
  listBatches,
  loadBatch,
  reduceStorageSize,
  registerCustomEventMap,
  saveBatch,
  sendBatch,
} from '@keewano/core';

/** Idle window between iterations when no dispatcher signal arrives. */
const DEFAULT_IDLE_MS = 30_000;

/**
 * Maximum number of batches shipped per send pass. Bounds RAM and
 * concurrent HTTP load: a backlog of thousands of small batches is
 * processed across many iterations rather than in one burst.
 */
const DEFAULT_BATCHES_PER_CYCLE = 30;

/**
 * On-disk batch directory cap. Batches exceeding this on next
 * iteration are tombstoned via `reduceStorageSize`.
 */
const DEFAULT_CAP_BYTES = 50 * 1024 * 1024;

/**
 * Run the send loop until `signal` aborts. Returns when the loop has
 * exited cleanly; never rejects under normal operation because every
 * iteration's helpers wrap their own throws.
 */
async function runSendLoop(args: RunSendLoopArgs): Promise<void> {
  const ctx: LoopContext = {
    storage: args.storage,
    dispatcher: args.dispatcher,
    endpoint: args.endpoint,
    apiKey: args.apiKey,
    installId: args.installId,
    getConsent: args.getConsent,
    getNextBatchNum: args.getNextBatchNum,
    signal: args.signal,
    batchesDir: args.batchesDir,
    batchesPerCycle: args.batchesPerCycle ?? DEFAULT_BATCHES_PER_CYCLE,
    capBytes: args.capBytes ?? DEFAULT_CAP_BYTES,
    customEventSet: args.customEventSet,
    customEventsRegistered: false,
    getExtraHeaders: args.getExtraHeaders,
    extraHeaders: {},
  };
  const idleMs = args.idleMs ?? DEFAULT_IDLE_MS;

  while (!ctx.signal.aborted) {
    /**
     * Read consent through a guard so a buggy consent provider that
     * throws cannot escape runSendLoop and stop both shipping AND
     * cleanup. Fail closed to 'keep' (accumulate, no network) -
     * the next iteration's read may recover. The pre-persist
     * re-check below routes a throw to dropInMemoryBatches so a
     * still-broken provider does not let the in-batch survive
     * into the next iteration with stale events.
     */
    await runConsentDecision(ctx);
    /**
     * Bail before the expensive disk-cap sweep when shutdown has
     * already been requested. The ship / delete pass above may
     * have taken long enough for the host to call shutdown(); the
     * 50 MB sweep is best-effort housekeeping and not worth
     * making teardown wait on.
     */
    if (ctx.signal.aborted) return;
    /**
     * Apply the 50 MB cap regardless of decision so a long-running
     * consent=Pending session does not accumulate beyond the limit.
     * The cap pass is best-effort: a storage hiccup must not break
     * the next iteration's send or consent pass.
     */
    try {
      await reduceStorageSize({
        storage: ctx.storage,
        dir: ctx.batchesDir,
        capBytes: ctx.capBytes,
      });
    } catch {
      /** Swallowed; the cap pass retries next iteration. */
    }

    if (ctx.signal.aborted) return;
    await waitForSignalOrTimeout({ dispatcher: ctx.dispatcher, idleMs, signal: ctx.signal });
    if (ctx.signal.aborted) return;

    /**
     * Re-check consent right before persisting. The user may have
     * flipped to Denied while the loop was parked on
     * waitForSignalOrTimeout, in which case any events accumulated
     * during the wait MUST NOT touch disk - persisting them would
     * leave denied-consent data on disk until a later cleanup pass
     * (privacy gap). A throw from the consent provider routes to
     * dropInMemoryBatches so the in-batch never reaches the disk
     * under uncertainty.
     */
    if (shouldDropBeforePersist(ctx)) {
      dropInMemoryBatches(ctx);
      continue;
    }

    await safePersistDispatcherSwap(ctx);
  }
}

/**
 * Branch on the consent-gate decision and drive the corresponding
 * iteration action. Extracted from the loop body to keep
 * `runSendLoop`'s cognitive load bounded.
 *
 * `'delete'` (Denied): silently delete every queued `.kwub`, no
 * network attempt. `'send'` (Granted / NotRequired): ensure the
 * custom-events schema is registered, then run a ship pass. A
 * registration failure aborts this iteration's ship pass but leaves
 * the on-disk queue intact so the next tick retries from scratch.
 * `'keep'` (Pending): no-op; events accumulate locally.
 */
async function runConsentDecision(ctx: LoopContext): Promise<void> {
  const decision = readConsentSafely(ctx);
  if (decision === 'delete') {
    await deleteAllBatches(ctx);
    return;
  }
  if (decision !== 'send') return;
  /**
   * Resolve the host's extra headers only once a ship pass is actually
   * going to run, so the provider (which may mint a short-lived token)
   * is not invoked on every idle / Pending / Denied tick. Resolved
   * fresh at the start of each pass so a token refreshed between
   * passes takes effect.
   */
  ctx.extraHeaders = await resolveExtraHeaders(ctx);
  const ready = await ensureCustomEventsRegistered(ctx);
  if (ready) await runShipPass(ctx);
}

/**
 * Persist whatever the dispatcher accumulated since the previous swap.
 * Wrapped because `persistAccumulatedBatch` documents itself as
 * best-effort but an unexpected throw from outside its own try /
 * catch surface (a storage adapter regression, a future dispatcher
 * swap-shape change) would otherwise escape `runSendLoop` and the
 * outer `startInit` `.catch` would silently kill the background
 * sender for the rest of the session. Catch locally so a single bad
 * iteration cannot take down delivery; the next iteration retries
 * against a fresh swap.
 */
async function safePersistDispatcherSwap(ctx: LoopContext): Promise<void> {
  try {
    await persistDispatcherSwap(ctx);
  } catch {
    /** Best-effort persist; the next iteration retries on a fresh swap. */
  }
}

/**
 * Resolve and sanitize the host's extra-header provider for this ship
 * pass. The send loop is contracted never to die, so untrusted
 * provider output is hardened here rather than allowed to reach the
 * swallow-everything send path: a throw, a non-object return, or an
 * individual header that is not header-safe degrades to dropping that
 * input (with a name-only log) instead of letting a `TypeError` from
 * `Object.keys(null)` or the core validator escape and stall delivery
 * silently and forever. Core `mergeExtraHeaders` re-validates as the
 * strict boundary for direct (non-loop) transport callers.
 */
async function resolveExtraHeaders(ctx: LoopContext): Promise<Record<string, string>> {
  if (ctx.getExtraHeaders === undefined) return {};
  let resolved: unknown;
  try {
    resolved = await ctx.getExtraHeaders();
  } catch (err: unknown) {
    console.error('Keewano: getExtraHeaders threw; sending without extra headers.', err);
    return {};
  }
  if (resolved === null || typeof resolved !== 'object') {
    console.error(
      'Keewano: getExtraHeaders did not return an object; sending without extra headers.',
    );
    return {};
  }
  return sanitizeExtraHeaders(resolved as Record<string, unknown>);
}

/**
 * Keep only the header-safe `string`-valued entries of an untrusted
 * record. A dropped header is logged by name only (never by value, so
 * a token never reaches the log). Mirrors the core validator's
 * control-char / ByteString rule so the loop drops exactly what core
 * would reject.
 */
function sanitizeExtraHeaders(raw: Record<string, unknown>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const name of Object.keys(raw)) {
    const value = raw[name];
    const unsafe =
      typeof value !== 'string' ||
      name.length === 0 ||
      hasControlChar(name) ||
      !isByteString(name) ||
      hasControlChar(value) ||
      !isByteString(value);
    if (unsafe) {
      console.error(`Keewano: dropping unsafe extra header "${name}".`);
      continue;
    }
    safe[name] = value;
  }
  return safe;
}

/**
 * Read consent through `consentGate`, returning the gate decision or
 * `'keep'` if the provider throws. Privacy-safe default: `'keep'`
 * means accumulate locally, do not ship. The next iteration's read
 * may recover.
 */
function readConsentSafely(ctx: LoopContext): ReturnType<typeof consentGate> {
  try {
    return consentGate(ctx.getConsent());
  } catch {
    return 'keep';
  }
}

/**
 * `true` when the pre-persist consent re-check says the in-batch must
 * NOT touch disk. Either the gate is `'delete'` (user revoked
 * mid-wait) or the provider threw (privacy-safe default under
 * uncertainty: do not persist).
 */
function shouldDropBeforePersist(ctx: LoopContext): boolean {
  try {
    return consentGate(ctx.getConsent()) === 'delete';
  } catch {
    return true;
  }
}

/**
 * Reset both in-batch buffers when consent flipped to Denied
 * mid-wait. Both resets are best-effort: a throw from either would
 * otherwise escape runSendLoop and kill the background sender on
 * the very path that protects user privacy. Each reset is wrapped
 * independently so one bad buffer cannot block the other.
 */
function dropInMemoryBatches(ctx: LoopContext): void {
  try {
    ctx.dispatcher.currentInBatch.resetForReuse();
  } catch {
    /** Best-effort cleanup; keep the loop alive. */
  }
  try {
    ctx.dispatcher.currentSendingBatch.resetForReuse();
  } catch {
    /** Best-effort cleanup; keep the loop alive. */
  }
}

/**
 * Persist whatever the dispatcher has accumulated since the last
 * successful save:
 *
 *   1. Swap in-batch into the sending slot.
 *   2. Stamp `batchEndTime = nowUnixSec()`.
 *   3. Split the payload at the sending slot's `cutPositions` into
 *      one `.kwub` file per slice. Each slice carries its own
 *      `batchNum`, the slice-window's start/end timestamps, and the
 *      data bytes for that window. The trailing slice (or the whole
 *      payload if no cuts were recorded) goes to a final file.
 *   4. Reset the sending slot regardless of save outcome.
 *
 * Save failures are best-effort: the failing sub-batch (and any later
 * slices in the same swap) is dropped and subsequent loop ticks pick
 * up fresh data. No dirty-retry, because retrying with the same
 * `batchNum` would either duplicate (if the failed file actually
 * landed) or cascade (if persisting the same payload keeps failing).
 * A small data gap on the server beats an infinite stuck loop.
 *
 * Called from both the send loop (per-iteration tick after wake)
 * and `Keewano.shutdown` (final flush after the loop has aborted).
 */
async function persistAccumulatedBatch(args: PersistAccumulatedBatchArgs): Promise<void> {
  const { storage, dispatcher, dir, allocBatchNum } = args;
  try {
    dispatcher.swapBatches();
  } catch {
    /**
     * The sending slot was non-empty (a prior save threw before
     * `resetForReuse` could run). Reset it ourselves so the loop
     * keeps moving; the previous payload is lost. The reset is
     * wrapped because a throw here would re-reject the helper
     * inside the very path meant to recover from a failed swap -
     * same best-effort contract as the post-save reset below.
     */
    try {
      dispatcher.currentSendingBatch.resetForReuse();
    } catch {
      return;
    }
    try {
      dispatcher.swapBatches();
    } catch {
      return;
    }
  }
  const sending = dispatcher.currentSendingBatch;
  if (sending.data.length === 0) {
    return;
  }
  sending.batchEndTime = Math.floor(Date.now() / 1000);
  try {
    await saveAllSubBatches({ storage, dir, sending, allocBatchNum });
  } finally {
    /**
     * Always reset so the next swap is clean. Sub-batches that
     * failed to save are accepted as lost; the next swap picks up
     * fresh accumulator state. The reset is wrapped because a throw
     * from `resetForReuse` would escape the finally, reject
     * `persistAccumulatedBatch`, and kill the background loop for
     * the rest of the session - this helper is explicitly
     * best-effort, so one bad buffer cleanup must not propagate.
     */
    try {
      sending.resetForReuse();
    } catch {
      /** Best-effort cleanup; reset failure must not reject the loop. */
    }
  }
}

/**
 * Loop-tick wrapper around {@link persistAccumulatedBatch}. The loop
 * supplies its own batch-num allocator via `ctx.getNextBatchNum`.
 */
async function persistDispatcherSwap(ctx: LoopContext): Promise<void> {
  await persistAccumulatedBatch({
    storage: ctx.storage,
    dispatcher: ctx.dispatcher,
    dir: ctx.batchesDir,
    allocBatchNum: ctx.getNextBatchNum,
  });
}

/**
 * Slice the swapped sending batch along its recorded `cutPositions`
 * and save one `.kwub` file per slice. Each slice spans
 * `[lastReadPos, cut.pos)` bytes with `batchStartTime = sliceStart`
 * and `batchEndTime = cut.lastEventTime`; the remainder past the last
 * cut (or the full payload when no cuts were recorded) becomes the
 * tail slice with `batchEndTime` taken from the sending batch's own
 * stamp.
 *
 * Stops on the first save failure - later slices for that swap are
 * dropped along with the failing one. Best-effort persistence is
 * intentional: the alternative (retry with the same batchNum) would
 * either duplicate or cascade.
 */
async function saveAllSubBatches(args: SaveAllSubBatchesArgs): Promise<void> {
  const { storage, dir, sending, allocBatchNum } = args;
  const payload = sending.data.toBytes();
  let lastReadPos = 0;
  let sliceStart = sending.batchStartTime;
  for (const cut of sending.cutPositions) {
    if (cut.pos > lastReadPos) {
      const ok = await trySaveSubBatch({
        storage,
        dir,
        sending,
        data: payload.subarray(lastReadPos, cut.pos),
        batchStartTime: sliceStart,
        batchEndTime: cut.lastEventTime,
        batchNum: allocBatchNum(),
      });
      if (!ok) return;
    }
    lastReadPos = cut.pos;
    sliceStart = cut.lastEventTime;
  }
  if (lastReadPos < payload.length) {
    await trySaveSubBatch({
      storage,
      dir,
      sending,
      data: payload.subarray(lastReadPos),
      batchStartTime: sliceStart,
      batchEndTime: sending.batchEndTime,
      batchNum: allocBatchNum(),
    });
  }
}

/**
 * Best-effort save of one sub-batch slice. Returns `true` on
 * success, `false` on any save error. Single source of truth for the
 * `KBatch` -> `BatchRecord` projection so future wire-shape changes
 * touch one place.
 */
async function trySaveSubBatch(args: TrySaveSubBatchArgs): Promise<boolean> {
  const { storage, dir, sending, data, batchStartTime, batchEndTime, batchNum } = args;
  try {
    await saveBatch({
      storage,
      dir,
      batch: {
        batchVersion: sending.batchVersion,
        userId: sending.userId,
        dataSessionId: sending.dataSessionId,
        batchNum,
        batchStartTime,
        batchEndTime,
        customEventsVersion: sending.customEventsVersion,
        data,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete every `.kwub` file under `ctx.batchesDir`. Used when consent
 * is `Denied` so the on-disk queue drops silently without contacting
 * the server.
 *
 * Best-effort: any storage error (listing or per-file delete) is
 * swallowed so the loop keeps moving. A permanent rejection here
 * would otherwise propagate out of `runSendLoop`, the fire-and-forget
 * catch in `startInit` would swallow it, and the background loop
 * would die for the rest of the session.
 */
async function deleteAllBatches(ctx: LoopContext): Promise<void> {
  let files;
  try {
    files = await listBatches({ storage: ctx.storage, dir: ctx.batchesDir });
  } catch {
    /** Listing failed (permissions / I/O); retry next iteration. */
    return;
  }
  for (const file of files) {
    try {
      await deleteBatch({ storage: ctx.storage, path: file.path });
    } catch {
      /** Per-file delete failed; skip and let the next iteration retry. */
    }
  }
}

/**
 * One-shot per-session check that the server already knows the
 * host's custom-events schema. Returns `true` when the ship pass is
 * allowed to proceed (no schema declared, or the server is up to
 * date), `false` when the registration step is still pending and the
 * caller should retry next iteration.
 *
 * Sequence on first call when a schema IS declared:
 *
 *   1. `GET /custom` with `K-CustomEventHash = customEventSet.version`.
 *   2. `'known'` -> mark registered, allow ship.
 *   3. `'needs-registration'` -> upload `customEventSet.gzipData`
 *      via `POST /custom`; on success mark registered, otherwise
 *      retry next iteration.
 *   4. `'error'` -> retry next iteration.
 *
 * `AbortError` / `TimeoutError` from `getCustomEventMapStatus` /
 * `registerCustomEventMap` are caught here: shutdown's abort signal
 * fires every in-flight `fetch` and we don't want the loop to die.
 * The next iteration short-circuits on `ctx.signal.aborted` before
 * reaching this helper.
 */
async function ensureCustomEventsRegistered(ctx: LoopContext): Promise<boolean> {
  if (ctx.customEventSet === undefined) return true;
  if (ctx.customEventsRegistered) return true;
  let status;
  try {
    status = await getCustomEventMapStatus({
      baseUrl: ctx.endpoint,
      apiKey: ctx.apiKey,
      version: ctx.customEventSet.version,
      signal: ctx.signal,
      extraHeaders: ctx.extraHeaders,
    });
  } catch {
    return false;
  }
  if (status === 'known') {
    ctx.customEventsRegistered = true;
    return true;
  }
  if (status !== 'needs-registration') return false;
  let posted = false;
  try {
    posted = await registerCustomEventMap({
      baseUrl: ctx.endpoint,
      apiKey: ctx.apiKey,
      ceSet: ctx.customEventSet,
      signal: ctx.signal,
      extraHeaders: ctx.extraHeaders,
    });
  } catch {
    return false;
  }
  if (!posted) return false;
  ctx.customEventsRegistered = true;
  return true;
}

/**
 * One ship pass: list existing `.kwub` files, POST each (up to
 * `batchesPerCycle`), delete on 2xx. Returns early when the abort
 * signal fires mid-pass so shutdown does not wait for the remaining
 * batches.
 *
 * Break-on-first-failure: if a ship attempt returns `false`, the
 * pass stops immediately and the remaining backlog stays on disk
 * for the next iteration. The win is twofold - we don't waste HTTP
 * attempts against a server that's already proven to be down, and
 * we don't burn the 30 s wait budget reissuing the same failures.
 */
async function runShipPass(ctx: LoopContext): Promise<void> {
  let files;
  try {
    files = (await listBatches({ storage: ctx.storage, dir: ctx.batchesDir })).slice(
      0,
      ctx.batchesPerCycle,
    );
  } catch {
    /**
     * Listing failed (permissions / I/O). Swallow so an unhandled
     * rejection does not propagate out of runSendLoop and kill the
     * background loop for the rest of the session.
     */
    return;
  }
  for (const file of files) {
    if (ctx.signal.aborted) return;
    const ok = await shipOneBatch(ctx, file.path);
    if (!ok) return;
  }
}

/**
 * Load a single `.kwub`, POST it to `/in`, delete on 2xx. A corrupted
 * file (loadBatch returns null) is treated as already-shipped: it is
 * deleted so the loop does not retry it forever. Network errors and
 * AbortError / TimeoutError leave the file on disk for the next pass.
 *
 * Every storage operation is wrapped in `try / catch` so a transient
 * read / write failure cannot escape this function and reject the
 * outer `runSendLoop` (which would kill the background sender for
 * the rest of the session).
 *
 * The K-Tester header value is read live from the dispatcher's
 * `pendingTestUserName` so a `markAsTestUser` call between ships
 * takes effect on the next batch.
 *
 * @returns `true` when the batch has been delivered or pruned (the
 *   pass can keep going); `false` when the POST failed and the file
 *   stays on disk for retry (the caller should stop the pass to
 *   avoid burning HTTP budget against a server that is down).
 */
async function shipOneBatch(ctx: LoopContext, path: string): Promise<boolean> {
  let record;
  try {
    record = await loadBatch({ storage: ctx.storage, path });
  } catch {
    /** Read failure is transient; leave the file on disk for next iteration. */
    return false;
  }
  if (record === null) {
    try {
      await deleteBatch({ storage: ctx.storage, path });
    } catch {
      /**
       * Corrupted file we could not delete - the next iteration will
       * see it again and either succeed (transient I/O) or eventually
       * `reduceStorageSize` tombstones the directory. Returning true
       * lets the rest of the pass continue.
       */
    }
    return true;
  }
  /**
   * Privacy race regression: `runShipPass` decides whether to ship
   * once per iteration based on consent read at the top of the loop
   * body. The pass then iterates the file list and calls this helper
   * for each batch. A user revoke between the top-of-iteration read
   * and the next sendBatch used to be invisible - already-listed
   * batches still POSTed. Re-check consent right before each send so
   * a revoke mid-pass stops delivery immediately. We also re-check
   * the abort signal in case shutdown raced the same window.
   */
  if (ctx.signal.aborted || readConsentSafely(ctx) !== 'send') {
    return false;
  }
  let ok = false;
  try {
    ok = await sendBatch({
      baseUrl: ctx.endpoint,
      apiKey: ctx.apiKey,
      batch: {
        installId: ctx.installId,
        userId: record.userId,
        dataSessionId: record.dataSessionId,
        batchNum: record.batchNum,
        batchStartTime: record.batchStartTime,
        batchEndTime: record.batchEndTime,
        batchVersion: record.batchVersion,
        customEventsVersion: record.customEventsVersion,
        data: record.data,
      },
      testUser: ctx.dispatcher.pendingTestUserName,
      signal: ctx.signal,
      extraHeaders: ctx.extraHeaders,
    });
  } catch {
    /**
     * AbortError / TimeoutError re-raised by sendBatch land here.
     * The batch stays on disk so the next loop iteration retries it
     * once the abort / timeout window has cleared.
     */
  }
  if (ok) {
    try {
      await deleteBatch({ storage: ctx.storage, path });
    } catch {
      /**
       * Server already accepted this batch but the delete failed.
       * Leaving the file intact would re-deliver it on the next ship
       * pass (loadBatch succeeds -> sendBatch fires -> server-side
       * duplicate). Quarantine the file by overwriting it with zero
       * bytes: next iteration's loadBatch sees an empty payload,
       * decodeBatch returns null, shipOneBatch routes through the
       * "corrupted / unreadable" branch (deletes the file, no POST).
       * reduceStorageSize will eventually clean it up if the next
       * delete also fails. If the quarantine write ALSO fails the
       * storage is catastrophically broken; stop the pass so the
       * loop's idle backoff kicks in instead of hammering the broken
       * adapter against the rest of the batch list.
       */
      try {
        await ctx.storage.writeFile({ path, bytes: new Uint8Array(0) });
      } catch {
        return false;
      }
    }
  }
  return ok;
}

/**
 * Race the dispatcher's idle timer against the abort signal. Returns
 * as soon as either resolves: a dispatcher signal (new events arrived
 * or threshold crossed), an abort (shutdown), or the idle timeout.
 *
 * Always detaches the abort listener at the end of the race (not just
 * via `{ once: true }`); otherwise a dispatcher-wins iteration would
 * leak the listener until shutdown.
 */
async function waitForSignalOrTimeout({
  dispatcher,
  idleMs,
  signal,
}: WaitForSignalOrTimeoutArgs): Promise<void> {
  /**
   * Swallow a rejection from `waitForSignal`. A throw there would
   * otherwise lose the abort race in `Promise.race`, escape
   * `waitForSignalOrTimeout`, reject `runSendLoop`, and stop the
   * background sender permanently. On the failure path we still
   * sleep `idleMs` so a persistently-failing dispatcher does not
   * collapse the iteration cadence into a tight CPU/battery spin -
   * the loop degrades into retry-after-delay instead of hot retry.
   *
   * The backoff Promise settles on EITHER the timer firing OR the
   * abort signal; without the abort-resolves path the inner
   * Promise would hold the async function frame open even after
   * the outer race exits via `abortWait`, leaking the frame until
   * GC. Both branches dispose of the other (`clearTimeout` +
   * `removeEventListener`) so neither survives the resolve.
   */
  let backoffTimer: ReturnType<typeof setTimeout> | null = null;
  const dispatcherWait = (async (): Promise<void> => {
    try {
      await dispatcher.waitForSignal({ timeoutMs: idleMs });
    } catch {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        const onBackoffAbort = (): void => {
          if (backoffTimer !== null) {
            clearTimeout(backoffTimer);
            backoffTimer = null;
          }
          resolve();
        };
        backoffTimer = setTimeout(() => {
          signal.removeEventListener('abort', onBackoffAbort);
          backoffTimer = null;
          resolve();
        }, idleMs);
        signal.addEventListener('abort', onBackoffAbort, { once: true });
      });
    }
  })();
  let onAbort: (() => void) | null = null;
  const abortWait = new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    onAbort = (): void => {
      resolve();
    };
    signal.addEventListener('abort', onAbort);
  });
  try {
    await Promise.race([dispatcherWait, abortWait]);
  } finally {
    if (backoffTimer !== null) {
      clearTimeout(backoffTimer);
    }
    if (onAbort !== null) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

export type { PersistAccumulatedBatchArgs, RunSendLoopArgs } from './types/sendLoop';
export { persistAccumulatedBatch, runSendLoop };
