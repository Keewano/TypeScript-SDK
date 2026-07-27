/**
 * Shared `report*` infrastructure: numeric wire-field clamps and the
 * `runWhenReady` / `truncateString` helpers every report method builds
 * on. Platform facades (React Native, Node) reuse these so the same
 * emission produces byte-identical events on every platform.
 */

export {
  clampInt32NonNegative,
  clampNonNegativeFloat,
  clampUint16,
  clampUint32,
  clampUint8,
} from './clamp';
export {
  MAX_STRING_LENGTH,
  runWhenReady,
  runWhenReadyAsync,
  truncateString,
} from './reportHelpers';
export { formatErrorMessage } from './formatError';

export type {
  ItemsExchange,
  LocalizedPurchase,
  LocalizedRevenue,
  PurchasePrice,
  ReportAdItemsGrantedArgs,
  ReportAdOfferedArgs,
  ReportAdRevenueArgs,
  ReportInAppPurchaseArgs,
  ReportInAppPurchaseItemsGrantedArgs,
  ReportItemsExchangeArgs,
  ReportItemsResetArgs,
  ReportSubscriptionItemsGrantedArgs,
  ReportSubscriptionRevenueArgs,
  Revenue,
  UsdCentsPurchase,
  UsdCentsRevenue,
} from './monetization';
export type { CustomEventValue, ReportCustomEventArgs } from './customEvents';

export {
  logError,
  reportAdItemsGranted,
  reportAdOffered,
  reportAdRevenue,
  reportGameLanguage,
  reportInAppPurchase,
  reportInAppPurchaseItemsGranted,
  reportInstallCampaign,
  reportItemsExchange,
  reportItemsReset,
  reportSubscriptionItemsGranted,
  reportSubscriptionRevenue,
} from './monetization';
export { reportCustomEvent } from './customEvents';
export {
  getInstallId,
  markAsTestUser,
  reportUserRegisteredBeforeSDKIntegration,
  setUserId,
} from './identity';
export type { ReportABTestGroupAssignmentArgs } from './progression';
export { reportABTestGroupAssignment, reportOnboardingMilestone } from './progression';
