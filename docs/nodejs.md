[Back to overview](README.md)

# Node.js (Server Relay)

The Node.js SDK reports Keewano analytics from a server, not a device. One process
relays events on behalf of many end users: for each user you assemble a self-contained
batch, tag it with that user's id, and the SDK ships it. The wire format is identical to
the React Native SDK, so the same backend ingests both.

It is the right fit for server-authoritative events - a purchase your backend validates,
a subscription a billing webhook confirms, an item your economy service grants - that you
want attributed to the player who triggered them.

## 1. Install

```bash
npm install @keewano/node-sdk
```

Requires Node.js >= 20 (the SDK uses the built-in global `fetch`). There is no native
code and no React dependency.

## 2. Initialise

Call `init` once when your process starts. `apiKey` is the only required option.

```typescript
import { Keewano } from '@keewano/node-sdk';

await Keewano.init({ apiKey: 'your-project-api-key' });
```

Unlike the device SDKs, `init` does nothing on its own - no environment burst, no
background listeners. It only prepares the send loop. Every event is supplied later, per
user, through `reportUserBatch`.

### Configuration

| Option            | Type                                          | Default                 | What it does                                                                                                                                                                                                        |
| ----------------- | --------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`          | `string`                                      | (required)              | Your project key, sent as the `K-Token` header.                                                                                                                                                                     |
| `endpoint`        | `string`                                      | production URL          | Override the ingress URL. Useful for staging or self-host.                                                                                                                                                          |
| `dataDir`         | `string`                                      | `<os.tmpdir()>/keewano` | Directory the default storage uses for on-disk batches. Ignored when `storage` is supplied.                                                                                                                         |
| `storage`         | `StorageAdapter`                              | `NodeStorageAdapter`    | Custom storage backend; replaces the file-system default.                                                                                                                                                           |
| `installId`       | `string`                                      | project id              | Override the relay install id (a 36-char hyphenated UUID). Defaults to the project id from the API key, which the backend requires to be non-zero.                                                                  |
| `getExtraHeaders` | `() => Record<string,string> \| Promise<...>` | none                    | Extra HTTP headers on every request (for example an auth token for a proxy in front of staging). Resolved once per send cycle, so a short-lived token can refresh. Reserved `K-*` / `Content-*` headers always win. |
| `customEventSet`  | `CustomEventSet`                              | none                    | Your generated custom-events schema. See [Custom Events](custom-events.md).                                                                                                                                         |

> [!NOTE]
> The Node SDK has no consent gate and no opt-out flags. Those belong to the device SDKs,
> which capture user behaviour automatically; a relay only ships what you hand it per user.

## 3. Report a user batch

`reportUserBatch` is the one event-emitting call. You give it the end user's id and a
`build` callback; the callback receives a reporter scoped to that user, and every event
you emit through it lands in a single batch attributed to that user.

```typescript
await Keewano.reportUserBatch({
  userId: '11111111-1111-4111-8111-111111111111',
  build: (user) => {
    user.reportInAppPurchase({ productName: 'gold_pack', price: { priceUsdCents: 499 } });
    user.reportInAppPurchaseItemsGranted({
      productName: 'gold_pack',
      items: [{ name: 'gold', count: 1000 }],
    });
  },
});
```

The promise resolves once the batch is persisted to disk; it ships on the next send-loop
pass, which is woken immediately. If the batch cannot be written (disk full, permissions),
the promise rejects and the events of that call are not queued - handle or log the
rejection on your side. One exception: a batch large enough to split into multiple slices
can fail mid-way with a leading subset already on disk; those slices will ship, so
re-reporting the same events after a rejection can duplicate them on the server. An empty
`build` (one that emits nothing) writes nothing and ships nothing.

### Identifying the user

`userId` is required - a batch with no user has nowhere to land. It accepts either form:

```typescript
// a 36-char hyphenated UUID
await Keewano.reportUserBatch({ userId: '11111111-1111-4111-8111-111111111111', build });

// or a numeric id (up to 64-bit), passed as a bigint
await Keewano.reportUserBatch({ userId: 1234567890n, build });
```

A numeric id is packed into the last 8 bytes of the user UUID, the same layout the device
SDKs use for `setUserId`, so the backend sees one consistent identity per player. The
all-zero / empty id is rejected.

### The build callback must be synchronous

The reporter is only live for the duration of the `build` call. Keep `build` synchronous
and emit every event inline. Three misuses throw rather than silently mis-attributing
events:

- an `async` build (the SDK rejects the returned promise),
- using the `user` reporter after `build` has returned (a captured reference),
- calling `reportUserBatch` again from inside a `build` (a nested call).

```typescript
// WRONG - the reporter is dead once build returns
let captured;
await Keewano.reportUserBatch({
  userId,
  build: (user) => {
    captured = user;
  },
});
captured.reportInstallCampaign('promo'); // throws

// WRONG - async build is rejected
await Keewano.reportUserBatch({
  userId,
  build: async (user) => {
    await load();
  },
}); // rejects
```

Do any async work - load the data, validate the receipt - BEFORE the call, then emit
synchronously inside `build`.

> [!NOTE]
> Onboarding-milestone dedup is scoped per batch, so the same milestone reported for two
> different users in separate calls never collides.

### Wrap it once

The `userId` + `build` pair is the attribution contract, but you do not have to spell it
out at every call site. Write one thin helper module and call one-liners everywhere:

```typescript
// analytics.ts - written once
import { Keewano, UserReporter } from '@keewano/node-sdk';

export const track = (userId: string | bigint, emit: (user: UserReporter) => void) =>
  Keewano.reportUserBatch({ userId, build: emit });

export const trackPurchase = (userId: string, productName: string, priceUsdCents: number) =>
  track(userId, (user) => {
    user.reportInAppPurchase({ productName, price: { priceUsdCents } });
  });
```

```typescript
// any other module
import { trackPurchase } from './analytics';

await trackPurchase(playerId, 'gold_pack', 499);
```

### Many components, one process

`Keewano` is a process-wide singleton. Call `init` once in your entry point; every other
module just imports `Keewano` (or your helper) and reports - no instance passing, no
wiring. Concurrent `reportUserBatch` calls from different components are safe: each call
assembles its own isolated batch.

Two rules keep components independent:

- Do not call `reportUserBatch` from inside another call's `build` (it throws
  "nested call inside build"). If handler A triggers component B, let B report after A's
  `build` has returned.
- One batch = one logical action of one user. Report per webhook / per action rather
  than accumulating; batches are cheap.

Separate processes (microservices, pm2 cluster workers) each run their own `init` with
their own `dataDir` - see [One `dataDir` = one process](#one-datadir--one-process).

## 4. What you can report

The `user` reporter exposes the event families that make sense server-side. Each one
behaves exactly as it does on the device SDKs - follow the linked guide and read
`Keewano.reportX(...)` there as `user.reportX(...)` here.

| Method(s)                                                     | Guide                                           |
| ------------------------------------------------------------- | ----------------------------------------------- |
| `reportInAppPurchase`, `reportInAppPurchaseItemsGranted`      | [In-App Purchases](in-app-purchases.md)         |
| `reportAdOffered`, `reportAdRevenue`, `reportAdItemsGranted`  | [Ad Revenue](ad-revenue.md)                     |
| `reportSubscriptionRevenue`, `reportSubscriptionItemsGranted` | [Subscription Revenue](subscription-revenue.md) |
| `reportItemsExchange`, `reportItemsReset`                     | [Item Economy](item-economy.md)                 |
| `reportOnboardingMilestone`                                   | [Tutorial Tracking](onboarding.md)              |
| `reportABTestGroupAssignment`                                 | [A/B Tests](ab-testing.md)                      |
| `reportInstallCampaign`, `reportGameLanguage`                 | [Marketing Campaign](install-campaign.md)       |
| `reportCustomEvent`                                           | [Custom Events](custom-events.md)               |
| `logError`                                                    | a free-form error string for this user          |

> [!NOTE]
> UI events (button clicks, windows, screens) and the identity / consent calls are not
> part of the relay surface - they describe one device's session, which a server does not
> have.

## 5. Custom events

Generate a typed schema with `@keewano/codegen`, targeting the Node relay:

```bash
npx keewano-codegen --input keewano-custom-events --target node
```

Pass the generated `customEventSet` to `init` (the send loop registers it once per session,
before the first batch ships), then emit through the generated wrappers - or
`user.reportCustomEvent(...)` directly - inside a `build` callback:

```typescript
import { Keewano } from '@keewano/node-sdk';
import { customEventSet, reportBestScore } from './keewano-custom-events/keewano-events.generated';

await Keewano.init({ apiKey: '...', customEventSet });
await Keewano.reportUserBatch({
  userId,
  build: (user) => reportBestScore(user, 12345),
});
```

The `node` target emits wrappers that take the per-batch `UserReporter` as their first
argument. See [Custom Events](custom-events.md) and the [Codegen Reference](codegen.md).

## 6. Offline and persistence

With the default file-system adapter, every batch is written to disk before any
network attempt, so a crash or a dropped connection does not lose already-persisted
data. If you supply `storage`, that durability guarantee depends on the adapter's
implementation. The send loop retries on its own schedule and the store is bounded by
a size cap. This is the same engine the device SDKs use - see
[Offline Analytics](offline.md) for the full behaviour.

### One `dataDir` = one process

> [!WARNING]
> A `dataDir` must be owned by exactly ONE SDK process at a time. Never point two
> processes - pm2 cluster instances, `cluster` workers, multiple containers sharing a
> volume - at the same directory.

The SDK assumes it is the only reader and writer under its `dataDir`. When two processes
share one directory, each keeps its own batch counter, so they produce colliding file
names and silently overwrite each other's batches; and a batch file both send loops can
see is shipped by both, so the backend receives it twice.

If you run multiple workers, give each one its own directory:

```typescript
// pm2 cluster mode: NODE_APP_INSTANCE is the per-worker index
await Keewano.init({
  apiKey: 'your-project-api-key',
  dataDir: `/var/data/keewano/worker-${process.env.NODE_APP_INSTANCE ?? '0'}`,
});
```

Restarting the same single process is safe: on init the SDK resumes batch numbering
after the highest number already in the directory, so a restart never overwrites or
renumbers batches a previous run left behind.

## 7. Shutting down

The send loop runs for the life of the process; you rarely need to stop it. On a clean
exit, call `shutdown` to stop the send loop and release resources:

```typescript
await Keewano.shutdown();
```

There is nothing buffered to lose: each batch is already on disk by the time
`reportUserBatch` resolves, and anything not yet shipped is picked up by the next run.

`Keewano.isReady()` returns `true` once `init` has resolved. Calling `reportUserBatch`
before that throws ("SDK not initialized"), so `await` your `init` call during process
startup before reporting.

## How it differs from the device SDKs

|              | React Native / Expo                         | Node.js                                              |
| ------------ | ------------------------------------------- | ---------------------------------------------------- |
| Model        | one device, one user                        | one process, many users                              |
| Events       | mostly automatic (taps, screens, lifecycle) | explicit, per user, inside `build`                   |
| Identity     | anonymous install id, then `setUserId`      | `userId` required per batch; install id = project id |
| Consent gate | optional                                    | none                                                 |
| Storage peer | `react-native-fs` / `expo-file-system`      | Node file system (built-in)                          |

---

Related: [In-App Purchases](in-app-purchases.md) | [Custom Events](custom-events.md) | [Offline Analytics](offline.md) | [Data Format](data-format.md)
