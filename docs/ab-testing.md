[Back to overview](README.md)

# A/B Tests

Running experiments? Tell Keewano which variant each player is in, so you can compare
behaviour across groups in the dashboard.

## Report a group assignment

Call this once you know the player's group for an experiment - ideally right after `init`.

```typescript
Keewano.reportABTestGroupAssignment({ testName: 'checkout_flow', group: 'B' });
```

- `testName` - your own identifier for the experiment.
- `group` - a single character for the variant, conventionally `'A'`, `'B'`, `'C'`, ...

> [!NOTE]
> `group` is one ASCII character. Report the assignment as early as you know it so the
> player's whole session is attributed to the right variant.

---

Related: [Tutorial Tracking](onboarding.md) | [Event Types](event-types.md)
