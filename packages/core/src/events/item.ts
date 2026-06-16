/**
 * Convenience factory for the `Item` shape used by inventory-bearing
 * events (`ITEMS_EXCHANGE`, `ITEMS_PURCHASED_GRANT`, `ITEMS_AD_GRANTED`,
 * `ITEMS_SUBSCRIPTION_GRANTED`, `ITEMS_RESET`).
 *
 * Two forms: explicit `count`, or default count of 1 for "user got one
 * of this thing" cases.
 *
 * @example
 * ```ts
 * import { item } from '@keewano/core';
 *
 * item({ name: 'gold_coin', count: 100 }); // { name: 'gold_coin', count: 100 }
 * item({ name: 'sword' });                 // { name: 'sword', count: 1 }
 * ```
 */

import type { Item, ItemArgs } from './types/item';

/**
 * Build an `Item` from a name and optional count.
 *
 * Range validation of `count` is deferred to the encoder (it must fit
 * in uint32 when the items array is serialized).
 *
 * @param args - Item name and optional count (defaults to 1).
 * @returns A fresh `Item` object.
 */
function item({ name, count = 1 }: ItemArgs): Item {
  return { name, count };
}

export type { Item, ItemArgs } from './types/item';
export { item };
