/**
 * Persist tick for a tab that does not hold the sender election.
 *
 * One tab per origin ships, but every tab accumulates events. A tab
 * that only queued on the sender lock would hold its whole session in
 * RAM until an exit trigger fired - and a crash, an OOM kill, or a
 * browser that skips `pagehide` takes all of it. This loop gives such
 * a tab the send loop's cadence (the dispatcher's threshold wake,
 * otherwise the idle window) with only the persist step.
 *
 * What stays with the elected tab, deliberately:
 *   - the ship pass and the deletes that follow it;
 *   - the Denied purge of the on-disk queue;
 *   - the disk-cap sweep, which rewrites and deletes files another tab
 *     may be shipping at that instant. It already runs for the whole
 *     origin on the elected tab's cadence, so running it here would
 *     only multiply that race.
 *
 * In-memory events are still dropped here on a withdrawal: post-revoke
 * reports would otherwise grow the in-batch of this tab without bound,
 * and nothing else in an unelected tab clears it.
 */

import type { RunPersistLoopArgs } from './types/persistLoop';

import {
  DEFAULT_IDLE_MS,
  consentGate,
  dropInMemoryBatches,
  waitForSignalOrTimeout,
} from '@keewano/core';

import { persistQueuedBatches } from './batchQueue';

async function runPersistLoop(args: RunPersistLoopArgs): Promise<void> {
  const { runtime, signal } = args;
  const idleMs = args.idleMs ?? DEFAULT_IDLE_MS;
  try {
    while (!signal.aborted) {
      await waitForSignalOrTimeout({ dispatcher: runtime.dispatcher, idleMs, signal });
      if (signal.aborted) return;
      if (consentGate(runtime.consentState) === 'delete') {
        dropInMemoryBatches({ dispatcher: runtime.dispatcher });
        continue;
      }
      try {
        await persistQueuedBatches({ runtime });
      } catch {
        /** Best-effort; the next tick retries against a fresh swap. */
      }
    }
  } finally {
    /**
     * The dispatcher holds a single wait slot and rejects a second
     * waiter. Handing it back is what lets the send loop park on it
     * the moment this tab is elected.
     */
    runtime.dispatcher.cancelPendingWait();
  }
}

export { runPersistLoop };
