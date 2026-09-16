[Back to overview](README.md)

# Browser (Web SDK)

`@keewano/web-sdk` is the browser build of the SDK. It runs inside your page, tracks the
usual behaviour automatically, and posts events to the JSON ingestion API. This page is
the browser-specific starting point; the shared guides linked from each section cover
what is the same on every platform.

Three things differ from the device SDKs and are worth knowing before you start:

- the consent gate is **on** by default, so nothing is sent until the page grants consent;
- `endpoint` is an origin here, not a full ingress base;
- no SDK call can throw into your page. Every `Keewano.*` method is wrapped: an internal
  failure is reported with `console.error` and never propagates (the async methods
  resolve even when they fail).

> [!NOTE]
> Your project API key comes from Keewano. How a key is issued is not covered in these
> guides.

## 1. Install

### With a bundler

```bash
npm install @keewano/web-sdk
```

```typescript
import { Keewano } from '@keewano/web-sdk';

Keewano.init({ apiKey: 'your-project-api-key' });
```

There are no peer dependencies to add - the SDK uses the browser's own storage.

### Without a build step

The package ships an IIFE bundle at a fixed path inside the published package, so any npm
CDN can serve it. The bundle installs a lowercase `keewano` global with the same methods
as the npm import:

```html
<script src="https://unpkg.com/@keewano/web-sdk@VERSION/dist/browser/keewano.iife.js"></script>
<script>
  keewano.init({ apiKey: 'your-project-api-key' });
</script>
```

Replace `VERSION` with the version you want. Always pin one: without it the URL resolves
to whatever is newest, so a future release would start running on your pages without you
deploying anything.

The tag above loads the bundle synchronously, so the global exists by the time the next
script runs.

To load it asynchronously instead, paste the command-queue stub before the async tag: it
defines `keewano` up front, so calls made while the bundle is still in flight are queued
and replayed in order once it arrives. Copy the stub verbatim from the
[`@keewano/web-sdk` package readme](https://www.npmjs.com/package/@keewano/web-sdk) - it
freezes into your HTML with the paste and cannot be hotfixed later.

> [!IMPORTANT]
> Do not write your own `<script async>` tag without that stub. Any `keewano.*` call the
> page makes before the bundle lands would hit an undefined global.

There is no Keewano-hosted bundle URL in these guides.

### Content Security Policy

On a page that enforces CSP, two directives concern the SDK:

- `connect-src` must allow the ingestion host the SDK delivers to:
  `https://api.keewano.com`, or the host you pass as `endpoint`. Without it every
  send is blocked and events accumulate on the client until the policy allows them
  through.
- `script-src` must allow wherever you load the bundle from. With a bundler that
  is your own origin and nothing changes; with the script tag above it is the CDN
  host in the `src`.

No other directive is involved: the SDK injects no styles, frames, workers, or
images, and stores its queue in the page's own IndexedDB.

### Supported browsers

The two delivery channels have different floors, because only one of them is compiled
by us:

- **The prebuilt script bundle** is built with a Safari 15.4 target, so every language
  feature newer than that is transpiled away before it reaches the page. It runs on
  that Safari and on any Chromium or Firefox build that understands the same level of
  JavaScript.
- **The npm package** ships untranspiled modern JavaScript. Its floor is whatever your
  own bundler targets, not ours, because the SDK is compiled as part of your app.

Either way, the one platform feature the SDK depends on is the **Web Locks API**, which
elects a single sending tab per origin ([step 6](#6-many-tabs-one-sender)). Safari added
it in 15.4, which is why the bundle targets that release; test for `navigator.locks` if
you need to know whether some other browser you support has it.

Where it is missing the SDK still collects and still delivers. Each open tab simply runs
its own send loop instead of queueing behind an elected one, so a visitor with several
tabs can send the same events more than once, and the backend deduplicates them.

## 2. Initialise

Call `init` once, as early on the page as you can. `apiKey` is the only required option.

```typescript
Keewano.init({ apiKey: 'your-project-api-key' });
```

`init` returns a promise, but you do not have to await it. Reports issued while init is
in flight are queued and replayed in order once it resolves. On the snippet path,
everything queued before `init` is buffered (up to 1000 calls) and flushed in arrival
order once `init` lands, so call order relative to `init` does not matter there.

A second `init` logs a warning and joins the first one rather than starting a new
session.

> [!NOTE]
> This is a browser SDK. If your framework renders pages on a server (Next.js, Nuxt,
> Remix and similar), call `init` only in the browser - inside an effect, or behind a
> `typeof window !== 'undefined'` check. On the server there is no storage and no page
> to track: the SDK does not crash, but it warns on every render and would report a
> visit that nobody made.

### Options

| Option                      | Type                   | Default                   | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ---------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`                    | `string`               | (required)                | Your project key. It travels as the `k-token` query parameter on the ingestion route - visible in page source like any browser-side key, so treat it as a public project identifier - while the custom-events registration routes take the same key as a `k-token` header instead, and their check route refuses it as a query parameter. An empty key, one with surrounding whitespace, or one carrying control characters or code points above `0xFF` is refused: `init` logs the reason and never starts the send loop. |
| `requirePlayerConsent`      | `boolean`              | `true`                    | Start behind the consent gate. See [step 3](#3-consent-collect-and-hold-by-default).                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `appVersion`                | `string`               | `undefined`               | Your application release version, reported as the `APP_LAUNCH` payload. A browser has no such value to read, so pass it from your build (a bundler-injected constant, a git SHA). Anything that is not a non-empty string is ignored, and the value is truncated to 256 characters. This is your version, not the SDK version, which is reported separately on every request.                                                                                                                                              |
| `endpoint`                  | `string`               | `https://api.keewano.com` | Ingestion host for staging or self-host setups. **Pass an origin**, not a full path: the browser SDK appends its own API paths. This differs from the device SDKs, whose base URL already includes their ingress path.                                                                                                                                                                                                                                                                                                     |
| `storage`                   | `StorageAdapter`       | IndexedDB                 | Custom storage for the queued event batches. The default is IndexedDB, falling back to memory-only when the browser denies it. Identity and consent do not go through this adapter.                                                                                                                                                                                                                                                                                                                                        |
| `customEventSet`            | `CustomEventSet`       | none                      | Your generated custom-events schema. See [step 8](#8-custom-events-on-the-web).                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `plugins`                   | `KeewanoTracker[]`     | none                      | Your own auto-trackers, attached after the built-in ones and detached on shutdown.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `resolveWindowName`         | `(location) => string` | `location.pathname`       | Maps the current location to the reported window name. A resolver that throws, or returns anything but a non-empty string, falls back to the pathname.                                                                                                                                                                                                                                                                                                                                                                     |
| `disableNavigationTracking` | `boolean`              | `false`                   | Turns off the `WINDOW_OPEN` / `WINDOW_CLOSE` tracker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `disableButtonTracking`     | `boolean`              | `false`                   | Turns off the click tracker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `disableErrorTracking`      | `boolean`              | `false`                   | Turns off the uncaught-error and unhandled-rejection tracker.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `disableAppStateTracking`   | `boolean`              | `false`                   | Turns off the tab-visibility tracker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `disableNetworkTracking`    | `boolean`              | `false`                   | Turns off the connectivity tracker.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Two options from the device SDKs do not exist here: there is no `platform` adapter (the
session-start values are read from the browser and cannot be overridden) and no
`getExtraHeaders`. The browser API also has no `getInstallId`: the install id is sent
with every batch but is not readable from the page. Nor is there a
`reportUserRegisteredBeforeSDKIntegration`: the pre-SDK registration back-fill in
[Existing App Integration](existing-app-integration.md) is a React Native and Expo call,
so on the web you link an existing account with `setUserId` and nothing else.

`Keewano.isReady()` returns `true` once `init` has resolved and no `shutdown` has run
since. See [Configuration](configuration.md) for the options shared with the other SDKs.

## 3. Consent: collect and hold by default

On the web, `requirePlayerConsent` defaults to `true` - the opposite of the device SDKs.
A fresh origin therefore boots **Pending**: events are collected and held in browser
storage from the first moment, and nothing is sent.

```typescript
Keewano.setUserConsent(true); // grant: the held data ships, delivery continues
Keewano.setUserConsent(false); // deny: everything held is deleted, nothing is sent
```

What each call does:

- **Grant.** The decision is recorded, the send loop is woken immediately (so held data
  ships now instead of waiting out the idle window), and delivery stays open for the rest
  of the session.
- **Withdrawal.** The in-memory buffers are cleared and every queued batch file is deleted
  right away, not at the next tick. The loop keeps running and keeps dropping whatever is
  reported afterwards, so nothing accumulates behind a denied gate.

Wire the call to your consent banner. It is async and resolves once the decision is
recorded; it needs `init` to have been issued, and a call made before that is logged and
the decision is not recorded. On the snippet path it can be called even earlier, because
it queues like every other method.

Where no consent requirement applies, opt out and events flow immediately:

```typescript
Keewano.init({ apiKey: '...', requirePlayerConsent: false });
```

> [!IMPORTANT]
> The option is read only on the first visit to an origin. After that the recorded
> decision wins and the option is ignored. The decision is also one-shot: once the
> visitor has granted or denied, later `setUserConsent` calls are no-ops.

A decision made in one tab reaches the other open tabs of the same origin: they pick it
up from the storage event, and re-read the record on every visibility change. See
[Data Privacy](privacy.md) for the full consent model.

## 4. What is tracked automatically

Every page load opens with a fixed session-start burst: app launch, platform, device
type, OS, RAM, screen resolution, and system language. It always fires and has no
opt-out. The values are coarse by design (a minimal user-agent read plus `navigator` and
`screen`); RAM is `0` outside Chromium, and app launch carries whatever you pass as
`appVersion`, or `undefined` when you pass nothing, because a browser has no application
version to read.

On top of that:

| Tracker         | Captures                                                                                                                                                                                                               | Turn off with               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Page navigation | `WINDOW_OPEN` / `WINDOW_CLOSE` for the initial page, `pushState` / `replaceState`, `popstate`, and `hashchange`. Only a change of the resolved name emits.                                                             | `disableNavigationTracking` |
| Clicks          | one delegated listener on the document; reports when the clicked element or its nearest matching ancestor is a `button`, `[role="button"]`, `a`, `input[type="button"]`, or `input[type="submit"]` and is not disabled | `disableButtonTracking`     |
| Errors          | uncaught errors and unhandled promise rejections                                                                                                                                                                       | `disableErrorTracking`      |
| Tab visibility  | `APP_PAUSE` when the tab goes hidden, `APP_RESUME` when it comes back                                                                                                                                                  | `disableAppStateTracking`   |
| Connectivity    | the browser's `online` / `offline` events; coming back online also wakes the send loop                                                                                                                                 | `disableNetworkTracking`    |

```typescript
Keewano.init({ apiKey: '...', disableNetworkTracking: true });
```

Two blind spots to plan around:

- **Canvas.** A click inside a `<canvas>` never reaches a qualifying DOM element, so a
  canvas-rendered game gets nothing from the click tracker. Report those with
  `Keewano.reportButtonClick(name)` or your own plugin.
- **Hash routing.** The default window name is `location.pathname`, which ignores the
  hash, so a hash router emits one `WINDOW_OPEN` and nothing after it. Supply a
  `resolveWindowName` that reads `location.hash`.

Pin a stable name to a control whose text changes or is localised with
`data-keewano-name`:

```html
<button data-keewano-name="Play">Spielen</button>
```

The full label-resolution order and the plugin contract are in
[Automatic Tracking](automatic-tracking.md).

## 5. Report your own events

Everything the trackers cannot see, you report yourself. The calls are fire-and-forget
and never block the page.

```typescript
Keewano.setUserId('11111111-1111-4111-8111-111111111111'); // or a numeric id: 1234567890n
Keewano.reportButtonClick('Play');
Keewano.reportInAppPurchase({ productName: 'gem_pack', price: { priceUsdCents: 499 } });
```

Each family has its own guide: [Windows and Buttons](windows.md),
[In-App Purchases](in-app-purchases.md), [Ad Revenue](ad-revenue.md),
[Subscription Revenue](subscription-revenue.md), [Item Economy](item-economy.md),
[Tutorial Tracking](onboarding.md), [A/B Tests](ab-testing.md),
[Marketing Campaign](install-campaign.md).

## 6. Many tabs, one sender

Every tab of your origin collects and persists, but only one of them delivers. The tabs
elect a single sender through the browser's Web Locks API; the tabs that lose the
election run a persist-only loop on the same cadence, writing their events into the
shared queue for the elected tab to ship. Delivery passes to a waiting tab the moment the
holder releases the lock, including when it is killed.

What that means for your data:

- **Nothing is lost by losing the election.** A queued tab still writes to storage on the
  same cadence, so a crash costs it no more than an elected tab.
- **Each tab is its own session.** A fresh session id is minted per page load, so a
  visitor with three tabs open produces three sessions.
- **Order is preserved across tabs.** The elected tab ships the shared queue oldest-first,
  regardless of which tab wrote each batch.
- **Some housekeeping only runs on the elected tab**: the storage-cap sweep, and the
  recurring cleanup of the stored queue while consent is denied. The tab where the
  withdrawal is made still deletes the queue itself at that moment.
- **Where the election cannot be held, the tab delivers on its own.** If the Web Locks API
  is missing, or refuses the request (some WebViews, a storage-partitioned iframe), the
  tab ships rather than going silent; a refused request also logs a warning. Two tabs can
  then send the same events; the backend deduplicates them.

## 7. When the page closes

There is no `shutdown` on a page the visitor is closing, so the SDK hooks `pagehide` and
the tab-hidden visibility change. On that signal it **persists** whatever is still in
memory, so the next visit ships it. The consent gate still rules: a session that has
denied persists nothing, and one still awaiting a decision persists but sends nothing.

It also tries to send those batches immediately, but only when both of these hold:

- nothing else from this session is still queued, because the backend drops a
  lower-numbered batch that arrives after a higher one;
- your declared custom-event schema, if you passed one, is already registered.

When either fails, the exit path persists only and the next visit ships everything in
order. Nothing is deleted on the exit send's account: the stored copies stay, the next
visit resends them, and the backend deduplicates the pair. Batches go out strictly in
order, and only the last one uses the browser's keep-alive channel, which is the only
request shape that survives page teardown.

A page returning from the back/forward cache keeps working: the navigation tracker
reopens the current window and reporting continues.

If you do stop the SDK explicitly, `shutdown` detaches the trackers first (so the closing
`WINDOW_CLOSE` still lands), then flushes what is in memory to storage:

```typescript
await Keewano.shutdown();
```

More on queueing and retries in [Offline Analytics](offline.md).

## 8. Custom events on the web

Declare your events, generate the typed module, and pass its `customEventSet` to `init` -
the same workflow as everywhere else, described in [Custom Events](custom-events.md) and
[Codegen Reference](codegen.md). Use `--target web` so the generated wrappers import from
`@keewano/web-sdk`.

Two browser specifics:

- **Registration gates all delivery.** Once a `customEventSet` is configured, the SDK
  checks with the backend that the schema is known and registers it if not. Until that
  succeeds **nothing is sent at all**, not even built-in events. Batches keep
  accumulating, so a temporary failure costs no data; a permanently rejected schema stalls
  the whole session. If events stop arriving right after you add a `customEventSet`, look
  in the console for a registration warning.
- **The browser registers over the JSON API**, sending the readable event list rather than
  the compressed schema blob the device and Node.js SDKs upload. The generated
  `customEventSet` is identical; only the registration wire shape differs.

> [!NOTE]
> Typed custom events need the npm integration. The generated module comes from a
> build-time CLI, so a site integrated through the script snippet alone has no way to ship
> a `customEventSet`, and `reportCustomEvent` calls are logged and dropped without one.

## 9. Where data is stored, and what clearing site data loses

Everything the SDK keeps is first-party to your origin, spread across three mechanisms:

| Mechanism                 | Holds                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localStorage`            | `keewano.identity` (the anonymous install id and the user id) and `keewano.consent` (the recorded decision)                                                          |
| First-party cookies       | the same two names, written only when `localStorage` is unavailable or rejects the write. `Path=/`, `SameSite=Lax`, a 400-day `Max-Age`, and `Secure` on HTTPS pages |
| IndexedDB (`keewano-sdk`) | the queue of not-yet-sent batches and the QA test-user marker                                                                                                        |

When neither `localStorage` nor cookies are available, the ids and the consent record live
in memory for that page only. When IndexedDB is denied, the queue falls back to memory and
does not survive the page - the SDK logs a warning and keeps running.

Clearing site data removes all of it. On the next visit:

- the visitor gets a **new install id** and counts as a new anonymous user;
- the **consent record is gone**, so the origin boots fresh - Pending under the default,
  and your banner should ask again;
- any **batches not yet delivered are lost**;
- the **test-user marker is gone**, so a QA session has to be marked again.

The SDK sets no third-party cookies and, at runtime, contacts nothing but the Keewano
ingress. See [Data Privacy](privacy.md).

### Storage lifetime

The browser can also clear this data on its own, without the visitor asking it to.
Safari's tracking prevention deletes **all script-writable storage** - `localStorage`,
cookies written from JavaScript, and IndexedDB - after **seven days** without a
first-party interaction with your site. Everything the SDK keeps sits in exactly those
three mechanisms, so a Safari visitor who does not come back within a week returns to
the same state as a cleared origin:

- they get a **new install id**, so a returning visitor is counted as a new anonymous
  user and their earlier activity does not join up with it;
- the **consent record is gone**, so the origin boots Pending again under the default
  and your banner asks someone who has already answered;
- anything **still queued** at that point goes with the database.

That seven-day timer is Safari's policy, not a rule of the web. Other browsers apply
their own rules and evict origin storage under storage pressure, so treat all of it as
durable but not permanent on every browser.

## 10. Limits worth knowing

| Limit              | Value  | What happens at the edge                                                                                                                                                                                                                                        |
| ------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request body       | 100 KB | A batch whose JSON body would exceed it is dropped rather than sent. Batches are cut at 50 KB of payload while they accumulate, so real ones stay well under.                                                                                                   |
| Page-close request | 64 KB  | The keep-alive request the closing page uses has a tighter ceiling, and the browser applies its own budget to the sum of a page's in-flight keep-alive bodies. An oversized or refused one is simply not sent at exit; its stored copy ships on the next visit. |
| Stored queue       | 10 MB  | The oldest oversized batches are replaced in place by a marker recording that a batch was dropped, so gaps are visible instead of silent. The device SDKs cap at 50 MB; browser origin quotas are far tighter.                                                  |

Batches rejected by the backend as permanently unacceptable (HTTP 400, 401, 403, 413) are
dropped rather than retried forever; every other failure is retried. See
[Offline Analytics](offline.md).

## 11. Troubleshooting

| Symptom                                                             | Likely cause                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events are collected but nothing is ever sent                       | The consent gate is Pending, which is the default here. Call `Keewano.setUserConsent(true)`, or pass `requirePlayerConsent: false` where no consent requirement applies.                                                                                              |
| Delivery stopped completely right after adding `customEventSet`     | Schema registration is failing, and it gates everything. Check the console for a registration warning or a configuration error.                                                                                                                                       |
| `Keewano.init: apiKey is empty` or `invalid apiKey` in the console  | The send loop never started. Check for surrounding whitespace, control characters, or non-Latin-1 characters in the key.                                                                                                                                              |
| A console warning that IndexedDB is missing, unusable, or timed out | Private mode or blocked storage. The SDK keeps collecting, but the queue is memory-only and does not survive the page.                                                                                                                                                |
| `SDK is already initialized; ignoring re-init`                      | `init` ran twice (a hot reload, or two copies of your bundle). The second call joins the first; it does not start a second session.                                                                                                                                   |
| `duplicate SDK script detected`                                     | The bundle is on the page twice. The first installed copy keeps the session; the second stands down.                                                                                                                                                                  |
| The same events appear twice for one visitor                        | Expected in two cases: the sender election was unavailable (the console says the tab delivers on its own), or a batch sent during page close was resent from storage on the next visit. The backend deduplicates both.                                                |
| A hash-routed site reports only the first page                      | The default window name ignores the hash. Pass a `resolveWindowName` that reads `location.hash`.                                                                                                                                                                      |
| Clicks in a canvas-rendered game are not captured                   | They never reach a qualifying DOM element. Report them with `reportButtonClick` or a plugin.                                                                                                                                                                          |
| `Keewano.<method>: suppressed error` for a report call              | The call failed and was contained instead of thrown. The usual cause is calling before `init` was issued or after `shutdown`: reports are only buffered while an init is in flight, and outside that window they are logged and dropped. The logged error says which. |
| `batch permanently rejected; dropping`                              | The backend refused that batch for good (400, 401, 403, or 413). Delivery of the rest continues.                                                                                                                                                                      |

---

Related: [Getting Started](getting-started.md) | [Configuration](configuration.md) | [Automatic Tracking](automatic-tracking.md) | [Data Privacy](privacy.md) | [Offline Analytics](offline.md) | [Custom Events](custom-events.md)
