[Back to overview](README.md)

# Data Privacy

The SDK is built to respect player consent. By default it starts collecting
immediately; turn on the consent gate and nothing leaves the device until the player
agrees.

## The consent gate

Pass `requirePlayerConsent: true` to hold all sending until the player decides.

```typescript
Keewano.init({ apiKey: '...', requirePlayerConsent: true });
```

While the gate is pending, events are still collected and stored on disk - they are
just not sent. Once the player decides, flip the gate:

```typescript
// player agreed
Keewano.setUserConsent(true);

// player declined
Keewano.setUserConsent(false);
```

| State | How you reach it | What happens |
|---|---|---|
| Not required | `requirePlayerConsent` omitted / `false` | events flow immediately |
| Pending | `requirePlayerConsent: true`, no decision yet | events queue on disk, nothing is sent |
| Granted | `setUserConsent(true)` | queued and future events are sent |
| Denied | `setUserConsent(false)` | queued events are deleted, nothing is sent |

> [!IMPORTANT]
> Denial is real deletion: when the player declines, the queued on-disk batches are
> removed, not just held. The first decision is final for this install: once the state
> is Granted or Denied, later `setUserConsent` calls are no-ops.

> [!NOTE]
> A consent decision takes effect immediately in memory and is saved to disk
> best-effort. In the rare case that write fails, the decision still holds for the
> current session; the next launch falls back to `Pending` (the conservative default)
> and re-prompts.

## What is stored on the device

The SDK keeps a small amount of state in your app's private storage:

- an anonymous install id and (if you set one) the user id
- the current consent state
- the queue of not-yet-sent event batches

There is no third-party storage and nothing is written outside your app's sandbox.

## Test users

To mark a session's data as coming from a QA tester (so you can filter it in the
dashboard), tag it once:

```typescript
Keewano.markAsTestUser('qa-team');
```

The marker travels with every batch from that point and persists across restarts.

---

Related: [Configuration](configuration.md) | [Offline Analytics](offline.md) | [Getting Started](getting-started.md)
