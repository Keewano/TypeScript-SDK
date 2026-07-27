/**
 * Relay reporting for a server that sends telemetry on behalf of many end
 * users from a single process. `reportUserBatch` ships ONE batch tagged
 * with the given user's `K-Uid`, containing exactly the events emitted
 * inside `build` and NO in-stream `USER_ID_ASSIGNED` marker (the user is
 * fixed for the whole batch), so the server attributes the batch by its
 * batch-level user id alone.
 *
 * Mechanism: events accumulate on a dedicated, throwaway dispatcher whose
 * user id is fixed at construction. For the duration of the synchronous
 * `build`, the runtime's `dispatcher` and `onboardingCounters` are swapped
 * to per-batch instances so the shared `report*` functions (which read the
 * active runtime) land their events here and dedup onboarding milestones
 * within this one user's batch only. Both are restored before this
 * returns. The finished batch is persisted and the send loop is signalled
 * so it ships promptly rather than waiting out its idle timer.
 *
 * The reporter handed to `build` is guarded by a per-build token: each
 * `reportUserBatch` call mints a fresh token, builds a reporter bound to
 * it, and installs the token as the active one only while that `build`
 * call is on the stack. Every reporter method re-checks its captured
 * token against the active one, so a reporter used after `build` returns
 * (a captured reference, an `async` build that resumed past an `await`,
 * or a reporter from one build invoked inside ANOTHER user's build)
 * throws instead of silently writing into the wrong dispatcher.
 */

import type { ReportUserBatchArgs, UserReporter } from '../types/relay';

import {
  bigintToUuidBytes,
  uuidToBytes,
  logError,
  persistAccumulatedBatch,
  reportABTestGroupAssignment,
  reportAdItemsGranted,
  reportAdOffered,
  reportAdRevenue,
  reportCustomEvent,
  reportGameLanguage,
  reportInAppPurchase,
  reportInAppPurchaseItemsGranted,
  reportInstallCampaign,
  reportItemsExchange,
  reportItemsReset,
  reportOnboardingMilestone,
  reportSubscriptionItemsGranted,
  reportSubscriptionRevenue,
} from '@keewano/core';

import { allocBatchNum, getRuntime } from '../runtime';
import { buildDispatcher } from './build';
import { BATCHES_DIR } from './helpers/constants';

/**
 * Token of the currently-executing `build` window; `null` between builds.
 * A boolean gate is not enough here: a reporter captured in user A's
 * build and invoked synchronously inside user B's build would pass a
 * boolean check and write A's events into B's batch. Comparing the
 * reporter's own token against the active one rejects exactly that.
 */
let activeBuildToken: symbol | null = null;

/** `true` when `value` is a thenable (used to reject an async `build`). */
function isThenable(value: unknown): boolean {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Build the per-user emission surface for ONE `reportUserBatch` call.
 * Every method checks that the reporter's captured `token` is still the
 * active build token, then delegates to the shared core `report*`
 * function, which reads the active runtime that `reportUserBatch` has
 * swapped to the per-batch dispatcher. A reporter outlives its build only
 * as a dead handle: once the token is retired (or another build's token
 * is active), every method throws instead of emitting into a dispatcher
 * that belongs to nobody - or to somebody else.
 */
function createUserReporter(token: symbol): UserReporter {
  const guarded = <Args extends unknown[]>(
    fn: (...args: Args) => void,
  ): ((...args: Args) => void) => {
    return (...args: Args): void => {
      if (activeBuildToken !== token) {
        throw new Error('reportUserBatch: reporter used outside its build callback');
      }
      fn(...args);
    };
  };
  return {
    reportOnboardingMilestone: guarded(reportOnboardingMilestone),
    reportABTestGroupAssignment: guarded(reportABTestGroupAssignment),
    reportInAppPurchase: guarded(reportInAppPurchase),
    reportInAppPurchaseItemsGranted: guarded(reportInAppPurchaseItemsGranted),
    reportAdOffered: guarded(reportAdOffered),
    reportAdRevenue: guarded(reportAdRevenue),
    reportAdItemsGranted: guarded(reportAdItemsGranted),
    reportSubscriptionRevenue: guarded(reportSubscriptionRevenue),
    reportSubscriptionItemsGranted: guarded(reportSubscriptionItemsGranted),
    reportItemsExchange: guarded(reportItemsExchange),
    reportItemsReset: guarded(reportItemsReset),
    reportInstallCampaign: guarded(reportInstallCampaign),
    reportGameLanguage: guarded(reportGameLanguage),
    reportCustomEvent: guarded(reportCustomEvent),
    logError: guarded(logError),
  };
}

/**
 * Emit a self-contained, single-user batch. Resolves once the batch is
 * durably persisted (it ships on the next send-loop pass, woken
 * immediately); an empty `build` writes nothing and resolves.
 *
 * @param args - See {@link ReportUserBatchArgs}.
 * @throws TypeError when a string `userId` is not a valid UUID.
 * @throws RangeError when a bigint `userId` is negative or exceeds uint64.
 * @throws Error when `userId` resolves to the all-zero id (nothing may ship
 *   under the empty "no user" id), when `build` is not synchronous, or when
 *   the batch could not be persisted (a storage write failed, so the
 *   events of this call are NOT queued and the caller must not assume
 *   delivery). On a batch large enough to split into multiple slices, a
 *   mid-way failure may leave a leading subset already on disk - those
 *   slices WILL ship, so re-reporting the same events after a rejection
 *   can duplicate them on the server.
 */
async function reportUserBatch({ userId, build }: ReportUserBatchArgs): Promise<void> {
  const runtime = getRuntime();
  /**
   * Reject a nested call before touching runtime state. A reportUserBatch
   * invoked from inside another's `build` would otherwise restore the outer
   * dispatcher and retire the outer token in its own finally, corrupting
   * the outer build window.
   */
  if (activeBuildToken !== null) {
    throw new Error('reportUserBatch: nested call inside build');
  }
  const userIdBytes = typeof userId === 'bigint' ? bigintToUuidBytes(userId) : uuidToBytes(userId);
  if (userIdBytes.every((byte) => byte === 0)) {
    throw new Error('reportUserBatch: userId is the empty UUID');
  }
  const dispatcher = buildDispatcher({
    installId: runtime.installId,
    userId: userIdBytes,
    dataSessionId: runtime.dataSessionId,
    customEventSet: runtime.customEventSet,
  });
  /**
   * Swap the per-batch dispatcher and a fresh onboarding-counter map in for
   * the synchronous `build`, then restore. The fresh counter map scopes
   * onboarding-milestone dedup to this user's batch so two users' identical
   * milestones do not collide on the shared map. An async `build` is
   * rejected after restore (its post-`await` reporter calls would already
   * be gated off by the retired build token).
   */
  const sharedDispatcher = runtime.dispatcher;
  const sharedCounters = runtime.onboardingCounters;
  runtime.dispatcher = dispatcher;
  runtime.onboardingCounters = new Map<string, number>();
  const buildToken = Symbol('reportUserBatch build');
  activeBuildToken = buildToken;
  let buildResult: unknown;
  try {
    buildResult = build(createUserReporter(buildToken));
  } finally {
    activeBuildToken = null;
    runtime.dispatcher = sharedDispatcher;
    runtime.onboardingCounters = sharedCounters;
  }
  if (isThenable(buildResult)) {
    throw new Error('reportUserBatch: build must be synchronous');
  }
  if (dispatcher.currentInBatch.byteSize() === 0) {
    return;
  }
  const persisted = await persistAccumulatedBatch({
    storage: runtime.storage,
    dispatcher,
    dir: BATCHES_DIR,
    allocBatchNum: () => allocBatchNum(runtime),
  });
  /**
   * Durability is this API's contract: "resolved" means "on disk". A
   * swallowed storage failure (disk full, permissions) would resolve the
   * promise while the batch evaporated, so surface it as a rejection and
   * skip the send-loop wake (there is nothing new to ship).
   */
  if (!persisted) {
    throw new Error('reportUserBatch: batch persistence failed');
  }
  /** Wake the send loop so the batch ships now, not after the idle timeout. */
  sharedDispatcher.signalSend();
}

export { reportUserBatch };
