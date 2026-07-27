[Back to overview](README.md)

# Ad Revenue

Ad events let Keewano measure how advertising performs in your game - what you offered,
what it earned, and what the player received.

## Report an ad offered

Call this when you present an ad to the player.

```typescript
Keewano.reportAdOffered({
  placement: 'level_complete',
  adType: 1, // 1 = rewarded, see the table below
});
```

`placement` is your own label for where the ad appeared. `adType` is a numeric
ad-type code:

| Code | Ad type |
| ---- | ---------------------------------------------------------- |
| 1    | Rewarded - the player opts in for a reward |
| 2    | Interstitial - full-screen between game moments |
| 3    | Banner - persistent on-screen strip |
| 4    | Playable - interactive mini-game ad |
| 5    | Offerwall - list of tasks/offers granting rewards |

## Report ad revenue

When an ad earns money, report it - in USD cents or local currency, the same two
shapes as purchases.

```typescript
// USD cents
Keewano.reportAdRevenue({
  placement: 'level_complete',
  revenue: { revenueUsdCents: 3 },
});

// localized currency
Keewano.reportAdRevenue({
  placement: 'level_complete',
  revenue: { localizedRevenue: 0.03, currencyCode: 'EUR' },
});
```

> [!TIP]
> Use the same `placement` string in `reportAdOffered` and `reportAdRevenue` so the
> backend can line up offers with the revenue they produced.

## Report the items granted

For rewarded ads that grant items, report what the player received.

```typescript
Keewano.reportAdItemsGranted({
  placement: 'level_complete',
  items: [{ name: 'coins', count: 100 }],
});
```

---

Related: [In-App Purchases](in-app-purchases.md) | [Subscription Revenue](subscription-revenue.md) | [Item Economy](item-economy.md)
