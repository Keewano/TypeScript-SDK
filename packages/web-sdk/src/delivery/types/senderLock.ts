/**
 * Contracts for the single-sender election.
 */

/**
 * Structural slice of the Web Locks manager the election needs.
 *
 * request - Acquire `name` exclusively and hold it for the callback's
 *   lifetime; `signal` cancels a still-pending request.
 */
interface LockManagerLike {
  request(
    name: string,
    options: { mode: 'exclusive'; signal?: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<void>;
}

/**
 * Arguments of `runAsSingleSender`.
 *
 * runLoop - Starts the send loop; must honor `signal` internally so
 *   releasing the role on shutdown ends the loop and frees the lock.
 * runWhileQueued - Optional loop for a tab that is waiting for the
 *   role (the persist-only tick). Started before the request, stopped
 *   and awaited before `runLoop` takes over, and ended by the `signal`
 *   it is handed. Absent means a queued tab does nothing but wait.
 * signal - Shutdown signal; cancels a pending lock request and stops
 *   a running loop.
 * locks - Injection seam for tests; defaults to `navigator.locks`.
 */
interface RunAsSingleSenderArgs {
  runLoop: () => Promise<void>;
  runWhileQueued?: (args: QueuedLoopArgs) => Promise<void>;
  signal: AbortSignal;
  locks?: LockManagerLike;
}

/**
 * Arguments handed to `runWhileQueued`.
 *
 * signal - Ends the queued loop: this tab was elected, or the session
 *   is shutting down.
 */
interface QueuedLoopArgs {
  signal: AbortSignal;
}

/**
 * Handle on the running `runWhileQueued` loop.
 *
 * stop - Aborts the loop and resolves once it has exited; idempotent.
 */
interface QueuedLoop {
  stop: () => Promise<void>;
}

export type { LockManagerLike, QueuedLoop, QueuedLoopArgs, RunAsSingleSenderArgs };
