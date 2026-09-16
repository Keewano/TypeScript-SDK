/**
 * Boot sequence for the Node relay SDK. `init` is the public entry
 * (guarded, idempotent); `startInit` resolves dependencies, generates the
 * session identifiers, builds the inert dispatcher + runtime, and starts
 * the send loop.
 *
 * Relay mode carries no self-telemetry: no persisted install identity, no
 * consent gate, no environment burst, no crash observer. APP_LAUNCH is
 * part of that burst and stays out with it: it opens a session for an
 * app instance, and the relay is not one - its install id is the
 * project, its user id the no-user marker, and one session id covers
 * every batch it ships for every user. Emitted per process it would
 * open a session for nobody; emitted per batch it would open the same
 * session again on every report of every user. All user-facing events
 * arrive later through `Keewano.reportUserBatch`. Boot's only
 * async step is one read of the batches directory to seed the batchNum
 * counter past whatever a prior run left behind; `init` resolves once
 * the runtime is installed and the send loop is running.
 */

import type { NodeKeewanoConfig } from '../types/config';

import {
  KEEWANO_DEFAULT_BASE_URL,
  configureSdkPlatform,
  hasControlChar,
  isByteString,
  uuidToBytes,
  newUuid,
  seedNextBatchNum,
} from '@keewano/core';

import {
  clearRuntime,
  getInitPromise,
  isInitialized,
  isInitializing,
  setInitPromise,
  setRuntime,
} from '../runtime';
import { NodeStorageAdapter } from '../storage';
import { buildDispatcher, buildRuntime } from './build';
import { BATCHES_DIR } from './helpers/constants';
import { resolveInstallId } from './helpers/installId';
import { serializeLifecycle } from './helpers/serialize';
import { resolveShutdownGraceMs } from './helpers/shutdownGrace';
import { startSendLoop } from './sendLoop';

/** UUID byte length, for the all-zero userId marker. */
const UUID_BYTE_LENGTH = 16;

/**
 * Boot the SDK. Resolves once the runtime is installed and the send loop
 * has started. Re-init (or an init racing an in-flight init) logs a
 * warning and no-ops; an empty or malformed `apiKey` (surrounding
 * whitespace, control characters, non-ByteString characters)
 * short-circuits with `console.error` so the loop never starts on a
 * misconfiguration.
 */
async function init(config: NodeKeewanoConfig): Promise<void> {
  /**
   * Queued on the same chain as teardown, so an init racing a
   * shutdown runs after it rather than during: the checks below would
   * otherwise see a runtime the teardown is about to clear, take the
   * already-initialized branch, and leave the SDK dead with a call
   * that resolved as if it had started.
   */
  return serializeLifecycle(() => startInitOnce(config));
}

/** The boot decision itself, once nothing else is mutating the lifecycle. */
async function startInitOnce(config: NodeKeewanoConfig): Promise<void> {
  if (isInitialized() || isInitializing()) {
    console.warn('Keewano.init: SDK is already initialized; ignoring re-init.');
    /**
     * Join an in-flight boot so this call's resolution still means
     * "the SDK is ready": without the join, a caller awaiting the
     * second of two concurrent inits could report before the runtime
     * lands and hit "SDK not initialized".
     */
    const pending = getInitPromise();
    if (pending !== null) await pending;
    return;
  }
  if (typeof config.apiKey !== 'string' || config.apiKey.trim().length === 0) {
    console.error('Keewano.init: apiKey is empty; SDK will not start the send loop.');
    return;
  }
  /**
   * Reject a malformed apiKey at the boundary instead of letting the
   * send loop discover it: the key travels as the `K-Token` HTTP
   * header, and surrounding whitespace, ASCII control characters, or
   * non-ByteString characters fail the transport's header-value check
   * on every ship attempt, permanently stalling delivery while
   * batches pile up on disk.
   */
  if (
    config.apiKey !== config.apiKey.trim() ||
    hasControlChar(config.apiKey) ||
    !isByteString(config.apiKey)
  ) {
    console.error('Keewano.init: invalid apiKey; SDK will not start the send loop.');
    return;
  }
  /**
   * Register the in-flight boot promise BEFORE awaiting it: the batchNum
   * seeding awaits disk I/O, and without the latch a concurrent second
   * `init` would pass the guards above and boot a duplicate send loop
   * whose runtime overwrites (and leaks) the first.
   */
  const boot = startInit(config);
  setInitPromise(boot);
  try {
    await boot;
  } catch (error: unknown) {
    /**
     * Reset the init latch so a failed boot does not brick the SDK: the
     * runtime never landed, so `clearRuntime` only clears the pending
     * init promise (and the empty pre-init queue) and re-init can retry.
     */
    clearRuntime();
    throw error;
  }
}

/**
 * Internal boot sequence: resolve storage / endpoint, generate the session
 * identifiers, build the inert dispatcher and runtime, seed the batchNum
 * counter from disk, and start the send loop last so a throw never leaks
 * a running loop.
 */
async function startInit(config: NodeKeewanoConfig): Promise<void> {
  /** Tag every outbound request as Node so the server does not read it as React Native. */
  configureSdkPlatform('Node');
  /**
   * The type union already rules this out; the check is for a
   * JavaScript host, which would otherwise reach the adapter's own
   * throw with nothing naming the config field that is missing.
   */
  if (config.storage === undefined && config.dataDir === undefined) {
    throw new Error('Keewano.init: pass dataDir or storage');
  }
  const storage = config.storage ?? new NodeStorageAdapter({ dataDir: config.dataDir as string });
  const endpoint = config.endpoint ?? KEEWANO_DEFAULT_BASE_URL;
  /**
   * `installId` identifies the relay to the backend, which requires a
   * non-zero value. It is the project id from the API-key JWT (or the
   * `installId` override) - a relay has no per-device id. `userId` is the
   * all-zero "no user" marker: the inert dispatcher never attributes a
   * batch (per-user batches carry their own id). Only `dataSessionId` is
   * real: one per init, shared by every batch this process ships.
   */
  const installId = resolveInstallId(config);
  const userId = new Uint8Array(UUID_BYTE_LENGTH);
  const dataSessionId = uuidToBytes(newUuid());
  const dispatcher = buildDispatcher({
    installId,
    userId,
    dataSessionId,
    customEventSet: config.customEventSet,
  });
  const runtime = buildRuntime({
    config,
    endpoint,
    shutdownGraceMs: resolveShutdownGraceMs(config.shutdownGraceMs),
    storage,
    dispatcher,
    installId,
    userId,
    dataSessionId,
  });
  /**
   * Seed the batchNum counter past whatever a prior run of this dataDir
   * left on disk. Restarting at 0 would reuse batchNums that unsent
   * `.kwub` files still carry: a new batch sealed in the same second
   * overwrites one of them and the backend sees duplicate numbers. The
   * seed read happens BEFORE the runtime is installed and the loop
   * starts, so no allocation can race it.
   */
  runtime.nextBatchNum = await seedNextBatchNum({ storage, dir: BATCHES_DIR });
  setRuntime(runtime);
  startSendLoop(runtime);
  /**
   * Reclaim what a killed process staged and never renamed. Those files
   * are hidden from the batch listing, so nothing else would ever find
   * them - not even the disk cap whose job is to free space.
   *
   * Started after the SDK is up and deliberately not awaited: this frees
   * space, and freeing space is never worth holding a host's startup on
   * a filesystem that has stopped answering. The seed read above IS
   * awaited, because a counter that has not been read yet would restart
   * numbering and overwrite the batches it was meant to skip - so a
   * storage layer that hangs still stops `init`, just not for this.
   *
   * Nothing races: the sweep only removes scratch files older than an
   * hour, which no write in flight can be.
   */
  if (storage instanceof NodeStorageAdapter) {
    storage.sweepOrphanedScratchFiles({ dir: BATCHES_DIR }).catch((err: unknown) => {
      console.error('Keewano.init: reclaiming abandoned scratch files failed.', err);
    });
  }
}

export { init };
