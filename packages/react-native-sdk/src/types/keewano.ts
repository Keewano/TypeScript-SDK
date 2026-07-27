/**
 * Public SDK API contract. The single facade object exported as
 * `Keewano` from the package barrel implements this interface;
 * end users program against it.
 *
 * Lifecycle (`init`, `shutdown`, `isReady`) - boot the SDK and wind
 *   it down. `init` is fire-and-forget but returns a Promise so
 *   tests can await the post-init state.
 * Identity (`getInstallId`, `setUserId`, `setUserConsent`,
 *   `markAsTestUser`, `reportUserRegisteredBeforeSDKIntegration`) -
 *   identity + consent + QA-tester surface.
 * UI tracking (`reportButtonClick`, `reportWindowOpen`,
 *   `reportWindowClose`, `reportOnboardingMilestone`,
 *   `reportABTestGroupAssignment`) - manual hooks for screens and
 *   buttons that auto-tracking does not cover.
 * Monetization + inventory (`reportInAppPurchase`, `reportAdOffered`,
 *   `reportAdRevenue`, `reportSubscriptionRevenue`, the
 *   `report*ItemsGranted` family, `reportItemsExchange`,
 *   `reportItemsReset`) - composite-report APIs that emit multiple
 *   wire events under a shared frame timestamp.
 * Custom events (`reportCustomEvent`) - emit a host-declared event from
 *   the `customEventSet` passed to init. Usually called through the
 *   typed wrappers `@keewano/codegen` generates rather than by hand.
 * Miscellaneous (`reportInstallCampaign`, `reportGameLanguage`,
 *   `logError`) - one-off single-event reports.
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

import type { KeewanoConfig } from './config';

interface KeewanoApi {
  init(config: KeewanoConfig): Promise<void>;
  shutdown(): Promise<void>;
  isReady(): boolean;
  getInstallId(): Promise<string>;
  setUserId(userId: string | bigint): void;
  setUserConsent(granted: boolean): Promise<void>;
  markAsTestUser(name: string): void;
  reportUserRegisteredBeforeSDKIntegration(date: Date): Promise<void>;
  reportButtonClick(name: string): void;
  reportWindowOpen(name: string): void;
  reportWindowClose(name: string): void;
  reportSceneLoaded(name: string): void;
  reportSceneUnloaded(name: string): void;
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

export type { KeewanoApi };
