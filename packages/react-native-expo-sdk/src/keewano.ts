/**
 * Expo-flavoured Keewano facade. Delegates to the bare React Native
 * facade for everything but defaults two adapters an Expo app should
 * not have to wire by hand:
 *
 *   - storage -> `ExpoStorageAdapter`, persisting through
 *     `expo-file-system` instead of the bare-RN `react-native-fs`
 *     adapter that Expo managed apps do not ship.
 *   - platform -> `expoPlatformAdapter`, which reads the real app
 *     version from `expo-constants` (the bare-RN default cannot read it
 *     and reports `'unknown'`).
 *
 * The host can still override either explicitly; only the defaults
 * change. This realises the package-per-platform contract: installing
 * `@keewano/react-native-expo-sdk` yields the Expo-appropriate adapters
 * install-and-go.
 */

import type { KeewanoApi, KeewanoConfig } from '@keewano/react-native-sdk';

import { configureTransportFetch, isTransportFetchConfigured } from '@keewano/core';
import { Keewano as BareKeewano } from '@keewano/react-native-sdk';

import { expoPlatformAdapter } from './platform';
import { ExpoStorageAdapter } from './storage';
import { loadExpoFetch } from './transport';

async function init(config: KeewanoConfig): Promise<void> {
  /*
   * Route the transport through expo/fetch when available: its native
   * client preserves the Content-Encoding request header that RN's
   * legacy fetch strips, which is what lets POST /custom register a
   * gzip event map. A no-op on Expo < 52, where the transport stays
   * on the global fetch - and a no-op when the host already installed
   * its own transport fetch (cert pinning, proxying): the host's
   * choice must never be silently overwritten by our default.
   */
  if (!isTransportFetchConfigured()) {
    const expoFetch = loadExpoFetch();
    if (expoFetch !== null) {
      configureTransportFetch(expoFetch);
    }
  }
  const withExpoDefaults: KeewanoConfig = { ...config };
  if (config.storage === undefined) {
    withExpoDefaults.storage = new ExpoStorageAdapter();
  }
  if (config.platform === undefined) {
    withExpoDefaults.platform = expoPlatformAdapter();
  }
  return BareKeewano.init(withExpoDefaults);
}

/**
 * Spread keeps every other method (report\*, shutdown, identity,
 * consent) pointing at the bare facade's free functions - they operate
 * on the shared runtime singleton, so only `init`'s adapter defaults
 * need overriding.
 */
const Keewano: KeewanoApi = {
  ...BareKeewano,
  init,
};

export { Keewano };
