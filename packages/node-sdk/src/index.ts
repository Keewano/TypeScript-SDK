/**
 * `@keewano/node-sdk` - Keewano analytics for Node.js services, built on
 * `@keewano/core`.
 *
 * The SDK runs in relay mode: a single server process reports telemetry on
 * behalf of many end users. `Keewano.init({ apiKey })` boots it and
 * `Keewano.reportUserBatch({ userId, build })` emits one batch per end
 * user, with events produced through the reporter handed to `build`.
 *
 * The package also exposes its persistence building block
 * (`NodeStorageAdapter`), re-exports the shared transport hook, and
 * re-exports the custom-event and report argument types so hosts can type
 * their reporter calls without reaching into `@keewano/core`.
 */

export type {
  CustomEventDef,
  CustomEventSet,
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
  TransportFetch,
} from '@keewano/core';

export { configureTransportFetch } from '@keewano/core';

export type { NodeKeewanoApi } from './keewano';

export { Keewano } from './keewano';

export type { NodeKeewanoConfig } from './types/config';

export type { ReportUserBatchArgs, UserReporter } from './types/relay';

export type { NodeFsLike, NodeStorageAdapterArgs } from './storage';

export { NodeStorageAdapter } from './storage';
