import type { AdTypeValue, Item } from '../../events';

/**
 * Purchase priced in USD cents. The wire payload is a uint32 LE so
 * the value is clamped to `[0, 0xFFFFFFFF]` before serialization.
 * The `localizedPrice` / `currencyCode` markers are `never` so a
 * caller cannot pass a mixed object that satisfies both variants -
 * the serializer would otherwise have to guess which wire shape to
 * pick.
 *
 * priceUsdCents - Price as integer USD cents.
 */
interface UsdCentsPurchase {
  priceUsdCents: number;
  localizedPrice?: never;
  currencyCode?: never;
}

/**
 * Purchase priced in the user's local currency. The amount is a
 * float32; the currency code is an ISO 4217 string (`'EUR'`,
 * `'UAH'`, ...). The `priceUsdCents` marker is `never` so a caller
 * cannot accidentally pass both fields.
 *
 * localizedPrice - Price in local currency (float32 on wire).
 * currencyCode - ISO 4217 currency code (e.g. `'EUR'`).
 */
interface LocalizedPurchase {
  localizedPrice: number;
  currencyCode: string;
  priceUsdCents?: never;
}

/** Discriminated union accepted by `reportInAppPurchase`. */
type PurchasePrice = UsdCentsPurchase | LocalizedPurchase;

/**
 * Revenue priced in USD cents. Same uint32 LE wire payload as
 * `UsdCentsPurchase`; reused by ad and subscription revenue. The
 * `never` markers enforce the same mutual-exclusion contract as
 * `UsdCentsPurchase`.
 *
 * revenueUsdCents - Revenue as integer USD cents.
 */
interface UsdCentsRevenue {
  revenueUsdCents: number;
  localizedRevenue?: never;
  currencyCode?: never;
}

/**
 * Revenue priced in the user's local currency. Same float32 + ISO
 * 4217 shape as `LocalizedPurchase`; reused by ad and subscription
 * revenue. The `revenueUsdCents` marker is `never` so a caller
 * cannot accidentally pass both fields.
 *
 * localizedRevenue - Revenue in local currency (float32 on wire).
 * currencyCode - ISO 4217 currency code (e.g. `'EUR'`).
 */
interface LocalizedRevenue {
  localizedRevenue: number;
  currencyCode: string;
  revenueUsdCents?: never;
}

/** Discriminated union accepted by `reportAdRevenue` / `reportSubscriptionRevenue`. */
type Revenue = UsdCentsRevenue | LocalizedRevenue;

/**
 * Two-sided item-exchange payload used by `reportItemsExchange`. The
 * server stores both legs so crafting / trading flows are observable
 * end-to-end.
 *
 * from - Items removed from the inventory in this exchange.
 * to - Items added to the inventory in this exchange.
 */
interface ItemsExchange {
  from: ReadonlyArray<Item>;
  to: ReadonlyArray<Item>;
}

/**
 * Args bag for `reportInAppPurchase`.
 *
 * productName - Product identifier (truncated to 256 chars on wire).
 * price - Either USD-cents or localized-currency price variant.
 */
interface ReportInAppPurchaseArgs {
  productName: string;
  price: PurchasePrice;
}

/**
 * Args bag for `reportInAppPurchaseItemsGranted`.
 *
 * productName - Product identifier (truncated to 256 chars on wire).
 * items - Items granted by this purchase.
 */
interface ReportInAppPurchaseItemsGrantedArgs {
  productName: string;
  items: ReadonlyArray<Item>;
}

/**
 * Args bag for `reportAdOffered`.
 *
 * placement - Ad placement identifier (truncated to 256 chars).
 * adType - One of the `AdType` enum values (uint8 on wire).
 */
interface ReportAdOfferedArgs {
  placement: string;
  adType: AdTypeValue;
}

/**
 * Args bag for `reportAdRevenue`.
 *
 * placement - Ad placement identifier (truncated to 256 chars).
 * revenue - Either USD-cents or localized-currency revenue variant.
 */
interface ReportAdRevenueArgs {
  placement: string;
  revenue: Revenue;
}

/**
 * Args bag for `reportAdItemsGranted`.
 *
 * placement - Ad placement identifier (truncated to 256 chars).
 * items - Items granted by viewing this ad.
 */
interface ReportAdItemsGrantedArgs {
  placement: string;
  items: ReadonlyArray<Item>;
}

/**
 * Args bag for `reportSubscriptionRevenue`.
 *
 * packageName - Subscription package identifier (truncated to 256 chars).
 * revenue - Either USD-cents or localized-currency revenue variant.
 */
interface ReportSubscriptionRevenueArgs {
  packageName: string;
  revenue: Revenue;
}

/**
 * Args bag for `reportSubscriptionItemsGranted`.
 *
 * packageName - Subscription package identifier (truncated to 256 chars).
 * items - Items granted by this subscription cycle.
 */
interface ReportSubscriptionItemsGrantedArgs {
  packageName: string;
  items: ReadonlyArray<Item>;
}

/**
 * Args bag for `reportItemsExchange`.
 *
 * name - Exchange label (truncated to 256 chars).
 * exchange - Two-sided exchange (`from` removed, `to` added).
 */
interface ReportItemsExchangeArgs {
  name: string;
  exchange: ItemsExchange;
}

/**
 * Args bag for `reportItemsReset`.
 *
 * name - Reset label (truncated to 256 chars).
 * items - Inventory snapshot to report.
 */
interface ReportItemsResetArgs {
  name: string;
  items: ReadonlyArray<Item>;
}

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
};
