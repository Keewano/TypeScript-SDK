[Back to overview](README.md)

# Quick Start

Getting Keewano into your game is easy - this guide takes you from install to your
first events in a few minutes.

## 1. Install

Pick the package that matches your project.

**Expo** (managed or dev-client):

```bash
npm install @keewano/react-native-expo-sdk
```

Expo apps already provide the peers the SDK needs (`expo-file-system` and
`expo-constants`), so there is nothing else to install.

**Bare React Native:**

```bash
npm install @keewano/react-native-sdk react-native-fs
```

`react-native-fs` is the file-system peer used to store batches on disk; run its
autolinking / pod-install step once.

**Browser:**

```bash
npm install @keewano/web-sdk
```

```typescript
import { Keewano } from '@keewano/web-sdk';

Keewano.init({ apiKey: 'your-project-api-key' });
```

No peers to add - the SDK uses the browser's own storage (IndexedDB for the event
queue, localStorage or a first-party cookie for the ids).

For a site with no build step, load the same bundle from a CDN. The package ships an
IIFE build that installs a lowercase `keewano` global:

```html
<script src="https://unpkg.com/@keewano/web-sdk@VERSION/dist/browser/keewano.iife.js"></script>
<script>
  keewano.init({ apiKey: 'your-project-api-key' });
</script>
```

Replace `VERSION` with the version you want. Always pin one: without it the URL resolves
to whatever is newest, so a future release would start running on your pages without you
deploying anything.

To load the bundle asynchronously instead, paste the small command-queue stub before
the `<script async>` tag: it defines `keewano` up front so calls made while the bundle
is still loading are queued and replayed in order once it arrives. Copy the stub from
the [`@keewano/web-sdk` package readme](https://www.npmjs.com/package/@keewano/web-sdk).

> [!NOTE]
> The browser SDK starts behind the consent gate by default - see step 5. Until the
> page grants consent, events are collected and held locally and nothing is sent.

## 2. Configure your project

Call `init` once, early in your app's lifecycle. It is idempotent, so a second call
(such as a Fast Refresh re-render) logs a warning and joins the first one.

```typescript
import { useEffect } from 'react';
import { Keewano } from '@keewano/react-native-expo-sdk';

export default function App() {
  useEffect(() => {
    void Keewano.init({ apiKey: 'your-project-api-key' });
  }, []);

  // ... your app
}
```

`apiKey` is the only required option. The full list - custom endpoint, consent gate,
opt-out flags, custom events - lives in [Configuration](configuration.md).

> [!NOTE]
> As soon as `init` resolves you are already collecting data. App lifecycle, button
> taps, deep links, and errors are tracked automatically; screen tracking is one
> opt-in hook away - see [Automatic Tracking](automatic-tracking.md).

## 3. Identify your players

Each install gets an anonymous id automatically. If your game has its own user id,
associate it once it is known so Keewano can recognise the player across devices.

```typescript
// 36-char hyphenated UUID
Keewano.setUserId('11111111-1111-4111-8111-111111111111');

// or a numeric id
Keewano.setUserId(1234567890n);
```

## 4. Report events

For game-specific moments, call the manual API. Calls are fire-and-forget and never
block the UI: they write to an in-memory buffer and return. They do surface misuse
rather than hide it. On the React Native and Expo SDKs, reporting before `init()` is in
flight or after `shutdown()`, or passing an invalid user id or tester name, throws
synchronously into your call site so the mistake is visible; the Node.js relay rejects
the same kinds of misuse from `reportUserBatch`. On the web SDK a failing call is
logged to the console instead and never propagates into the page.

```typescript
Keewano.reportButtonClick('Play');
Keewano.reportInAppPurchase({ productName: 'gem_pack', price: { priceUsdCents: 499 } });
Keewano.reportOnboardingMilestone('TutorialComplete');
```

Each event family has its own short guide:

- [Windows and Buttons](windows.md)
- [In-App Purchases](in-app-purchases.md) | [Ad Revenue](ad-revenue.md) | [Subscription Revenue](subscription-revenue.md)
- [Item Economy](item-economy.md) | [Tutorial Tracking](onboarding.md) | [Marketing Campaign](install-campaign.md)
- [Custom Events](custom-events.md)

## 5. Respect player privacy

If your game needs explicit consent before sending data, turn on the consent gate and
flip it when the player decides. On the React Native, Expo, and Node.js SDKs the gate
is off by default; on the web SDK it is on by default, so pass
`requirePlayerConsent: false` there where no consent requirement applies.

```typescript
Keewano.init({ apiKey: '...', requirePlayerConsent: true });

// later, once the player agrees / declines:
await Keewano.setUserConsent(true);
```

`setUserConsent` is async and needs `init` to have been started. See
[Data Privacy](privacy.md) for the full consent model.

## 6. Button-click tracking control

Taps on `Pressable`, `TouchableOpacity`, `TouchableHighlight` and
`TouchableWithoutFeedback` are captured automatically on the device SDKs; the web SDK
captures clicks on interactive elements. To opt out - or tune any other auto-tracker -
see [Configuration](configuration.md).

## 7. Integrating into an existing game

Already shipped? See [Integrating into an Existing App](existing-app-integration.md)
for reporting a player's pre-SDK registration date and back-filling identity.

---

Next: [Configuration](configuration.md) | [Automatic Tracking](automatic-tracking.md) | [Custom Events](custom-events.md)
