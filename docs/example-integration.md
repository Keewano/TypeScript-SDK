[Back to overview](README.md)

# Step-by-Step Example Integration

This walkthrough wires the SDK into a small Expo game from scratch. By the end you are
tracking sessions, screens, a purchase, and a custom event.

## 1. Install and initialise

```bash
npm install @keewano/react-native-expo-sdk
```

Initialise once in your root component:

```typescript
import { useEffect } from 'react';
import { Keewano } from '@keewano/react-native-expo-sdk';

export default function App() {
  useEffect(() => {
    void Keewano.init({ apiKey: 'your-project-api-key' });
  }, []);

  return <RootNavigator />;
}
```

At this point session context, button taps, and errors are already being captured.

## 2. Track screens

Add the navigation hook so screen changes become `SCENE_LOADED` / `SCENE_UNLOADED`:

```typescript
import { usePathname } from 'expo-router';
import { useKeewanoNavigation } from '@keewano/react-native-expo-sdk';

function RootLayout() {
  useKeewanoNavigation(usePathname);
  // ...
}
```

## 3. Report a purchase

In your buy handler, report the purchase once the store confirms it:

```typescript
async function onBuyGems() {
  const result = await store.purchase('gem_pack_large');
  if (result.ok) {
    Keewano.reportInAppPurchase({
      productName: 'gem_pack_large',
      price: { priceUsdCents: 499 },
    });
    Keewano.reportInAppPurchaseItemsGranted({
      productName: 'gem_pack_large',
      items: [{ name: 'gems', count: 500 }],
    });
  }
}
```

## 4. Track progression

Report onboarding milestones as the player advances:

```typescript
Keewano.reportOnboardingMilestone('TutorialComplete');
```

## 5. Add a custom event

Declare your own events, generate typed helpers, and call them:

```bash
npx keewano-codegen --input keewano-custom-events
```

```typescript
import { customEventSet, reportGameScore } from '../keewano-custom-events/keewano-events.generated';

// pass the schema at init
Keewano.init({ apiKey: '...', customEventSet });

// report it anywhere, fully typed
reportGameScore(13050);
```

See [Custom Events](custom-events.md) for the full workflow.

## 6. Verify

Mark your own session as a test user and check the events arrive - see
[Integration Testing](integration-testing.md).

```typescript
Keewano.markAsTestUser('dev');
```

---

Related: [Getting Started](getting-started.md) | [Integration Testing](integration-testing.md) | [Existing App Integration](existing-app-integration.md)
