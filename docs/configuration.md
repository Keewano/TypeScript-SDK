[Back to overview](README.md)

# Configuration

Everything you pass to `Keewano.init`. Only `apiKey` is required - the rest have
sensible defaults.

```typescript
Keewano.init({
  apiKey: 'your-project-api-key',
  // ...optional fields below
});
```

## Core

| Option | Type | Default | What it does |
|---|---|---|---|
| `apiKey` | `string` | (required) | Your project key, sent as the `K-Token` header. |
| `endpoint` | `string` | production URL | Override the ingress URL. Useful for staging or self-host. |
| `requirePlayerConsent` | `boolean` | `false` | Start behind a consent gate. See [Data Privacy](privacy.md). |
| `customEventSet` | `CustomEventSet` | none | Your generated custom-events schema. See [Custom Events](custom-events.md). |

## Opt out of automatic tracking

Every auto-tracker is on by default (except network, which is opt-in). Set any of
these to turn one off.

| Flag | Turns off |
|---|---|
| `disableButtonTracking` | the `Pressable` button-tap patch |
| `disableAppStateTracking` | the foreground / background listener |
| `disableBackHandlerTracking` | the Android hardware back-button listener |
| `disableLinkingTracking` | the deep-link listener |
| `disableErrorTracking` | the global uncaught-error handler |
| `enableNetworkTracking` | **opt-in** - turn connectivity tracking ON |

```typescript
Keewano.init({
  apiKey: '...',
  disableBackHandlerTracking: true,
  enableNetworkTracking: true, // needs the @react-native-community/netinfo peer
});
```

> [!IMPORTANT]
> We do not recommend disabling automatic capture without a specific reason - it is
> the cheapest, most complete signal you get for free.

> [!NOTE]
> `enableNetworkTracking` is the only auto-tracker that needs an extra native peer
> (`@react-native-community/netinfo`). Install it and set the flag; otherwise the SDK
> never probes for it. See [Automatic Tracking](automatic-tracking.md).

## Advanced

| Option | Type | What it does |
|---|---|---|
| `getExtraHeaders` | `() => Record<string,string> \| Promise<...>` | Extra HTTP headers on every request (e.g. an auth token for a proxy in front of staging). Resolved once per send cycle, so a short-lived token can refresh. Reserved `K-*` / `Content-*` headers always win. |
| `storage` | `StorageAdapter` | Custom on-disk storage. Defaults to the platform adapter that ships with your package. |
| `platform` | `PlatformAdapter` | Custom source for device info. Defaults to React Native's `Platform` / `Dimensions`. |
| `plugins` | `KeewanoTracker[]` | Your own auto-trackers, attached after the built-ins. See [Automatic Tracking](automatic-tracking.md#custom-trackers). |

```typescript
Keewano.init({
  apiKey: '...',
  endpoint: 'https://staging.example.com/ingress',
  getExtraHeaders: () => ({ Authorization: `Bearer ${getToken()}` }),
});
```

## Lifecycle helpers

A few methods help you manage the SDK at runtime:

- `Keewano.shutdown()` - stop the SDK and flush in-memory events to disk. Rarely needed; the send loop runs for the life of the app.
- `Keewano.isReady()` - `true` once `init` has resolved. Reporting methods queue before then, so you usually do not need to check it.
- `Keewano.getInstallId()` - resolves to the anonymous install id (a lowercase hyphenated UUID), handy for support and cross-referencing a session.

```typescript
const installId = await Keewano.getInstallId();
```

---

Related: [Automatic Tracking](automatic-tracking.md) | [Custom Events](custom-events.md) | [Data Privacy](privacy.md)
