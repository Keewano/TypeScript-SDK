/**
 * Public entry point for `@keewano/react-native-sdk` (bare React
 * Native hosts). What to reach for:
 *
 *   - `Keewano` - the lifecycle facade: `init` / `shutdown` plus the
 *     manual report API (`reportButtonClick`, `reportInAppPurchase`,
 *     ...). Start here.
 *   - `KeewanoPressable` - opt-in component escape hatch for buttons
 *     the global Pressable patch cannot see (custom UI stacks).
 *   - `useKeewanoNavigation` - hook that emits SCENE_LOADED /
 *     SCENE_UNLOADED from a `@react-navigation/native` container.
 *   - storage adapter (re-exported from `./storage`) - the bare-RN
 *     `StorageAdapter` used by default; pass a custom one through
 *     `Keewano.init({ storage })`.
 *   - `KeewanoTracker` - the plugin contract for custom auto-trackers
 *     passed via `Keewano.init({ plugins })`.
 *
 * Expo apps use `@keewano/react-native-expo-sdk` instead, which
 * re-exports this surface with an Expo storage adapter.
 */
export type { KeewanoApi } from './keewano';
export type { KeewanoConfig, KeewanoTracker } from './types/config';
export type { PlatformAdapter } from './types/platformAdapter';
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
} from './api/monetization';
export type { ReportABTestGroupAssignmentArgs } from './api/ui';
export type { CustomEventValue, ReportCustomEventArgs } from './api/customEvents';
export type { CustomEventDef, CustomEventSet, TransportFetch } from '@keewano/core';
export type { KeewanoPressableExtraProps } from './components/KeewanoPressable';
export type {
  NavigationContainerLike,
  NavigationContainerRefLike,
  NavigationRouteLike,
} from './navigation/useKeewanoNavigation';

export { Keewano } from './keewano';
export { configureTransportFetch } from '@keewano/core';
export { KeewanoPressable } from './components/KeewanoPressable';
export { useKeewanoNavigation } from './navigation/useKeewanoNavigation';
export { readSceneCursor, writeSceneCursor } from './navigation/sceneCursor';
export { defaultPlatformAdapter } from './platformDefaults';

export * from './storage';
