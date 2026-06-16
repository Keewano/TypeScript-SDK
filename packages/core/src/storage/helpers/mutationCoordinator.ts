/**
 * Per-key serialization queue for stateful mutations. Adapters use one
 * instance per `StorageAdapter` so concurrent `writeFile` / `deleteFile`
 * calls against the same logical path chain off the most recently
 * scheduled operation. This protects scratch sibling lifecycle (a
 * delete cannot observe the destination as briefly missing during a
 * write's backup-then-tmp swap) AND prevents two writes from stomping
 * each other's tmp/backup files.
 *
 * The chain map deletes its own entry in `finally` when the current
 * promise is still the most recent one, so a long-lived adapter does
 * not accumulate stale entries for paths that are no longer being
 * mutated.
 *
 * @example
 * ```ts
 * const mutations = new MutationCoordinator();
 * await mutations.run({
 *   key: fullPath,
 *   op: () => writeBytes(fullPath, bytes),
 * });
 * ```
 */

import type { MutationCoordinatorRunArgs } from '../types/mutationCoordinator';

class MutationCoordinator {
  private readonly chains = new Map<string, Promise<unknown>>();

  /**
   * Run `op` after every previously scheduled operation for the same
   * `key` has settled. The previous operation's rejection is swallowed
   * before scheduling so a failed prior call does not poison the
   * chain - any rejection from `op` itself surfaces to the caller as
   * the returned promise's rejection.
   *
   * @param args - The serialization key and the operation to run.
   * @returns The result of `op`.
   */
  async run<T>({ key, op }: MutationCoordinatorRunArgs<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const chain = previous.catch(() => undefined).then(op);
    this.chains.set(key, chain);
    try {
      return await chain;
    } finally {
      if (this.chains.get(key) === chain) {
        this.chains.delete(key);
      }
    }
  }
}

export { MutationCoordinator };
