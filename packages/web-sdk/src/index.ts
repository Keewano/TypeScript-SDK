/**
 * `@keewano/web-sdk` - Keewano analytics for web browsers. The public
 * surface is deliberately host-facing only: the `Keewano` facade with
 * its config / API / report-args types plus the storage adapter.
 * Snippet code ships only in the IIFE bundle, so the ESM tree stays
 * free of it.
 */

export type { WebKeewanoApi } from './keewano';

export type { KeewanoTracker, WebKeewanoConfig } from './types/config';

export type { ResolveWindowName, WindowLocationLike } from './trackers/types/navigation';

export type {
  CustomEventDef,
  CustomEventSet,
  CustomEventValue,
  ItemsExchange,
  LocalizedPurchase,
  LocalizedRevenue,
  PurchasePrice,
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
  Revenue,
  StorageAdapter,
  UsdCentsPurchase,
  UsdCentsRevenue,
} from '@keewano/core';

export type { IndexedDbStorageAdapterArgs } from './storage';

export { Keewano } from './keewano';

export { IndexedDbStorageAdapter } from './storage';
