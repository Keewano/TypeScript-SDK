[Back to overview](README.md)

# Event Types

A map of everything the SDK can send, grouped by how it is produced. Most of these
fire automatically; the rest you report through the manual API.

## Automatic

Captured for you after `init` - see [Automatic Tracking](automatic-tracking.md).

| Group | Events |
|---|---|
| Session context | app launch, platform, device type, OS, RAM, screen resolution, system language |
| App lifecycle | app pause, app resume |
| Input | button click (`Pressable` / `Touchable*`, or a web click), Android back button |
| Navigation | scene loaded / unloaded on the device SDKs (via `useKeewanoNavigation`); window open / close on the web SDK (initial page, History API, back / forward) |
| Deep links | deep link activated |
| Errors | error message (uncaught JS errors) |
| Network | internet connected / disconnected (opt-in) |

## Manual

Reported by you through `Keewano.report*` - one short guide each:

| Group | Events | Guide |
|---|---|---|
| Windows | window open / close (also emitted automatically by the web SDK's navigation tracker) | [Windows and Buttons](windows.md) |
| Progression | onboarding milestone, A/B test assignment | [Tutorial Tracking](onboarding.md) |
| Attribution | install campaign, game language | [Marketing Campaign](install-campaign.md) |
| Purchases | product id, price, timestamp, items granted | [In-App Purchases](in-app-purchases.md) |
| Ads | ad offered, ad revenue, items granted | [Ad Revenue](ad-revenue.md) |
| Subscriptions | revenue, items granted | [Subscription Revenue](subscription-revenue.md) |
| Economy | items exchange, items reset | [Item Economy](item-economy.md) |
| Identity | user id assigned, pre-SDK registration date | [Existing App Integration](existing-app-integration.md) |

## Custom

Events you declare yourself, on top of the built-ins. See [Custom Events](custom-events.md).

> [!NOTE]
> Some identifiers exist in the shared wire protocol but are never emitted by this SDK.
> A few have no pure-JavaScript equivalent (GPU type, VRAM size, memory warning,
> genuinity check); others are derived server-side or belong to other Keewano SDKs
> (session start / end, country, day-in-game, pointer and empty-space events). They are
> reserved so the wire format stays compatible across all Keewano SDKs.

---

Related: [Automatic Tracking](automatic-tracking.md) | [Custom Events](custom-events.md) | [Data Format](data-format.md)
