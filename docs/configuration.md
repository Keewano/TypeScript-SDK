[Back to overview](README.md)

# Configuration

Everything you pass to `Keewano.init`. On the device and web SDKs only `apiKey` is
required and the rest have sensible defaults; the Node.js relay also needs a `dataDir`
(or your own `storage`), which has no default on purpose - see the
[Node.js guide](nodejs.md).

```typescript
Keewano.init({
  apiKey: 'your-project-api-key',
  // ...optional fields below
});
```

## Core

| Option                 | Type             | Default                               | What it does                                                                                                                                                                                                  |
| ---------------------- | ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`               | `string`         | (required)                            | Your project key. The device SDKs send it as the `K-Token` header; the web SDK sends it as a query parameter, where it is visible in page source like any browser-side key.                                   |
| `appVersion`           | `string`         | platform value (web SDK: `undefined`) | Web SDK only. Your application release version, reported as the app-launch event. A browser has no version to read, so pass it from your build; the device SDKs read it from the platform and take no option. |
| `endpoint`             | `string`         | production URL                        | Override the ingress URL. Useful for staging or self-host. The web SDK expects an origin here (it appends its own API paths); the device SDKs expect the full ingress base.                                   |
| `requirePlayerConsent` | `boolean`        | `false` (web SDK: `true`)             | Start behind a consent gate. See [Data Privacy](privacy.md).                                                                                                                                                  |
| `customEventSet`       | `CustomEventSet` | none                                  | Your generated custom-events schema. See [Custom Events](custom-events.md).                                                                                                                                   |

## Opt out of automatic tracking

Every auto-tracker is on by default, with one exception: on the device SDKs
(React Native / Expo), network tracking is opt-in. On the web SDK network tracking
is on by default like the rest. Set any of these to turn one off.

| Flag                         | Turns off                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `disableButtonTracking`      | the button-tap tracker: the `Pressable` / `Touchable*` patch on the device SDKs, the delegated click listener on the web SDK                 |
| `disableAppStateTracking`    | the foreground / background listener (tab visibility on the web SDK)                                                                         |
| `disableBackHandlerTracking` | the Android hardware back-button listener (device SDKs only)                                                                                 |
| `disableLinkingTracking`     | the deep-link listener (device SDKs only)                                                                                                    |
| `disableErrorTracking`       | the global uncaught-error handler (on the web SDK it also covers unhandled promise rejections)                                               |
| `disableNavigationTracking`  | the page-navigation tracker: `WINDOW_OPEN` / `WINDOW_CLOSE` for the initial page, History API navigations, and back / forward (web SDK only) |
| `enableNetworkTracking`      | **opt-in, device SDKs only** - turn connectivity tracking ON                                                                                 |
| `disableNetworkTracking`     | the connectivity listener (web SDK only, where it is on by default)                                                                          |

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
> Network tracking differs per platform. On the device SDKs it is the only auto-tracker
> that needs an extra native peer (`@react-native-community/netinfo`); install it and
> set `enableNetworkTracking: true`, otherwise the SDK never probes for it. On the web
> SDK the browser's `online` / `offline` events are free, so the tracker is on by
> default and `disableNetworkTracking` turns it off. See
> [Automatic Tracking](automatic-tracking.md).

## Advanced

| Option              | Type                                          | What it does                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getExtraHeaders`   | `() => Record<string,string> \| Promise<...>` | Device and Node.js SDKs; not on the web, where the page-close request cannot carry custom headers. Extra HTTP headers on every request (e.g. an auth token for a proxy in front of staging). Resolved once per send cycle, so a short-lived token can refresh. Reserved `K-*` / `Content-*` headers always win.                                                                                        |
| `storage`           | `StorageAdapter`                              | Custom storage for the queued event batches. Defaults to the platform adapter that ships with your package: files on the device SDKs, IndexedDB on the web (falling back to memory-only when the browser denies it). On the web SDK the install id and consent record do **not** go through this adapter - they persist through the localStorage / cookie ladder so they survive an evicted IndexedDB. |
| `platform`          | `PlatformAdapter`                             | Device SDKs only. Custom source for device info. Defaults to React Native's `Platform` / `Dimensions`.                                                                                                                                                                                                                                                                                                 |
| `plugins`           | `KeewanoTracker[]`                            | Your own auto-trackers, attached after the built-ins. See [Automatic Tracking](automatic-tracking.md#custom-trackers).                                                                                                                                                                                                                                                                                 |
| `resolveWindowName` | `(location) => string`                        | Web SDK only. Maps the current location to the window name the page-navigation tracker reports. Defaults to `location.pathname`; override to collapse dynamic segments (`/game/123` -> `game`). A resolver that throws, returns a non-string, or returns an empty string falls back to `location.pathname` - there is no way to suppress a page by returning an empty name.                            |

On the device and Node.js SDKs - `getExtraHeaders` is not part of the web config, and
passing it there is a compile error:

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
- `Keewano.getInstallId()` - **React Native and Expo SDKs only**. Resolves to the anonymous install id (a lowercase hyphenated UUID), handy for support and cross-referencing a session. The web and Node.js SDKs do not expose it: the id is sent with every batch but is not readable from the host.

```typescript
const installId = await Keewano.getInstallId();
```

---

Related: [Automatic Tracking](automatic-tracking.md) | [Custom Events](custom-events.md) | [Data Privacy](privacy.md)
