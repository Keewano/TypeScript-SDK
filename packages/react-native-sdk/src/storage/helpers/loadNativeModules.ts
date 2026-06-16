/**
 * Lazy loader for the native module `react-native-fs`. Kept out of the
 * adapter's import block so the native bindings are not resolved until
 * a `BareRNStorageAdapter` is actually instantiated without a test
 * override - host applications that never construct the adapter pay no
 * startup cost.
 *
 * Not exercised by unit tests because the native module is not
 * installed in the jest runtime; the adapter tests always pass a mock
 * override instead.
 */

import type { RNFSLike } from '../types/nativeStorageAdapter';

/**
 * `require` is provided by the React Native / Node runtime but is not
 * part of the SDK's TypeScript lib set. Declared locally so the
 * per-package tsc and editors do not need `@types/node` pulled in.
 */
declare const require: (id: string) => unknown;

/**
 * Resolve `react-native-fs` at first call via CommonJS `require`.
 * Handles both direct-module and `{ default: ... }` shapes so a host
 * that bundles the module without an `esModuleInterop` wrapper still
 * resolves the adapter's file API.
 *
 * The `require` is wrapped in try / catch so Metro treats `react-native-fs`
 * as an OPTIONAL dependency (`allowOptionalDependencies`). Without it the
 * bundler would fail at build time for any host that does not install
 * `react-native-fs` - notably every Expo app, which uses the Expo adapter
 * and only pulls this module transitively through the shared facade and
 * never constructs `BareRNStorageAdapter`. The throw fires only if a bare
 * RN host genuinely instantiates the adapter without the peer installed.
 */
/* istanbul ignore next */
function loadRNFS(): RNFSLike {
  try {
    const mod = require('react-native-fs') as RNFSLike | { default: RNFSLike };
    return 'default' in mod ? mod.default : mod;
  } catch {
    throw new Error(
      'BareRNStorageAdapter: react-native-fs is not installed. Add it as a dependency, or pass a custom storage adapter to Keewano.init.',
    );
  }
}

export { loadRNFS };
