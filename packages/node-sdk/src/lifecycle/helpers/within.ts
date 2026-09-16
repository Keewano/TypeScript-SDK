/**
 * Put a ceiling on a wait that has no cancellation of its own.
 *
 * Teardown is the one sequence a host cannot retry: a `shutdown()` that
 * never returns takes the process's exit with it, and a container
 * runtime answers that with SIGKILL. Every wait on the way out is
 * therefore bounded, including the ones whose underlying work cannot be
 * cancelled - a `StorageAdapter` call has no abort in its contract, and
 * a send loop parked inside one cannot observe its own abort signal
 * until that call answers.
 */

/** Longest delay `setTimeout` honours before it wraps to immediate. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Resolve with `work`'s value, or `null` if `ms` elapses first.
 *
 * The loser is abandoned, not cancelled: the work may still be in
 * flight when this returns. That is the point - the caller gets its
 * deadline back instead of inheriting the latency underneath.
 *
 * @param work - The promise to bound.
 * @param ms - How long to allow, in milliseconds.
 * @returns The resolved value, or `null` on expiry.
 */
async function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  /**
   * No time allowed means no time allowed. Racing a `setTimeout(0)`
   * instead would hand the win to any promise that has already settled,
   * because a resolved promise continues on a microtask and the timer
   * only fires on the next macrotask - so a zero budget would sometimes
   * wait and sometimes not, depending on what the work happened to be
   * doing. Every caller today guards this before calling; the helper
   * should not depend on that.
   */
  if (ms <= 0) return null;
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<null>((resolve) => {
    /**
     * Clamped: a delay past the 32-bit timer range does not wait longer,
     * it fires on the next tick, turning a generous ceiling into no
     * ceiling at all.
     */
    timer = setTimeout(() => resolve(null), Math.min(ms, MAX_TIMER_MS));
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export { MAX_TIMER_MS, within };
