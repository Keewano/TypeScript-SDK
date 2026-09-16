/**
 * Single-sender election: two tabs sharing the origin queue would
 * otherwise both run the send loop, double-shipping every batch and
 * racing each other's deletes. The tab that acquires the exclusive
 * Web Lock runs the loop; the others queue on the lock and take over
 * delivery the moment the holder releases it - including when the
 * holding tab is killed, because the browser frees its locks
 * automatically.
 *
 * Losing the election only parks the SHIPPING half. A queued tab runs
 * `runWhileQueued` for as long as it waits (the persist-only loop), so
 * its events reach the queue on the same cadence instead of living in
 * RAM until the page dies. Exactly one of the two runs at a time: the
 * queued loop is stopped and awaited before the elected loop starts,
 * because both park on the dispatcher's single wait slot.
 *
 * Where the election cannot be held the loop simply runs (the
 * pre-election status quo): no Web Locks API at all, or a `request`
 * that refuses - a storage-partitioned iframe and some WebViews reject
 * it outright, and losing delivery for the whole session is far worse
 * than the duplicates the election exists to avoid. Session-suffixed
 * filenames keep concurrent queues from corrupting each other, and the
 * server deduplicates a batch it receives twice.
 */
import type { LockManagerLike, QueuedLoop, RunAsSingleSenderArgs } from './types/senderLock';

import { probeGlobal } from '../probeGlobal';

/** One name per origin: whoever holds it is the origin's only shipper. */
const SENDER_LOCK_NAME = 'keewano.sender';

async function runAsSingleSender(args: RunAsSingleSenderArgs): Promise<void> {
  const locks =
    args.locks ??
    probeGlobal<LockManagerLike>({ path: ['navigator', 'locks'], methods: ['request'] });
  /** Nothing to queue behind without an election, so this tab is the sender outright. */
  if (locks === null) return args.runLoop();
  const queued = startQueuedLoop(args);
  let started = false;
  try {
    await locks.request(SENDER_LOCK_NAME, { mode: 'exclusive', signal: args.signal }, async () => {
      started = true;
      await queued.stop();
      await args.runLoop();
    });
  } catch (err: unknown) {
    /**
     * Once the callback has started the lock is held (the signal no
     * longer applies), so any failure there is a real sender death and
     * must propagate to the session-death log. Before that, a rejection
     * is either our own shutdown cancelling a still-queued request, or
     * an environment that refuses the lock - which must not cost the
     * session its delivery.
     */
    if (started) throw err;
    if (args.signal.aborted) return;
    console.warn('Keewano: sender election unavailable; this tab delivers on its own.', err);
    await queued.stop();
    await args.runLoop();
  } finally {
    await queued.stop();
  }
}

/**
 * Start the caller's queued-tab loop, if any, under a controller this
 * module owns: it must end both when the tab is elected and when the
 * session shuts down, and a shutdown reaches us only through the lock
 * request's rejection - which a non-conforming implementation may
 * never deliver.
 */
function startQueuedLoop(args: RunAsSingleSenderArgs): QueuedLoop {
  const runWhileQueued = args.runWhileQueued;
  if (runWhileQueued === undefined) {
    return { stop: () => Promise.resolve() };
  }
  const controller = new AbortController();
  const onSessionAbort = (): void => {
    controller.abort();
  };
  args.signal.addEventListener('abort', onSessionAbort, { once: true });
  /**
   * The loop is caller-supplied, and a callback that fails before it
   * returns a promise would otherwise skip the handling below and take
   * the whole election with it. An async frame converts that into a
   * rejection; it is entered synchronously, so the loop still starts
   * before the lock request as the contract requires. Deferring the
   * call instead - by a microtask or otherwise - would hand the loop an
   * already-aborted signal whenever the lock is granted uncontended,
   * and a loop that waits on that signal would never resolve.
   */
  const promise = (async () => runWhileQueued({ signal: controller.signal }))().catch(
    (err: unknown) => {
      console.error('Keewano: queued-tab persist loop crashed; events stay in memory.', err);
    },
  );
  /** Idempotent: every exit path stops it, and the elected path has already done so. */
  return {
    stop: async (): Promise<void> => {
      controller.abort();
      args.signal.removeEventListener('abort', onSessionAbort);
      await promise;
    },
  };
}

export { SENDER_LOCK_NAME, runAsSingleSender };
