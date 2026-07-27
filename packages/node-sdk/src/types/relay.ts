/**
 * Types for `reportUserBatch`, the single event-emitting entry point of
 * the relay SDK.
 */

import type {
  ReportABTestGroupAssignmentArgs,
  ReportAdItemsGrantedArgs,
  ReportAdOfferedArgs,
  ReportAdRevenueArgs,
  ReportCustomEventArgs,
  ReportInAppPurchaseArgs,
  ReportInAppPurchaseItemsGrantedArgs,
  ReportItemsExchangeArgs,
  ReportItemsResetArgs,
  ReportSubscriptionItemsGrantedArgs,
  ReportSubscriptionRevenueArgs,
} from '@keewano/core';

/**
 * The per-user emission surface handed to a `reportUserBatch` build
 * callback. Every method appends to the one batch being assembled for the
 * current end user; there is no global "current user", so events can only
 * be produced through a reporter scoped to a specific user.
 *
 * Mirrors the React Native report surface minus the UI-tracking methods
 * (button / window / scene), which are not meaningful on a headless
 * server, and minus identity / consent / lifecycle calls, which do not
 * belong inside a single user's batch.
 *
 * reportOnboardingMilestone - onboarding step with a per-batch dedup
 *   suffix (repeats become `name (#2)`, `name (#3)`, ...).
 * reportABTestGroupAssignment - experiment exposure (test name + single
 *   ASCII group letter).
 * reportInAppPurchase / reportInAppPurchaseItemsGranted - purchase signal
 *   and the items it granted.
 * reportAdOffered / reportAdRevenue / reportAdItemsGranted - ad funnel
 *   signals and the items an ad granted.
 * reportSubscriptionRevenue / reportSubscriptionItemsGranted -
 *   subscription revenue and the items it granted.
 * reportItemsExchange / reportItemsReset - inventory mutations.
 * reportInstallCampaign - attribution campaign for this user.
 * reportGameLanguage - the user's in-game language.
 * reportCustomEvent - a host-declared event from the init `customEventSet`.
 * logError - a free-form error string for this user.
 */
interface UserReporter {
  reportOnboardingMilestone(name: string): void;
  reportABTestGroupAssignment(args: ReportABTestGroupAssignmentArgs): void;
  reportInAppPurchase(args: ReportInAppPurchaseArgs): void;
  reportInAppPurchaseItemsGranted(args: ReportInAppPurchaseItemsGrantedArgs): void;
  reportAdOffered(args: ReportAdOfferedArgs): void;
  reportAdRevenue(args: ReportAdRevenueArgs): void;
  reportAdItemsGranted(args: ReportAdItemsGrantedArgs): void;
  reportSubscriptionRevenue(args: ReportSubscriptionRevenueArgs): void;
  reportSubscriptionItemsGranted(args: ReportSubscriptionItemsGrantedArgs): void;
  reportItemsExchange(args: ReportItemsExchangeArgs): void;
  reportItemsReset(args: ReportItemsResetArgs): void;
  reportInstallCampaign(campaign: string): void;
  reportGameLanguage(language: string): void;
  reportCustomEvent(args: ReportCustomEventArgs): void;
  logError(message: string): void;
}

/**
 * Args for `reportUserBatch`.
 *
 * userId - end user this batch is attributed to: a 36-char hyphenated
 *   UUID string, or a numeric (up to 64-bit) id as a `bigint` (packed
 *   into the last 8 bytes of the UUID as a uint64). Sets the batch-level
 *   `K-Uid` / `.kwub` UserId; required so nothing ships under the empty
 *   user.
 * build - synchronous callback that emits the user's events through the
 *   supplied {@link UserReporter}. It runs against a dedicated per-batch
 *   dispatcher, so every event lands in this one batch. It MUST stay
 *   synchronous: the per-batch dispatcher is only installed for the
 *   duration of the call, so an `await` inside `build` would let later
 *   events escape to the wrong batch.
 */
interface ReportUserBatchArgs {
  userId: string | bigint;
  build: (reporter: UserReporter) => void;
}

export type { ReportUserBatchArgs, UserReporter };
