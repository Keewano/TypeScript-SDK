# @keewano/react-native-expo-sdk

Expo SDK for Keewano AI Analyst: the full `@keewano/react-native-sdk` API plus Expo adapters - `expo-file-system` storage and `useKeewanoNavigation` for Expo Router.

## Documentation

See the [documentation](../../docs/README.md) for install, configuration, and the full API. For bare React Native apps use [`@keewano/react-native-sdk`](../react-native-sdk/README.md) instead.

## Installation

```bash
npm install @keewano/react-native-expo-sdk
```

The storage peer (`expo-file-system`) ships with Expo, so there is nothing else to install.

## Quick start

```typescript
import { Keewano } from '@keewano/react-native-expo-sdk';

await Keewano.init({ apiKey: 'YOUR_API_KEY' });
Keewano.reportButtonClick('Play');
```

## License

MIT
