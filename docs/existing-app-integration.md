[Back to overview](README.md)

# Integrating into an Existing App

Adding Keewano to a game that already has players is the same install as a new app,
plus two things that help the backend make sense of your existing user base.

## Back-fill the registration date

New installs are dated from their first launch. For players who registered *before*
you added the SDK, report their original registration date once so the backend places
them correctly on the timeline.

```typescript
Keewano.reportUserRegisteredBeforeSDKIntegration(new Date('2024-01-15'));
```

> [!IMPORTANT]
> This is a one-shot event - the SDK records that it has been sent and ignores repeat
> calls, so it is safe to call on every launch. Report it as early as you can, right
> after `init`.

## Link your existing user id

If your game already has its own account ids, associate the current install with the
player's id so their pre-SDK and post-SDK activity line up.

```typescript
Keewano.setUserId('11111111-1111-4111-8111-111111111111');
```

`setUserId` accepts a 36-char hyphenated UUID or a `bigint` - any real user id, not
the all-zero id (which is rejected). Call it as soon as you know who the player is.

## Everything else just works

Once `init` runs, automatic tracking starts immediately - you do not need to
retrofit anything into your existing screens to get session, button, and error events.
Add manual events where they matter (purchases, progression) as you go.

---

Related: [Getting Started](getting-started.md) | [Example Integration](example-integration.md) | [Data Privacy](privacy.md)
