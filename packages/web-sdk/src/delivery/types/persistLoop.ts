/**
 * Contracts for the persist-only loop.
 */

import type { WebSdkRuntime } from '../../types/runtime';

/**
 * Arguments of `runPersistLoop`.
 *
 * runtime - Session whose dispatcher this loop drains to the queue.
 * signal - Ends the loop: shutdown, or this tab winning the sender
 *   election and taking over the full send loop.
 * idleMs - Idle window between ticks when no wake signal arrives.
 *   Defaults to the send loop's own 30 s cadence.
 */
interface RunPersistLoopArgs {
  runtime: WebSdkRuntime;
  signal: AbortSignal;
  idleMs?: number;
}

export type { RunPersistLoopArgs };
