[Back to overview](README.md)

# Subscription Revenue

Subscription events track recurring payments - report one each time a subscription
charges, so Keewano can follow renewals over time.

## Report subscription revenue

Same two shapes as purchases and ads: USD cents or local currency.

```typescript
// USD cents
Keewano.reportSubscriptionRevenue({
  packageName: 'premium_monthly',
  revenue: { revenueUsdCents: 999 }, // $9.99
});

// localized currency
Keewano.reportSubscriptionRevenue({
  packageName: 'premium_monthly',
  revenue: { localizedRevenue: 9.99, currencyCode: 'EUR' },
});
```

`packageName` is your own subscription identifier. Keep it stable across renewals.

> [!NOTE]
> Report this on every charge, not only the first one. Renewals reported with the
> same `packageName` are how Keewano measures retention and lifetime value.

## Report the items granted

If the subscription grants perks or items on each cycle, report them.

```typescript
Keewano.reportSubscriptionItemsGranted({
  packageName: 'premium_monthly',
  items: [{ name: 'vip_pass', count: 1 }],
});
```

---

Related: [In-App Purchases](in-app-purchases.md) | [Ad Revenue](ad-revenue.md) | [Item Economy](item-economy.md)
