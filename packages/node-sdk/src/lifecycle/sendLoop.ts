/**
 * Background send-loop start. Wires the runtime's storage / dispatcher /
 * batch-number state into the core `runSendLoop` and stashes the resulting
 * promise on the runtime so shutdown can await it.
 *
 * Relay specifics: the loop ships with `runtime.installId` set to the
 * project id from the API key (the backend requires a non-zero install
 * id), and consent is pinned to `NotRequired` so the gate always permits
 * the send (the server does not gate on end-user consent).
 */

import type { NodeRuntime } from '../types/runtime';

import { ConsentState, runSendLoop } from '@keewano/core';

import { allocBatchNum } from '../runtime';
import { BATCHES_DIR } from './helpers/constants';
import { notifyPass } from './helpers/passTicker';

/**
 * Build and start the send loop against `runtime`. The loop's helpers
 * wrap every storage / HTTP call, so the `.catch` is a defensive net
 * rather than an expected path.
 */
function startSendLoop(runtime: NodeRuntime): void {
  runtime.sendLoopPromise = runSendLoop({
    storage: runtime.storage,
    dispatcher: runtime.dispatcher,
    endpoint: runtime.endpoint,
    apiKey: runtime.config.apiKey,
    installId: runtime.installId,
    getConsent: () => ConsentState.NotRequired,
    getNextBatchNum: () => allocBatchNum(runtime),
    signal: runtime.sendLoopAbort.signal,
    batchesDir: BATCHES_DIR,
    /**
     * Every boundary, not only a completed ship pass: the drain gives up
     * on a queue that could not ship rather than waiting out its grace.
     * The depth comes from disk. See passTicker.
     */
    onPassEnd: () => {
      notifyPass(runtime);
    },
    ...(runtime.customEventSet === undefined ? {} : { customEventSet: runtime.customEventSet }),
    ...(runtime.config.getExtraHeaders === undefined
      ? {}
      : { getExtraHeaders: runtime.config.getExtraHeaders }),
  }).catch(() => {
    /** Defensive; loop body already catches every expected throw. */
  });
}

export { startSendLoop };
