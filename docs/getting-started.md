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

Expo apps already provide the peer the SDK needs (`expo-file-system`), so there is
nothing else to install.

**Bare React Native:**

```bash
npm install @keewano/react-native-sdk react-native-fs
```

`react-native-fs` is the file-system peer used to store batches on disk; run its
autolinking / pod-install step once.

## 2. Configure your project

Call `init` once, early in your app's lifecycle. It is idempotent, so a second call
(such as a Fast Refresh re-render) is simply ignored.

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
> taps, screens, and errors are tracked automatically - see [Automatic Tracking](automatic-tracking.md).

## 3. Identify your players

Each install gets an anonymous id automatically. If your game has its own user id,
associate it once it is known so Keewano can recognise the player across devices.

```typescript
// 36-char hyphenated GUID
Keewano.setUserId('11111111-1111-4111-8111-111111111111');

// or a numeric id
Keewano.setUserId(1234567890n);
```

## 4. Report events

For game-specific moments, call the manual API. Every method is fire-and-forget - it
never throws into your call site and never blocks the UI.

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
flip it when the player decides.

```typescript
Keewano.init({ apiKey: '...', requirePlayerConsent: true });

// later, once the player agrees / declines:
Keewano.setUserConsent(true);
```

See [Data Privacy](privacy.md) for the full consent model.

## 6. Button-click tracking control

Button taps on `Pressable` are captured automatically. You can turn this off if you
prefer to report clicks yourself.

```typescript
Keewano.init({ apiKey: '...', disableButtonTracking: true });
```

> [!IMPORTANT]
> We do not recommend disabling automatic capture unless you have a specific reason -
> it is the cheapest, most complete signal you get for free.

## 7. Integrating into an existing game

Already shipped? See [Integrating into an Existing App](existing-app-integration.md)
for reporting a player's pre-SDK registration date and back-filling identity.

---

Next: [Configuration](configuration.md) | [Automatic Tracking](automatic-tracking.md) | [Custom Events](custom-events.md)
