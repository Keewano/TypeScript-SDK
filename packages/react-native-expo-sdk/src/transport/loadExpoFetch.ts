/**
 * Lazy loader for `expo/fetch` (Expo SDK 52+).
 *
 * React Native's legacy `fetch` strips the `Content-Encoding` request
 * header, so a gzip custom-event map reaches the ingress server
 * unmarked and the server cannot inflate it (`POST /custom` fails).
 * Expo's `expo/fetch` uses a native client that preserves the header,
 * so the Expo facade injects it into the core transport. Returns null
 * on Expo SDKs older than 52, where the subpath is absent - the
 * transport then stays on the global `fetch` (custom-event registration
 * is unavailable until the host upgrades Expo).
 *
 * Not exercised by unit tests because `expo/fetch` is not installed in
 * the jest runtime; the require is wrapped so its absence degrades to
 * null rather than throwing.
 */

import type { TransportFetch } from '@keewano/core';

/**
 * `require` is provided by the React Native / Node runtime but is not
 * part of the SDK's TypeScript lib set. Declared locally so the
 * per-package tsc and editors do not need `@types/node` pulled in.
 */
declare const require: (id: string) => unknown;

/* istanbul ignore next */
function loadExpoFetch(): TransportFetch | null {
  let mod: unknown;
  try {
    /*
     * The 'expo/fetch' subpath does not exist before Expo SDK 52, so
     * the require is wrapped in try / catch: that marks it an OPTIONAL
     * dependency for Metro (allowOptionalDependencies), which would
     * otherwise fail the whole bundle at build time on older Expo where
     * the path is absent.
     */
    mod = require('expo/fetch');
  } catch {
    return null;
  }
  const candidate = (mod as { fetch?: unknown }).fetch;
  /*
   * `expo/fetch`'s `FetchResponse implements Response` and it accepts a
   * (url, RequestInit) call, so it satisfies TransportFetch at runtime;
   * the cast bridges the nominal type gap between its declared init /
   * response types and the global ones.
   */
  return typeof candidate === 'function' ? (candidate as unknown as TransportFetch) : null;
}

export { loadExpoFetch };
