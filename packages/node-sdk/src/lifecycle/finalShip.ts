/**
 * The last chance the queue gets to leave.
 *
 * Reporting is not delivery: `reportUserBatch` resolves once the batch
 * is on disk, and the loop ships on its own cadence. A long-lived server
 * never notices, because the loop outlives every batch. A script, a cron
 * job or a serverless invocation calls `shutdown()` right after
 * reporting, and there is no next launch to sweep what is left - so the
 * one documented exit call is what destroys the data.
 *
 * This drains the LIVE loop rather than shipping alongside it. Two
 * shippers over one directory post every batch twice, so a second path
 * is not an option: the drain only wakes the loop and waits on its pass
 * boundaries.
 *
 * It watches the batches it found at the start, by name, and stops when
 * none of them left during a round. Watching the file COUNT instead
 * reads a host that keeps reporting through teardown as a server that
 * has stopped accepting, because the directory does not shrink either
 * way. Files created after the drain began are the next run's work.
 *
 * Nothing here can outlast the grace: the pass wait and every read of
 * the queue are bounded by the deadline, so a storage layer that stalls
 * - a hung network mount, an adapter that never resolves - ends the
 * drain instead of hanging the process on the way out.
 */

import type { NodeRuntime } from '../types/runtime';

import { listBatches } from '@keewano/core';

import { BATCHES_DIR } from './helpers/constants';
import { waitForPass } from './helpers/passTicker';
import { within } from './helpers/within';

/**
 * The batch files present right now, as a set of names.
 *
 * @returns The names, or `null` when the directory cannot be read or
 *   the read outlived `deadline` - both mean the drain has to stop,
 *   because a queue nobody can measure cannot be watched for progress.
 */
async function queuedNames(runtime: NodeRuntime, deadline: number): Promise<Set<string> | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;
  try {
    const listed = await within(
      listBatches({ storage: runtime.storage, dir: BATCHES_DIR }),
      remaining,
    );
    return listed === null ? null : new Set(listed.map((batch) => batch.path));
  } catch {
    return null;
  }
}

/**
 * Ship what is queued, within `graceMs`.
 *
 * Returns when every batch it started with is gone, when a round takes
 * none of them (a refused or unreachable server, or a loop that is not
 * shipping), when the queue becomes unreadable, or at the deadline. A
 * grace of 0 returns immediately, which is the behaviour that shipped
 * before this existed.
 */
async function shipQueuedBeforeExit(runtime: NodeRuntime, graceMs: number): Promise<void> {
  if (graceMs <= 0) return;
  const deadline = Date.now() + graceMs;
  let pending = await queuedNames(runtime, deadline);
  while (pending !== null && pending.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    const { passed, cancel } = waitForPass(runtime);
    runtime.dispatcher.signalSend();
    try {
      /**
       * The whole remaining grace, deliberately. Capping a round at a
       * fixed slice looks like it only cuts short a loop that is parked
       * and never going to announce a pass, but a pass is announced
       * when the ship COMPLETES - so any endpoint slower than the slice
       * is cut off too, and the grace the host configured stops meaning
       * anything. A parked loop costs the grace; that is the price of
       * not abandoning a slow one.
       */
      await within(passed, remaining);
    } finally {
      cancel();
    }
    const present = await queuedNames(runtime, deadline);
    if (present === null) return;
    const survivors = new Set([...pending].filter((name) => present.has(name)));
    /** Nothing of ours left this round: another is not going to help. */
    if (survivors.size === pending.size) return;
    pending = survivors;
  }
}

export { shipQueuedBeforeExit };
