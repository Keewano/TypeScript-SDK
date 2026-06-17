[Back to overview](README.md)

# Item Economy (In-Game Balance)

These events describe your game's virtual economy - what players craft, trade, and
hold. They help Keewano understand sinks and sources in your balance.

Every item is a simple `{ name, count }` pair. `count` is an unsigned 32-bit integer.

## Report an exchange

Use this for crafting, trading, or any swap where the player gives some items and
gets others. You report both sides.

```typescript
Keewano.reportItemsExchange({
  name: 'craft_sword',
  exchange: {
    from: [{ name: 'iron', count: 3 }, { name: 'wood', count: 2 }],
    to: [{ name: 'sword', count: 1 }],
  },
});
```

`name` is your own label for the exchange (the recipe, trade, or shop deal).

> [!TIP]
> Both `from` and `to` accept multiple items, so one call captures a full recipe -
> all the inputs and all the outputs together.

## Report a reset / snapshot

Use this to report an inventory snapshot after a server-side change the player did not
directly trigger - a mailbox claim, a season reset, a balance correction.

```typescript
Keewano.reportItemsReset({
  name: 'season_reset',
  items: [{ name: 'tokens', count: 0 }],
});
```

> [!NOTE]
> An empty `items: []` array is valid and is sent as a real (zero-length) event - it
> is never dropped.

---

Related: [In-App Purchases](in-app-purchases.md) | [Ad Revenue](ad-revenue.md) | [Subscription Revenue](subscription-revenue.md)
