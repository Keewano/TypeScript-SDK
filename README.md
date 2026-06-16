# keewano-react-native-sdk

React Native + Expo SDK for Keewano AI Analyst.

> **Beta**. API may change before 1.0.0.

## Packages

| Package | Purpose |
|---|---|
| [`@keewano/core`](packages/core/README.md) | Platform-agnostic core (encoding, dispatcher, transport, identity, types). Internal dep, install transitively. |
| [`@keewano/react-native-sdk`](packages/react-native-sdk/README.md) | Bare React Native SDK. Public facade, auto-trackers, `useKeewanoNavigation` for `@react-navigation/native`. |
| [`@keewano/react-native-expo-sdk`](packages/react-native-expo-sdk/README.md) | Expo SDK. Re-exports the bare RN surface plus Expo storage / platform adapters and `useKeewanoNavigation` for `expo-router`. |
| [`@keewano/codegen`](packages/codegen/README.md) | Build-time CLI that turns per-event JSON files into a typed `customEventSet` module the SDK ships to the server. |

End-users install one runtime package plus the codegen tool:

```bash
# Bare React Native
npm install @keewano/react-native-sdk
npm install --save-dev @keewano/codegen

# Expo
npm install @keewano/react-native-expo-sdk
npm install --save-dev @keewano/codegen
```

## Quick start

```ts
import { Keewano } from '@keewano/react-native-sdk'; // or '@keewano/react-native-expo-sdk'

await Keewano.init({ apiKey: 'YOUR_API_KEY' });

Keewano.reportButtonClick('Play');
Keewano.reportSceneLoaded('MainMenu');
Keewano.setUserId('player-42');
```

For typed custom events, declare per-event JSON files, run `npx keewano-codegen --input <dir>`, and pass the produced `customEventSet` into `Keewano.init`. See the [codegen README](packages/codegen/README.md) for the JSON schema, CLI flags, and generated output format.

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

## License

MIT
