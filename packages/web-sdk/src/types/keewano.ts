/**
 * Public web SDK API contract, implemented by the `Keewano` facade.
 * Mirrors the mobile facade minus what the web has no analogue for
 * (scene tracking, install-id read, pre-integration registration).
 * Every method is guard-wrapped: SDK errors are logged internally and
 * never propagate into the host page; the async methods resolve even
 * on internal failure. `init` is fire-and-forget but returns a
 * Promise so tests can await the post-init state. The composite
 * monetization / inventory reports emit multiple wire events under a
 * shared frame timestamp; `reportCustomEvent` is usually called
 * through the typed wrappers `@keewano/codegen` generates.
 */

import type {
  ConsentState,
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

import type { WebKeewanoConfig } from './config';

interface WebKeewanoApi {
  init(config: WebKeewanoConfig): Promise<void>;
  shutdown(): Promise<void>;
  isReady(): boolean;
  setUserId(userId: string | bigint): void;
  setUserConsent(granted: boolean): Promise<void>;
  markAsTestUser(name: string): void;
  reportButtonClick(name: string): void;
  reportWindowOpen(name: string): void;
  reportWindowClose(name: string): void;
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
 * Args bag for the facade's `warnIfConsentUnmoved` helper. Internal to
 * the facade; not re-exported from the package.
 *
 * granted - What the caller asked for.
 * recorded - What the record holds after the call, which a one-shot
 *   decision leaves unchanged when a second call cannot move it.
 */
interface WarnIfConsentUnmovedArgs {
  granted: boolean;
  recorded: ConsentState;
}

export type { WarnIfConsentUnmovedArgs, WebKeewanoApi };
