/**
 * A signal that the send loop reached a pass boundary.
 *
 * The exit drain needs to know when to look at the queue again, and the
 * loop announces every boundary through `onPassEnd`: after a pass that
 * shipped, and after one that could not - consent pending, custom-event
 * registration refused, the queue unreadable. `onShipPass` would not do.
 * It fires only when a pass completed, so a registration endpoint down
 * at exit left the drain waiting its whole grace for a tick that never
 * came, over a queue that could not have shipped. What it carries
 * alongside - how many files the pass left - could not be used either:
 * the guard behind that number watches the loop's own dispatcher, while
 * the relay seals every user batch with a fresh one, so the count can
 * read zero over a non-empty directory. Hence a bare tick, and the depth
 * read from disk.
 *
 * Per runtime rather than global: two runtimes never coexist today, and
 * a module-level waiter would silently pair the wrong loop with the
 * wrong drain the day one does.
 */

import type { NodeRuntime } from '../../types/runtime';

/** Resolvers waiting for the next pass boundary, by runtime. */
const waiters = new WeakMap<NodeRuntime, Set<() => void>>();

/** Wake everyone waiting on `runtime`; called from the loop's pass hook. */
function notifyPass(runtime: NodeRuntime): void {
  const pending = waiters.get(runtime);
  if (pending === undefined) return;
  waiters.delete(runtime);
  for (const resolve of pending) resolve();
}

/**
 * Resolve at the next pass boundary.
 *
 * @returns A promise and the `cancel` that unregisters it. The caller
 *   races this against a deadline and must cancel the loser, or a
 *   resolver outlives the drain that created it.
 */
function waitForPass(runtime: NodeRuntime): { passed: Promise<void>; cancel: () => void } {
  let resolve = (): void => {};
  const passed = new Promise<void>((settle) => {
    resolve = settle;
  });
  const pending = waiters.get(runtime) ?? new Set<() => void>();
  pending.add(resolve);
  waiters.set(runtime, pending);
  return {
    passed,
    cancel: () => {
      const current = waiters.get(runtime);
      if (current === undefined) return;
      current.delete(resolve);
      if (current.size === 0) waiters.delete(runtime);
    },
  };
}

export { notifyPass, waitForPass };
