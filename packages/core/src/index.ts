/**
 * `@keewano/core` - the platform-agnostic core of the Keewano TypeScript SDK.
 *
 * Aggregates every public primitive of the package: wire encoding,
 * event entities, the dispatcher, the storage-adapter contract, batch
 * persistence, the HTTP transport, and the identity / consent state.
 * Platform packages (`@keewano/react-native-sdk`,
 * `@keewano/react-native-expo-sdk`) build their public `Keewano`
 * facade on top of these exports.
 *
 * Each line re-exports a curated sub-barrel; the curation of the
 * public surface lives in those per-module `index.ts` files.
 */
export * from './encoding';
export * from './events';
export * from './dispatcher';
export * from './storage';
export * from './persistence';
export * from './network';
export * from './consent';
export * from './identity';
export * from './validation';
