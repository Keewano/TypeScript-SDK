[Back to overview](README.md)

# In-App Purchases

Purchase events tell Keewano how players spend real money in your game. Reporting one
is a single call - make it right after the store confirms the transaction.

## Report a purchase

You can report the price in USD cents or in the player's local currency.

**USD cents** - use this when you already know the price in cents:

```typescript
Keewano.reportInAppPurchase({
  productName: 'gem_pack_large',
  price: { priceUsdCents: 499 }, // $4.99
});
```

**Localized currency** - use this to record the exact amount and currency the player
saw in their store:

```typescript
Keewano.reportInAppPurchase({
  productName: 'gem_pack_large',
  price: { localizedPrice: 4.99, currencyCode: 'EUR' },
});
```

> [!TIP]
> `productName` is your own product identifier (the SKU). Keep it stable across
> versions so the backend can group a product's purchases over time.

## Report the items granted

If the purchase hands the player in-game items, report them too. Keewano then ties
real spend to the inventory the player received.

```typescript
Keewano.reportInAppPurchaseItemsGranted({
  productName: 'gem_pack_large',
  items: [
    { name: 'gems', count: 500 },
    { name: 'bonus_chest', count: 1 },
  ],
});
```

> [!NOTE]
> Each item `count` is an unsigned 32-bit integer (0 to 4,294,967,295). An out-of-range
> count is clamped into range, never dropped, so a bad count can never corrupt the
> rest of the batch.

## When to call

- Call `reportInAppPurchase` once per confirmed transaction (after the store/receipt validation succeeds).
- Call `reportInAppPurchaseItemsGranted` right after you credit the items.

---

Related: [Ad Revenue](ad-revenue.md) | [Subscription Revenue](subscription-revenue.md) | [Item Economy](item-economy.md)
