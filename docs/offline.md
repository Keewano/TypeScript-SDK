[Back to overview](README.md)

# Offline Analytics

Players lose connectivity - on the subway, on a plane, in a tunnel. The SDK is built
so that no event is lost when that happens, and you do not have to do anything special.

## How it works

The SDK is **persistence-first**: every batch of events is written to disk *before*
any network attempt. So the order is always collect to memory, persist to disk, then
send - never the other way around.

That means:

- **No data loss.** A crash or a dropped connection cannot lose events that were
  already collected - they are on disk waiting.
- **Automatic retry.** When connectivity returns, the send loop picks up the queued
  batches and ships them. You do not call anything.
- **Correct order.** Batches are sent oldest-first, so the backend receives the
  player's actions in the order they happened, not in a random burst.

> [!NOTE]
> This is all automatic. There is no "offline mode" to enable and no flush to call -
> reconnect handling is part of the normal send loop.

## Storage bounds

So a long offline stretch can never fill the device, the on-disk queue is capped. If
the cap is reached, the oldest batches are dropped first and the backend is told how
much was dropped, so your data stays consistent rather than silently truncated.

## Clean shutdown

If you stop the SDK explicitly, `shutdown` flushes anything still in memory to disk
first, so it ships on the next launch.

```typescript
await Keewano.shutdown();
```

---

Related: [Data Privacy](privacy.md) | [Data Format](data-format.md) | [Integration Testing](integration-testing.md)
