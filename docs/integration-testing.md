[Back to overview](README.md)

# Integration Testing

A quick way to confirm the SDK is wired up correctly before you ship.

## 1. Mark your session as a test user

So your own activity is easy to find and filter in the dashboard, tag the session:

```typescript
Keewano.markAsTestUser('dev');
```

The marker travels with every batch and persists across restarts, so a single call at
startup is enough during development.

## 2. Generate some events

Run the app and exercise the paths you care about:

- launch and background / foreground the app (session and lifecycle events)
- tap a few buttons (button-click events)
- navigate between screens (scene events, if you added the navigation hook)
- trigger a purchase or a custom event

## 3. Confirm they arrive

Check the dashboard for your test-user session and verify the events you produced show
up. Because delivery is batched and retried, allow a short delay - events are flushed
on a timer, not instantly.

> [!TIP]
> Point `endpoint` at your staging ingress while testing so test data never lands in
> production. See [Configuration](configuration.md).

## 4. Test offline behaviour

Put the device in airplane mode, generate a few events, then reconnect. The queued
events should ship automatically, oldest-first, with nothing lost. See
[Offline Analytics](offline.md).

> [!NOTE]
> You do not need to call any flush or sync method - reconnect handling is automatic.
> For a clean stop in a test, call `await Keewano.shutdown()` (see [Offline Analytics](offline.md)).

---

Related: [Example Integration](example-integration.md) | [Offline Analytics](offline.md) | [Data Privacy](privacy.md)
