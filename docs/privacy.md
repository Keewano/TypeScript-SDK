[Back to overview](README.md)

# Data Privacy

The SDK is built to respect player consent. The device SDKs start collecting
immediately by default; turn on the consent gate and nothing leaves the device until
the player agrees. The web SDK boots with the gate already on (`requirePlayerConsent`
defaults to `true` there) - pass `false` to opt out where no consent requirement
applies.

## What is collected

Every session opens with a fixed environment burst: app version (on the web this is the
`appVersion` you pass to `init`, or `undefined` when you pass nothing), platform, device
type, OS, RAM, screen resolution, and system language. These are coarse tokens read from
the platform's own APIs, not exact hardware strings.

On top of that, the automatic trackers collect:

- button and click names - the label the SDK can read from the control
- page names on the web SDK (from the location), and screen names on the device SDKs
  if you opt into the navigation hook
- app lifecycle transitions, deep-link opens (device SDKs), and connectivity changes
- uncaught JavaScript error messages, including their stack traces

Anything else is what you report yourself through the manual and custom-event APIs -
window names, purchase and ad data, milestones, and your own event payloads. All of
those strings are labels you choose, so keep personal data out of them.

Alongside the events, each batch carries an anonymous install id, the user id if you
set one, and a session id. See [Automatic Tracking](automatic-tracking.md) and
[Event Types](event-types.md) for the full list.

## The consent gate

Pass `requirePlayerConsent: true` to hold all sending until the player decides.

```typescript
Keewano.init({ apiKey: '...', requirePlayerConsent: true });
```

> [!IMPORTANT]
> This option is read only on the first launch of an install (on the web, the first
> visit to an origin). After that the state recorded on the device wins and the option
> is ignored. Turning the gate on in a later release does **not** retroactively gate
> installs already recorded as `Not required`, and turning it off does not release
> installs already recorded as `Pending`. To change the gate for existing users, drive
> the decision through `setUserConsent` instead.

While the gate is pending, events are still collected and stored locally - they are
just not sent. Once the player decides, flip the gate:

```typescript
// player agreed
await Keewano.setUserConsent(true);

// player declined
await Keewano.setUserConsent(false);
```

Call it only after `Keewano.init` has been started. A call made before init (or after
`shutdown`) is rejected on the device SDKs and logged-and-dropped on the web SDK; the
decision is not recorded either way.

| State        | How you reach it                                                                               | What happens                                           |
| ------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Not required | device SDKs: `requirePlayerConsent` omitted or `false`; web SDK: `requirePlayerConsent: false` | events flow immediately                                |
| Pending      | device SDKs: `requirePlayerConsent: true`; web SDK: option omitted or `true`; no decision yet  | events are collected and held locally, nothing is sent |
| Granted      | `setUserConsent(true)`                                                                         | the events still held plus all future events are sent  |
| Denied       | `setUserConsent(false)`                                                                        | queued events are deleted, nothing is sent             |

The held queue is capped like any other (50 MB device, 10 MB web). A gate left pending
long enough to fill the cap will have its oldest held batches replaced by drop markers
before a grant can ship them. See [Offline Analytics](offline.md).

> [!IMPORTANT]
> Denial is real deletion: when the player declines, the queued stored batches are
> removed, not just held. The first decision is final for this install: once the state
> is Granted or Denied, later `setUserConsent` calls are no-ops.

> [!NOTE]
> A consent decision takes effect immediately in memory and is saved to disk
> best-effort. In the rare case that write fails, the decision still holds for the
> current session; the next launch falls back to `Pending` (the conservative default)
> and re-prompts.

### Withdrawing consent after a grant

There is no way back from `Granted`. `setUserConsent(false)` on an install that has
already granted returns with the state unchanged and keeps sending, and the SDK
exposes no call that deletes data already collected or already delivered. If your app
needs a working "withdraw consent" control, do not wire it to `setUserConsent` alone -
stop calling the SDK, or handle the erasure outside it.

## What is stored locally

The SDK keeps a small amount of state in your app's private storage:

- an anonymous install id and (if you set one) the user id
- the current consent state
- the queue of not-yet-sent event batches
- the QA test-user marker, once you call `markAsTestUser`
- a one-shot marker recording that a pre-SDK registration date was already reported
  (device SDKs only, written by `reportUserRegisteredBeforeSDKIntegration`)

There is no third-party storage: on the device SDKs everything stays inside your app's
sandbox, and on the web everything is first-party to your origin.

In the browser that state is spread across three first-party mechanisms:

- `localStorage`, under the keys `keewano.identity` (install id and user id) and
  `keewano.consent` (the consent record)
- first-party cookies holding the same two values, written only when `localStorage`
  is unavailable or rejects the write, with `Path=/`, `SameSite=Lax`, a 400-day
  `Max-Age`, and `Secure` on HTTPS pages. On HTTPS the cookie names carry the
  `__Host-` prefix - `__Host-keewano.identity` and `__Host-keewano.consent` - which
  makes the browser refuse a same-named cookie set by any sibling host under a
  shared parent domain; on plain HTTP, where the prefix is not accepted, the names
  stay `keewano.identity` and `keewano.consent`
- an IndexedDB database holding the queued event batches and the test-user marker;
  when the browser denies IndexedDB the queue falls back to memory only and does not
  survive the page

When neither `localStorage` nor cookies are available, the ids and consent record live
in memory for that page only.

The SDK sets no third-party cookies and, at runtime, contacts nothing but the Keewano
ingress.

## Test users

To mark a session's data as coming from a QA tester (so you can filter it in the
dashboard), tag it once:

```typescript
Keewano.markAsTestUser('qa-team');
```

From that call on, every batch this install ships is tagged - including batches
collected earlier that are still waiting in the queue, so mark the session before you
start testing rather than after. The marker persists across restarts (on the web it
lives in the same browser storage as the event queue, so it does not survive a
private-mode session where that storage is unavailable).

> [!IMPORTANT]
> The marker is one-way: there is no call that clears it. It stays until the storage
> is cleared - a reinstall on the device SDKs, clearing site data in the browser - so
> never call it in a build a real player runs.

`markAsTestUser` rejects an unusable name: an empty string, one longer than 256
characters, one containing control characters, or one containing any code point above
`0xFF`. On the React Native and Expo SDKs that rejection throws into your call site; on
the web SDK it is logged instead.

---

Related: [Configuration](configuration.md) | [Automatic Tracking](automatic-tracking.md) | [Event Types](event-types.md) | [Offline Analytics](offline.md) | [Getting Started](getting-started.md)
