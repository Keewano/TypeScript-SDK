# @keewano/react-native-expo-sdk

Expo SDK for Keewano AI Analyst.

> Beta. API may change before 1.0.0.

For Bare React Native apps (without Expo) install [`@keewano/react-native-sdk`](../react-native-sdk/README.md) directly; this package re-exports its API plus Expo-specific adapters.

## Install

```bash
npm install @keewano/react-native-expo-sdk
```

Peer dependencies your host app must provide:

- `react`
- `react-native`
- `expo-file-system` (used by the default storage adapter)
- `expo-application`, `expo-device`, `expo-localization` (optional; used to enrich the initial event burst when present)
- `expo-router` (optional; required only when using `useKeewanoNavigation`)
- `@react-native-community/netinfo` (optional; required only when you opt in to network tracking)

## Quick start

```ts
import { Keewano } from '@keewano/react-native-expo-sdk';

await Keewano.init({ apiKey: 'YOUR_API_KEY' });
Keewano.reportButtonClick('Play');
```

The full public API matches [`@keewano/react-native-sdk`](../react-native-sdk/README.md) - see that README for the `report*` surface, config options, auto-trackers, and plugin contract. This package adds:

- A default `StorageAdapter` backed by `expo-file-system`. `Keewano.init({ apiKey })` from this package uses it automatically, so Expo managed apps do not need `react-native-fs`. Override it by passing `storage` explicitly.
- `useKeewanoNavigation(usePathname)` for Expo Router.

The initial-event metadata burst (PLATFORM, OS, DEVICE_TYPE, ...) is read from React Native's `Platform` / `Dimensions`, which work under Expo. For richer device metadata (exact model, OS name) wire a custom `PlatformAdapter` via `Keewano.init({ platform })` backed by `expo-device` / `expo-application`.

## Navigation

Pass `expo-router`'s `usePathname` into the hook so the SDK stays out of your static dependency graph:

```tsx
import { Stack, usePathname } from 'expo-router';
import { useKeewanoNavigation } from '@keewano/react-native-expo-sdk';

export default function RootLayout() {
  useKeewanoNavigation(usePathname);
  return <Stack />;
}
```

The hook emits `SCENE_LOADED` on the first non-empty pathname and `SCENE_UNLOADED(previous)` + `SCENE_LOADED(next)` on every subsequent change. Empty / blank pathnames are no-op. The runtime-scoped scene cursor (`readSceneCursor` / `writeSceneCursor` re-exported from `@keewano/react-native-sdk`) survives Strict Mode and Fast Refresh remounts without duplicate emits.

## License

MIT
