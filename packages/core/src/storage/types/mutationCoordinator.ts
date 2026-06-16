/**
 * Arguments accepted by {@link MutationCoordinator}#run.
 *
 * key - Serialization key (typically the resolved on-disk path / URI).
 *   Two operations sharing the same key run sequentially; operations
 *   under different keys are independent.
 * op - The operation to run after every previously scheduled
 *   operation for the same key has settled. The previous failure is
 *   swallowed before `op` is invoked.
 */
interface MutationCoordinatorRunArgs<T> {
  key: string;
  op: () => Promise<T>;
}

export type { MutationCoordinatorRunArgs };
