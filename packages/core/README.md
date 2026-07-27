# @keewano/core

Platform-agnostic core for the Keewano TypeScript SDK: wire-protocol encoding, the event dispatcher, HTTP transport, and identity and consent.

## Documentation

See the [documentation](https://github.com/Keewano/TypeScript-SDK/blob/main/docs/README.md). Install a platform package instead of this one - [`@keewano/react-native-sdk`](https://www.npmjs.com/package/@keewano/react-native-sdk) (bare React Native) or [`@keewano/react-native-expo-sdk`](https://www.npmjs.com/package/@keewano/react-native-expo-sdk) (Expo).

## What's inside

The shared, platform-neutral logic every Keewano TypeScript SDK builds on: byte encoding and binary
streams, the event dispatcher with batching and persistence, the HTTP transport, the
identity and consent state machine, and the `StorageAdapter` interface each platform
package implements. You consume it through a platform package, never directly.

## License

MIT
