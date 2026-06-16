/**
 * Argument and entity types for the item factory module.
 */

/**
 * Inventory item with a unique identifier and a non-negative count.
 *
 * Used as the payload element of the items-bearing events
 * (`ITEMS_EXCHANGE`, `ITEMS_PURCHASED_GRANT`, `ITEMS_AD_GRANTED`,
 * `ITEMS_SUBSCRIPTION_GRANTED`, `ITEMS_RESET`). On the wire, an array
 * of items is serialized as `[int32 LE count][item...]`, where each
 * item is `[varint-prefixed UTF-8 name][uint32 LE count]`.
 *
 * @property name - Unique item identifier, max 256 chars (truncated by
 *   the public API).
 * @property count - Quantity in the range `[0, 2^32 - 1]`. Defaults to
 *   1 when constructed via `item({ name })`.
 */
interface Item {
  name: string;
  count: number;
}

/**
 * Arguments for the `item` factory.
 *
 * @property name - Unique item identifier, see `Item.name`.
 * @property count - Optional quantity, defaults to 1. Must be a
 *   non-negative integer in uint32 range when supplied.
 */
interface ItemArgs {
  name: string;
  count?: number;
}

export type { Item, ItemArgs };
