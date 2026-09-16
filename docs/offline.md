[Back to overview](README.md)

# Offline Analytics

Players lose connectivity - on the subway, on a plane, in a tunnel. The SDK keeps
collecting through it and ships the backlog when the connection returns, and you do not
have to do anything special.

## How it works

The SDK is **persistence-first**: every batch of events is written to local storage
*before* any network attempt. So the order is always collect to memory, persist, then
send - never the other way around. The one exception is the web SDK's page-exit path:
in a closing tab the last batch is handed to the network at the same moment it is
handed to storage, because a closing page cannot wait for the write. The stored copy
is kept either way and resent on the next visit; the backend deduplicates the pair.

That means:

- **No loss of persisted data.** A crash or a dropped connection cannot lose events
  that were already persisted - they are in storage waiting. Events reported since the
  last persist tick live in memory only, so a crash can lose up to one tick's worth
  (the loop persists as soon as the buffer crosses its threshold, otherwise every 30
  seconds), and a batch whose write fails is dropped rather than retried.
- **Automatic retry.** When connectivity returns, the send loop picks up the queued
  batches and ships them. You do not call anything. One exception: over the JSON
  ingestion API used by the web SDK, HTTP 400, 401, 403 and 413 mean the backend has
  permanently rejected that batch, so it is dropped rather than retried forever. Over
  the binary API used by the device and Node.js SDKs, every non-2xx is retried.
- **Correct order.** Batches are sent oldest-first, so the backend receives the
  player's actions in the order they happened, not in a random burst.

> [!NOTE]
> This is all automatic. There is no "offline mode" to enable and no flush to call -
> reconnect handling is part of the normal send loop.

## Storage bounds

So a long offline stretch can never fill the device, the queue is capped: 50 MB on the
React Native, Expo, and Node.js SDKs, 10 MB on the web SDK. When the cap is exceeded,
the oldest oversized batches are replaced in place by a marker event that tells the
backend a batch was dropped and why, so gaps are visible instead of silent. The marker
does not carry a count of the lost events, and batches already reduced to a marker are
not shrunk again, so the queue can sit slightly above the cap.

## Browsers: one sender per origin

Every tab of your origin collects and persists events, but only one of them delivers.
The tabs elect a single sender through the browser's Web Locks API; the tabs that lose
the election run a persist-only loop - they keep writing their events to the shared
queue, and the elected tab ships them. A losing tab also skips the storage-cap sweep
and the consent-denied purge of the stored queue; those run on the elected tab for the
whole origin.

If the Web Locks API is missing or refuses the request, the tab delivers on its own
rather than going silent. Two tabs can then ship the same events, and the backend
deduplicates them.

## Browsers: closing the page

There is no `shutdown` on a page the visitor is closing, so the web SDK hooks
`pagehide` and the tab-hidden visibility change instead. On that signal it always
persists whatever is still in memory, so the next visit ships it.

It also tries to send those batches immediately, but only when both of these hold:

- nothing else from this session is still queued, because the backend drops a
  lower-numbered batch that arrives after a higher one;
- your declared custom-event schema (if you passed a `customEventSet`) is already
  registered, because a batch stamped with a schema the backend has never seen is
  rejected.

When either fails, the exit path persists only and the next visit registers and then
ships everything in order. Nothing is deleted on the exit send's account: the stored
copies stay and the next visit resends them, and the backend deduplicates the pair.
Batches go out strictly in order, and only the last one uses the browser's keep-alive
channel - the only request shape that survives page teardown.

## Clean shutdown

If you stop the SDK explicitly, `shutdown` flushes anything still in memory to disk
first, so it ships on the next launch. (On the Node relay there is nothing to flush:
every batch is already on disk once `reportUserBatch` resolves.)

```typescript
await Keewano.shutdown();
```

---

Related: [Data Privacy](privacy.md) | [Data Format](data-format.md) | [Integration Testing](integration-testing.md)
