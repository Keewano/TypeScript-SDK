/**
 * Monetization + inventory + misc report methods. Each composite
 * call (`reportInAppPurchase`, `reportAdRevenue`, etc.) emits
 * multiple events sharing one frame-timestamp burst.
 */

import type { WireItem } from '../codec/types/codec';
import type { Item, KEvent } from '../events';
import type {
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
} from './types/monetization';
import type { KeewanoRuntime } from '../runtime';

import { KEvents } from '../events';
import { clampInt32NonNegative, clampNonNegativeFloat, clampUint32, clampUint8 } from './clamp';
import { runWhenReady, truncateString } from './reportHelpers';

/**
 * Config for the items-granted event. Kept as a local-only type
 * because the shape is consumed by exactly one private helper below
 * and has no use outside this file.
 *
 * eventId - Event id for the single record header (one of
 *   `ITEMS_PURCHASED_GRANT`, `ITEMS_AD_GRANTED`,
 *   `ITEMS_SUBSCRIPTION_GRANTED`).
 * label - Identifier string (product / placement / package) written
 *   as the event's leading payload, NOT as a separate event.
 * items - Items array packed inline after the label string. Typed
 *   loosely to accept `snapshotItems` output, whose invalid entries
 *   (null / undefined / primitive) are filtered by `normalizeItemsForWire`.
 */
interface ItemsGrantedEventConfig {
  eventId: KEvent;
  label: string;
  items: ReadonlyArray<Item | null | undefined>;
}

/** Narrow a {@link PurchasePrice} to the USD-cents branch. */
function isUsdCentsPurchase(price: PurchasePrice): price is UsdCentsPurchase {
  return 'priceUsdCents' in price;
}

/** Narrow a {@link Revenue} to the USD-cents branch. */
function isUsdCentsRevenue(revenue: Revenue): revenue is UsdCentsRevenue {
  return 'revenueUsdCents' in revenue;
}

/**
 * Set the dispatcher's frame timestamp to the supplied Unix-seconds
 * value and emit a paired timestamp event. The frame timestamp also
 * lands on every event record header emitted by the surrounding
 * composite report, so the server can correlate all events as one
 * burst.
 *
 * Callers MUST sample `Math.floor(Date.now() / 1000)` BEFORE
 * `runWhenReady` so the timestamp reflects the user action, not
 * the drain time when a pre-init-queued op finally runs.
 */
function emitTimestampEvent(runtime: KeewanoRuntime, eventId: KEvent, unixSec: number): void {
  runtime.dispatcher.setFrameTimestamp(unixSec);
  runtime.dispatcher.addEventDateTime({ eventId, date: unixSec });
}

/** Sample current Unix seconds (UTC). Single source of truth for wire timestamps. */
function nowUnixSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Capture a stable snapshot of a `PurchasePrice` at API-call time.
 * Composite reports route through `runWhenReady`, which can defer
 * the emit to a microtask or the pre-init drain - in either case
 * the closure would close over the caller's `price` object by
 * reference, so any mutation after the call (and before the emit)
 * would change the bytes that land on the wire. Snapshotting here
 * means the wire always carries the caller-time value.
 */
type PurchasePriceSnapshot =
  | { kind: 'usd'; priceUsdCents: number }
  | { kind: 'localized'; currencyCode: string; localizedPrice: number };
function snapshotPurchasePrice(price: PurchasePrice): PurchasePriceSnapshot {
  if (isUsdCentsPurchase(price)) {
    return { kind: 'usd', priceUsdCents: price.priceUsdCents };
  }
  return {
    kind: 'localized',
    currencyCode: price.currencyCode,
    localizedPrice: price.localizedPrice,
  };
}

/**
 * Capture a stable snapshot of a `Revenue` at API-call time. Same
 * reasoning as `snapshotPurchasePrice`: the runWhenReady closure
 * captures by reference, so a deferred emit would otherwise read
 * post-mutation values.
 */
type RevenueSnapshot =
  | { kind: 'usd'; revenueUsdCents: number }
  | { kind: 'localized'; currencyCode: string; localizedRevenue: number };
function snapshotRevenue(revenue: Revenue): RevenueSnapshot {
  if (isUsdCentsRevenue(revenue)) {
    return { kind: 'usd', revenueUsdCents: revenue.revenueUsdCents };
  }
  return {
    kind: 'localized',
    currencyCode: revenue.currencyCode,
    localizedRevenue: revenue.localizedRevenue,
  };
}

/**
 * Capture a stable snapshot of an `Item[]` at API-call time.
 * Non-array inputs collapse to an empty array (mirrors
 * `normalizeItemsForWire`'s Array.isArray guard). Each valid object entry
 * is cloned to a fresh `{ name, count }` object so a host that
 * mutates the original entries after the call cannot change the
 * bytes emitted by the queued `runWhenReady` callback. Invalid
 * entries (sparse holes, null, primitives) are preserved verbatim
 * so the snapshot return type stays honest; `normalizeItemsForWire`
 * filters them out at emit time (missing-name / null / non-object
 * checks, count clamp), so this helper stays cheap and never casts.
 */
function snapshotItems(items: ReadonlyArray<Item>): Array<Item | null | undefined> {
  if (!Array.isArray(items)) return [];
  return items.map((item) =>
    item !== undefined && item !== null && typeof item === 'object'
      ? { name: item.name, count: item.count }
      : item,
  );
}

/**
 * Emit a single items-granted event: one record header followed by
 * the (truncated) label string and the items array packed inline.
 * Shared by the IAP / ad / subscription "items granted" reports.
 *
 * The `unixSec` timestamp is captured at API-call time by every
 * caller so a queued pre-init report still stamps its events with
 * the user-action time on the wire instead of the drain time.
 */
function emitItemsGrantedEvent(
  runtime: KeewanoRuntime,
  config: ItemsGrantedEventConfig,
  unixSec: number,
): void {
  runtime.dispatcher.setFrameTimestamp(unixSec);
  const truncated = truncateString(config.label);
  runtime.dispatcher.addEventStringItems({
    eventId: config.eventId,
    str: truncated,
    items: normalizeItemsForWire(config.items),
  });
}

/**
 * Emit a 3-event (USD cents) or 4-event (localized) IAP burst per
 * wire-format §5.1 / §5.2. Both variants share the same
 * `PURCHASE_TIMESTAMP` + `PURCHASE_PRODUCT_ID` prefix; the tail
 * differs by currency / amount encoding.
 */
function reportInAppPurchase({ productName, price }: ReportInAppPurchaseArgs): void {
  const product = truncateString(productName);
  const ts = nowUnixSec();
  const priceSnap = snapshotPurchasePrice(price);
  runWhenReady((runtime) => {
    emitTimestampEvent(runtime, KEvents.PURCHASE_TIMESTAMP, ts);
    runtime.dispatcher.addEventString({ eventId: KEvents.PURCHASE_PRODUCT_ID, str: product });
    if (priceSnap.kind === 'usd') {
      runtime.dispatcher.addEventUint32({
        eventId: KEvents.PURCHASE_PRODUCT_PRICE_USD_CENTS,
        value: clampUint32(priceSnap.priceUsdCents),
      });
      return;
    }
    runtime.dispatcher.addEventString({
      eventId: KEvents.PURCHASE_LOCAL_CURRENCY_NAME,
      str: truncateString(priceSnap.currencyCode),
    });
    runtime.dispatcher.addEventFloat32({
      eventId: KEvents.PURCHASE_LOCAL_CURRENCY_AMOUNT,
      value: clampNonNegativeFloat(priceSnap.localizedPrice),
    });
  });
}

/**
 * Emit an `ITEMS_PURCHASED_GRANT` composite report: the product name
 * as a string event, followed by the items array packed inline,
 * followed by the trailer event.
 */
function reportInAppPurchaseItemsGranted({
  productName,
  items,
}: ReportInAppPurchaseItemsGrantedArgs): void {
  const ts = nowUnixSec();
  const itemsSnap = snapshotItems(items);
  runWhenReady((runtime) => {
    emitItemsGrantedEvent(
      runtime,
      {
        eventId: KEvents.ITEMS_PURCHASED_GRANT,
        label: productName,
        items: itemsSnap,
      },
      ts,
    );
  });
}

/**
 * Emit a 2-event `AD_OFFERED_PLACEMENT` + `AD_OFFERED_TYPE` burst
 * per wire-format §5.3. Placement is a string; `AdType` is wire-
 * emitted as uint8 (the no-payload `addEvent` writes the HDR, then
 * the raw byte is appended directly into the in-batch stream).
 */
function reportAdOffered({ placement, adType }: ReportAdOfferedArgs): void {
  const pl = truncateString(placement);
  const ts = nowUnixSec();
  runWhenReady((runtime) => {
    runtime.dispatcher.setFrameTimestamp(ts);
    runtime.dispatcher.addEventString({ eventId: KEvents.AD_OFFERED_PLACEMENT, str: pl });
    runtime.dispatcher.addEventUint8({
      eventId: KEvents.AD_OFFERED_TYPE,
      value: clampUint8(adType),
    });
  });
}

/**
 * Emit a 3-event (USD cents) or 4-event (localized) ad-revenue
 * burst per wire-format §5.4 / §5.5. Same shape as
 * {@link reportInAppPurchase} but with `AD_REVENUE_*` event IDs.
 */
function reportAdRevenue({ placement, revenue }: ReportAdRevenueArgs): void {
  const pl = truncateString(placement);
  const ts = nowUnixSec();
  const revenueSnap = snapshotRevenue(revenue);
  runWhenReady((runtime) => {
    emitTimestampEvent(runtime, KEvents.AD_REVENUE_TIMESTAMP, ts);
    runtime.dispatcher.addEventString({ eventId: KEvents.AD_REVENUE_PLACEMENT, str: pl });
    if (revenueSnap.kind === 'usd') {
      runtime.dispatcher.addEventUint32({
        eventId: KEvents.AD_REVENUE_USD_CENTS,
        value: clampUint32(revenueSnap.revenueUsdCents),
      });
      return;
    }
    runtime.dispatcher.addEventString({
      eventId: KEvents.AD_REVENUE_LOCAL_CURRENCY_NAME,
      str: truncateString(revenueSnap.currencyCode),
    });
    runtime.dispatcher.addEventFloat32({
      eventId: KEvents.AD_REVENUE_LOCAL_CURRENCY_AMOUNT,
      value: clampNonNegativeFloat(revenueSnap.localizedRevenue),
    });
  });
}

/**
 * Emit an `ITEMS_AD_GRANTED` composite: placement string + items
 * array + trailer event. Mirrors {@link reportInAppPurchaseItemsGranted}
 * for ad-rewarded inventory.
 */
function reportAdItemsGranted({ placement, items }: ReportAdItemsGrantedArgs): void {
  const ts = nowUnixSec();
  const itemsSnap = snapshotItems(items);
  runWhenReady((runtime) => {
    emitItemsGrantedEvent(
      runtime,
      {
        eventId: KEvents.ITEMS_AD_GRANTED,
        label: placement,
        items: itemsSnap,
      },
      ts,
    );
  });
}

/**
 * Emit a 3-event (USD cents) or 4-event (localized) subscription-
 * revenue burst per wire-format §5.6 / §5.7. Same shape as
 * {@link reportAdRevenue} but with `SUBSCRIPTION_*` event IDs.
 */
function reportSubscriptionRevenue({ packageName, revenue }: ReportSubscriptionRevenueArgs): void {
  const pkg = truncateString(packageName);
  const ts = nowUnixSec();
  const revenueSnap = snapshotRevenue(revenue);
  runWhenReady((runtime) => {
    emitTimestampEvent(runtime, KEvents.SUBSCRIPTION_REVENUE_TIMESTAMP, ts);
    runtime.dispatcher.addEventString({ eventId: KEvents.SUBSCRIPTION_REVENUE_PACKAGE, str: pkg });
    if (revenueSnap.kind === 'usd') {
      runtime.dispatcher.addEventUint32({
        eventId: KEvents.SUBSCRIPTION_REVENUE_USD_CENTS,
        value: clampUint32(revenueSnap.revenueUsdCents),
      });
      return;
    }
    runtime.dispatcher.addEventString({
      eventId: KEvents.SUBSCRIPTION_LOCAL_CURRENCY_NAME,
      str: truncateString(revenueSnap.currencyCode),
    });
    runtime.dispatcher.addEventFloat32({
      eventId: KEvents.SUBSCRIPTION_LOCAL_CURRENCY_AMOUNT,
      value: clampNonNegativeFloat(revenueSnap.localizedRevenue),
    });
  });
}

/**
 * Emit an `ITEMS_SUBSCRIPTION_GRANTED` composite: package name +
 * items array + trailer event. Mirrors
 * {@link reportInAppPurchaseItemsGranted} for subscription inventory.
 */
function reportSubscriptionItemsGranted({
  packageName,
  items,
}: ReportSubscriptionItemsGrantedArgs): void {
  const ts = nowUnixSec();
  const itemsSnap = snapshotItems(items);
  runWhenReady((runtime) => {
    emitItemsGrantedEvent(
      runtime,
      {
        eventId: KEvents.ITEMS_SUBSCRIPTION_GRANTED,
        label: packageName,
        items: itemsSnap,
      },
      ts,
    );
  });
}

/**
 * Emit an `ITEMS_EXCHANGE` event with two back-to-back item arrays
 * (`from` and `to`). Used for crafting / trading flows where the
 * server needs to see both sides of the exchange.
 */
function reportItemsExchange({ name, exchange }: ReportItemsExchangeArgs): void {
  const label = truncateString(name);
  const ts = nowUnixSec();
  const fromSnap = snapshotItems(exchange.from);
  const toSnap = snapshotItems(exchange.to);
  runWhenReady((runtime) => {
    runtime.dispatcher.setFrameTimestamp(ts);
    runtime.dispatcher.addEventStringItemsExchange({
      eventId: KEvents.ITEMS_EXCHANGE,
      str: label,
      from: normalizeItemsForWire(fromSnap),
      to: normalizeItemsForWire(toSnap),
    });
  });
}

/**
 * Emit an `ITEMS_RESET` event with a single inline items array.
 * Used to report inventory snapshots after server-side resets
 * (e.g. mailbox claim, season reset).
 */
function reportItemsReset({ name, items }: ReportItemsResetArgs): void {
  const label = truncateString(name);
  const ts = nowUnixSec();
  const itemsSnap = snapshotItems(items);
  runWhenReady((runtime) => {
    runtime.dispatcher.setFrameTimestamp(ts);
    runtime.dispatcher.addEventStringItems({
      eventId: KEvents.ITEMS_RESET,
      str: label,
      items: normalizeItemsForWire(itemsSnap),
    });
  });
}

/** Emit an `INSTALL_CAMPAIGN` event with the (truncated) campaign label. */
function reportInstallCampaign(campaign: string): void {
  const value = truncateString(campaign);
  const ts = nowUnixSec();
  runWhenReady((runtime) => {
    runtime.dispatcher.setFrameTimestamp(ts);
    runtime.dispatcher.addEventString({ eventId: KEvents.INSTALL_CAMPAIGN, str: value });
  });
}

/** Emit a `GAME_LANG` event with the (truncated) language code. */
function reportGameLanguage(language: string): void {
  const value = truncateString(language);
  const ts = nowUnixSec();
  runWhenReady((runtime) => {
    runtime.dispatcher.setFrameTimestamp(ts);
    runtime.dispatcher.addEventString({ eventId: KEvents.GAME_LANG, str: value });
  });
}

/**
 * Emit an `ERROR_MSG` event with the full message string. Skips the
 * 256-char truncation that other report methods apply so debug
 * detail survives; the dispatcher's `addEventString` accepts strings
 * of any length already.
 */
function logError(message: string): void {
  const ts = nowUnixSec();
  runWhenReady((runtime) => {
    runtime.dispatcher.setFrameTimestamp(ts);
    runtime.dispatcher.addEventString({ eventId: KEvents.ERROR_MSG, str: message });
  });
}

/**
 * Normalize an items array into its wire-ready form: filter out
 * holes / nulls / non-object entries, truncate each name, and clamp
 * each count to the uint32 range. The builder writes the result
 * verbatim (`int32 count` + repeating `string name | uint32 count`),
 * so the normalized length IS the on-wire element count.
 */
function normalizeItemsForWire(items: ReadonlyArray<Item | null | undefined>): WireItem[] {
  /**
   * Normalize away sparse holes, nulls, and non-object entries
   * BEFORE writing the count. A sparse array like `[a, , c]` or
   * JS callers passing `[a, null, c]` would otherwise make us
   * write a count of 3 but emit fewer (or throw midway through
   * `truncateString` on a `null.name` deref). The filter compacts
   * to defined `{ name }` entries; the count we write on the wire
   * is the filtered length, so the body always matches its header.
   *
   * JS-only callers can also bypass the TS signature and pass a
   * non-array value (`null`, a plain object, a string). Calling
   * `.filter` on that would throw and abort the surrounding
   * composite-report emission - degrade safely to an empty array
   * instead so the wire still carries a `00 00 00 00` count.
   */
  const source = Array.isArray(items) ? items : [];
  const normalized = source.filter(
    (item): item is Item =>
      item !== undefined &&
      item !== null &&
      typeof item === 'object' &&
      typeof item.name === 'string',
  );
  /**
   * The array element count is a signed `int32 LE` on the wire (the
   * reference writes a C# array `Length`, an `int`), distinct from
   * the per-item `count` below which is `uint32 LE`. `items.length`
   * is a JS array length (range 0 .. 2^32-1); an array above
   * 0x7FFFFFFF entries would wrap to a negative count and corrupt
   * the decoder. Clamp to the non-negative int32 range.
   */
  const itemCount = clampInt32NonNegative(normalized.length);
  const out: WireItem[] = [];
  /**
   * Emit exactly `itemCount` entries via indexed access so the
   * normalized length always matches the on-wire element count. A
   * `for...of` over the un-clamped array would desync the payload
   * from its header for arrays above the int32 ceiling.
   *
   * Per-item `count` is `uint32 LE` on the wire (full [0, 2^32-1]
   * range). A NaN / float / negative / overflow `item.count` from
   * misbehaving app code would otherwise serialize a garbage
   * quantity the backend cannot interpret, so each count is clamped
   * here, at the single normalization point.
   */
  for (let i = 0; i < itemCount; i += 1) {
    const item = normalized[i];
    if (item === undefined) break;
    out.push({ name: truncateString(item.name), count: clampUint32(item.count) });
  }
  return out;
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
} from './types/monetization';
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
};
