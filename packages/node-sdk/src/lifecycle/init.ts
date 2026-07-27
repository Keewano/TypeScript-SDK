/**
 * Boot sequence for the Node relay SDK. `init` is the public entry
 * (guarded, idempotent); `startInit` resolves dependencies, generates the
 * session identifiers, builds the inert dispatcher + runtime, and starts
 * the send loop.
 *
 * Relay mode carries no self-telemetry: no persisted install identity, no
 * consent gate, no environment burst, no crash observer. All user-facing
 * events arrive later through `Keewano.reportUserBatch`. Boot's only
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
import { resolveInstallId } from './helpers/installId';
import { seedNextBatchNum } from './helpers/seedBatchNum';
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
  const storage =
    config.storage ??
    new NodeStorageAdapter(config.dataDir === undefined ? {} : { dataDir: config.dataDir });
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
  runtime.nextBatchNum = await seedNextBatchNum(storage);
  setRuntime(runtime);
  startSendLoop(runtime);
}

export { init };
