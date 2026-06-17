[Back to overview](README.md)

# Automatic Tracking

After `init`, the SDK captures the most useful events with no extra code. This page
lists what is tracked and how to turn any of it off.

## Session start

On every launch the SDK emits a session-context burst: app launch, platform, OS,
RAM, screen resolution, and system language. This is what the backend expects at the
start of each session, so it always fires.

> [!NOTE]
> These read only what pure React Native exposes, so they carry token-level
> granularity (`Platform.OS`, `Platform.Version`, a coarse device class, the IETF
> language tag) rather than exact hardware strings. For richer metadata (exact model,
> OS name) pass a custom `PlatformAdapter` via `Keewano.init({ platform })` - backed by
> `react-native-device-info` on bare RN, or `expo-device` / `expo-application` on Expo.

## Runtime auto-trackers

| Tracker | Captures | Turn off with |
|---|---|---|
| Button taps | taps on `Pressable` components | `disableButtonTracking` |
| App state | foreground / background transitions | `disableAppStateTracking` |
| Back button | the Android hardware back button | `disableBackHandlerTracking` |
| Deep links | links that open your app | `disableLinkingTracking` |
| Errors | uncaught JavaScript errors | `disableErrorTracking` |
| Network | connectivity changes (**opt-in**) | `enableNetworkTracking` to turn ON |

```typescript
Keewano.init({ apiKey: '...', disableBackHandlerTracking: true });
```

> [!IMPORTANT]
> We do not recommend disabling automatic capture without a specific reason. If a
> particular button is not being captured, prefer reporting it manually with
> [`reportButtonClick`](windows.md) over turning the whole patch off.

> [!NOTE]
> Network tracking is the one tracker that is **off** by default, because it needs the
> optional native peer `@react-native-community/netinfo`. Install it and set
> `enableNetworkTracking: true` to opt in.

## Screen tracking

Full-screen route changes (scenes) are not patched automatically - you opt in with the
`useKeewanoNavigation` hook, which emits `SCENE_LOADED` / `SCENE_UNLOADED` as the
player navigates. Pass your navigation library's source into the hook:

```typescript
// Expo Router - @keewano/react-native-expo-sdk
import { usePathname } from 'expo-router';
import { useKeewanoNavigation } from '@keewano/react-native-expo-sdk';

function RootLayout() {
  useKeewanoNavigation(usePathname);
  // ...
}
```

```typescript
// React Navigation - @keewano/react-native-sdk
import { useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { useKeewanoNavigation } from '@keewano/react-native-sdk';

function App() {
  const navigationRef = useRef(null);
  useKeewanoNavigation(navigationRef);
  return <NavigationContainer ref={navigationRef}>{/* ... */}</NavigationContainer>;
}
```

The hook emits `SCENE_LOADED` on the first non-empty route and `SCENE_UNLOADED(previous)`
+ `SCENE_LOADED(next)` on each subsequent change; blank route names are no-op, and the
scene cursor survives Strict Mode / Fast Refresh remounts without duplicate emits. For
modals and in-screen overlays, use [`reportWindowOpen` / `reportWindowClose`](windows.md) instead. If your navigation is custom and the hook does not fit, call `Keewano.reportSceneLoaded(name)` and `Keewano.reportSceneUnloaded(name)` directly.

## Errors

Uncaught JavaScript errors are captured automatically (the `ErrorTracker` listed above). For errors you catch and handle yourself, report them manually:

```typescript
try {
  riskyOperation();
} catch (err) {
  Keewano.logError(String(err));
}
```

## Custom trackers

Need to capture something the built-ins do not - a gesture library, a third-party UI
kit? Implement the `KeewanoTracker` contract and pass it through `plugins`.

```typescript
const myTracker = {
  name: 'paper-button-tracker',
  attach() {
    const subscription = subscribeToMyUiKit(() => Keewano.reportButtonClick('...'));
    return () => subscription.remove(); // detach on shutdown
  },
};

Keewano.init({ apiKey: '...', plugins: [myTracker] });
```

A tracker has a `name`, an `attach()` that wires up its listeners and returns a
`detach` function, and runs until `Keewano.shutdown()`.

---

Related: [Configuration](configuration.md) | [Windows and Buttons](windows.md) | [Event Types](event-types.md)
