[Back to overview](README.md)

# Automatic Tracking

After `init`, the SDK captures the most useful events with no extra code. This page
lists what is tracked and how to turn any of it off.

## Session start

On every launch the SDK emits a session-context burst: app launch, platform, device
type, OS, RAM, screen resolution, and system language. This is what the backend
expects at the start of each session, so it always fires.

> [!NOTE]
> On the device SDKs these read only what pure React Native exposes, so they carry
> token-level granularity (`Platform.OS`, `Platform.Version`, a coarse device class,
> the IETF language tag) rather than exact hardware strings. For richer metadata
> (exact model, OS name) pass a custom `PlatformAdapter` via
> `Keewano.init({ platform })` - backed by `react-native-device-info` on bare RN, or
> `expo-device` / `expo-application` on Expo.

> [!NOTE]
> On the web SDK the burst fires once per page load and is derived from a deliberately
> minimal user-agent sniff plus `navigator` and `screen`. There is no `platform` option
> on the web, so these values cannot be overridden. Expect: app launch carries the
> `appVersion` you pass to `init`, or `undefined` when you pass nothing (a browser has no
> application version to read); RAM is `0` outside Chromium, which is the only engine
> exposing `navigator.deviceMemory`; screen resolution is CSS pixels, with the device pixel
> ratio deliberately not multiplied in; and iPadOS 13+ sends a desktop user agent, so
> iPads report as macOS desktops.

## Runtime auto-trackers

| Tracker         | Captures                                                                                                                                                         | Turn off with                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Button taps     | taps on `Pressable`, `TouchableOpacity`, `TouchableHighlight` and `TouchableWithoutFeedback` (device SDKs) or delegated clicks on interactive elements (web SDK) | `disableButtonTracking`                                                     |
| App state       | foreground / background transitions (tab visibility on the web SDK)                                                                                              | `disableAppStateTracking`                                                   |
| Back button     | the Android hardware back button (device SDKs only)                                                                                                              | `disableBackHandlerTracking`                                                |
| Deep links      | links that open your app (device SDKs only)                                                                                                                      | `disableLinkingTracking`                                                    |
| Errors          | uncaught JavaScript errors (plus unhandled promise rejections on the web SDK)                                                                                    | `disableErrorTracking`                                                      |
| Page navigation | `WINDOW_OPEN` / `WINDOW_CLOSE` for the initial page, History API navigations, and back / forward (web SDK only)                                                  | `disableNavigationTracking`                                                 |
| Network         | connectivity changes (**opt-in** on the device SDKs, on by default on the web SDK)                                                                               | `enableNetworkTracking` to turn ON (device); `disableNetworkTracking` (web) |

```typescript
Keewano.init({ apiKey: '...', disableBackHandlerTracking: true });
```

> [!IMPORTANT]
> We do not recommend disabling automatic capture without a specific reason. If a
> particular button is not being captured, prefer reporting it manually with
> [`reportButtonClick`](windows.md) over turning the whole patch off.

> [!NOTE]
> On the device SDKs, network tracking is the one tracker that is **off** by default,
> because it needs the optional native peer `@react-native-community/netinfo`. Install
> it and set `enableNetworkTracking: true` to opt in. The web SDK uses the browser's
> free `online` / `offline` events instead, so there the tracker is on by default and
> `disableNetworkTracking` turns it off.

## Clicks on the web

The web tracker is not "every click". It listens once on the document and reports only
when the clicked element - or its nearest matching ancestor - is a `button`, an element
with `role="button"`, an `a`, an `input[type="button"]`, or an `input[type="submit"]`,
and is not `disabled` or `aria-disabled="true"`. A click that matches nothing is
ignored.

The reported name is the first of these that yields a non-empty value:

1. the element's `data-keewano-name` attribute
2. its `aria-label`
3. its trimmed text content
4. its `id`
5. its lowercased tag name

`data-keewano-name` is the way to pin a stable name to a control whose text changes or
is localised:

```html
<button data-keewano-name="Play">Spielen</button>
```

> [!IMPORTANT]
> Clicks inside a `<canvas>` never reach a qualifying DOM element, so a canvas-rendered
> game gets nothing from this tracker. Report those through
> [`reportButtonClick`](windows.md) or your own [custom tracker](#custom-trackers).

## Screen tracking

On the device SDKs, full-screen route changes (scenes) are not patched automatically -
you opt in with the `useKeewanoNavigation` hook, which emits `SCENE_LOADED` /
`SCENE_UNLOADED` as the player navigates. Pass your navigation library's source into
the hook:

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
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { useKeewanoNavigation } from '@keewano/react-native-sdk';

function App() {
  const navigationRef = useNavigationContainerRef();
  useKeewanoNavigation(navigationRef);
  return (
    <NavigationContainer ref={navigationRef}>
      <RootStack />
    </NavigationContainer>
  );
}
```

The hook emits `SCENE_LOADED` on the first non-empty route and `SCENE_UNLOADED(previous)`

- `SCENE_LOADED(next)` on each subsequent change; blank route names are no-op, and the
  scene cursor survives Strict Mode / Fast Refresh remounts without duplicate emits. For
  modals and in-screen overlays, use [`reportWindowOpen` / `reportWindowClose`](windows.md) instead. If your navigation is custom and the hook does not fit, call `Keewano.reportSceneLoaded(name)` and `Keewano.reportSceneUnloaded(name)` directly.

## Page tracking on the web

On the web SDK this needs no hook: the navigation tracker emits `WINDOW_OPEN` for the
initial page and then closes the previous window and opens the next one on every
`pushState` / `replaceState`, `popstate`, and `hashchange`. Every signal funnels into
one comparison of the **resolved** window name, so a navigation that resolves to the
same name emits nothing.

> [!IMPORTANT]
> The default resolver is `location.pathname`, which ignores the hash. A hash router
> (`/#/level/1` -> `/#/shop`) keeps the same pathname, so after the first `WINDOW_OPEN`
> nothing is emitted. If you use hash routing, supply a `resolveWindowName` that reads
> `location.hash`:
>
> ```typescript
> Keewano.init({
>   apiKey: '...',
>   resolveWindowName: (location) => location.hash.replace(/^#/, '') || '/',
> });
> ```

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
`detach` function, and runs until `Keewano.shutdown()`. `attach()` may also return a
subscription object with a callable `remove()` instead of a bare function - the SDK
accepts either. Anything else is logged as a misconfiguration and the tracker's
listeners will outlive shutdown.

A tracker may also declare `criticalPath: true`. By default a throw from `attach()` is
logged and swallowed so one broken plugin cannot stop the SDK from booting; with
`criticalPath` set, the same throw fails `Keewano.init()`. Use it only for a tracker
whose absence would make the session record wrong.

```typescript
const myTracker = {
  name: 'paper-button-tracker',
  criticalPath: false,
  attach() {
    const subscription = subscribeToMyUiKit(() => Keewano.reportButtonClick('...'));
    return () => subscription.remove();
  },
};
```

---

Related: [Configuration](configuration.md) | [Windows and Buttons](windows.md) | [Event Types](event-types.md)
