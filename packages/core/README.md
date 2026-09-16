# @keewano/core

Platform-agnostic core for the Keewano TypeScript SDK: wire-protocol encoding, the event dispatcher, HTTP transport, and identity and consent.

## Documentation

See the [documentation](https://github.com/Keewano/TypeScript-SDK/blob/main/docs/README.md). Install a platform package instead of this one - [`@keewano/react-native-sdk`](https://www.npmjs.com/package/@keewano/react-native-sdk) (bare React Native), [`@keewano/react-native-expo-sdk`](https://www.npmjs.com/package/@keewano/react-native-expo-sdk) (Expo), [`@keewano/node-sdk`](https://www.npmjs.com/package/@keewano/node-sdk) (Node.js server relay), or [`@keewano/web-sdk`](https://www.npmjs.com/package/@keewano/web-sdk) (browsers).

## What's inside

The shared, platform-neutral logic every Keewano TypeScript SDK builds on: byte encoding and binary
streams, the event dispatcher with batching and persistence, the HTTP transport, the
identity and consent state machine, and the `StorageAdapter` interface each platform
package implements. You consume it through a platform package, never directly.

The type declarations reference the standard `fetch` types (`Response`,
`RequestInit`, `AbortSignal`), so a TypeScript project compiling against this
package needs them in scope: the `dom` lib in the browser, `@types/node` on
Node, or React Native's own globals. Every platform package's environment
already provides one of these.

## License

MIT
