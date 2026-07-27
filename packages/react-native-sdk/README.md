# @keewano/react-native-sdk

Bare React Native SDK for Keewano AI Analyst: the public `Keewano` facade, the automatic trackers, and `useKeewanoNavigation` for `@react-navigation/native`.

## Documentation

See the [documentation](https://github.com/Keewano/TypeScript-SDK/blob/main/docs/README.md) for install, configuration, and the full API. For Expo apps use [`@keewano/react-native-expo-sdk`](https://www.npmjs.com/package/@keewano/react-native-expo-sdk) instead.

## Installation

```bash
npm install @keewano/react-native-sdk react-native-fs
```

`react-native-fs` is the storage peer; run its autolinking / pod-install step once.

## Quick start

```typescript
import { Keewano } from '@keewano/react-native-sdk';

await Keewano.init({ apiKey: 'YOUR_API_KEY' });
Keewano.reportButtonClick('Play');
```

## License

MIT
