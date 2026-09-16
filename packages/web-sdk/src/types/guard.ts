/** Args types for the facade error-containment wrappers. */

/**
 * name - Public method name, embedded in the suppression log.
 * fn - Synchronous implementation to wrap.
 */
interface GuardSyncArgs<A extends unknown[]> {
  name: string;
  fn: (...args: A) => void;
}

/**
 * name - Public method name, embedded in the suppression log.
 * fn - Async implementation to wrap; both sync throws and rejections
 *   are contained.
 */
interface GuardAsyncArgs<A extends unknown[]> {
  name: string;
  fn: (...args: A) => Promise<void>;
}

export type { GuardAsyncArgs, GuardSyncArgs };
