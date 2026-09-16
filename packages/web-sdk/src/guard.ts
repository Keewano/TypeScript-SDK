/**
 * Facade error containment: on the web the SDK is a guest inside the
 * host page, so no `Keewano.*` call may ever throw (or reject) into
 * host code - an analytics bug must not break checkout. Every public
 * method is wrapped here; failures are logged via `console.error`
 * and swallowed at the boundary.
 */

import type { GuardAsyncArgs, GuardSyncArgs } from './types/guard';

/** Wrap a synchronous facade method; a throw is logged, not propagated. */
function guardSync<A extends unknown[]>({ name, fn }: GuardSyncArgs<A>): (...args: A) => void {
  return (...args: A): void => {
    try {
      fn(...args);
    } catch (err: unknown) {
      console.error(`Keewano.${name}: suppressed error.`, err);
    }
  };
}

/**
 * Wrap an async facade method; both a synchronous throw and a
 * rejection are logged and the returned promise always resolves.
 */
function guardAsync<A extends unknown[]>({
  name,
  fn,
}: GuardAsyncArgs<A>): (...args: A) => Promise<void> {
  return async (...args: A): Promise<void> => {
    try {
      await fn(...args);
    } catch (err: unknown) {
      console.error(`Keewano.${name}: suppressed error.`, err);
    }
  };
}

export { guardAsync, guardSync };
