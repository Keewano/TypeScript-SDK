/**
 * Injectable fetch for the transport layer.
 *
 * The transport defaults to the global `fetch`. React Native's legacy
 * networking strips the `Content-Encoding` request header, so a gzip
 * custom-event map reaches the ingress server unmarked and the server
 * cannot inflate it. Expo's `expo/fetch` uses a native client that
 * preserves the header, so the Expo package injects it here; the bare
 * global `fetch` stays the default everywhere else.
 *
 * The override is process-global (the SDK runs one transport per
 * process). `configureTransportFetch(null)` restores the default.
 */

import type { TransportFetch } from './types/transportFetch';

let injectedFetch: TransportFetch | null = null;

/** Install a fetch implementation for every subsequent transport call. */
function configureTransportFetch(fetchImpl: TransportFetch | null): void {
  injectedFetch = fetchImpl;
}

/**
 * `true` when a fetch override is currently installed. Platform
 * packages check this before injecting their default so a fetch the
 * host installed first (cert pinning, proxying) is never silently
 * overwritten.
 */
function isTransportFetchConfigured(): boolean {
  return injectedFetch !== null;
}

/**
 * The fetch the transport should use for this call: the injected one if
 * a platform package set it, otherwise the current global `fetch`
 * (resolved per call so test spies on `globalThis.fetch` are honored).
 *
 * Callers must invoke the result with `globalThis` as the receiver
 * (`resolveTransportFetch().call(globalThis, url, init)`): on browser /
 * Expo-web runtimes the global `fetch` is a brand-checked operation that
 * throws `TypeError: Illegal invocation` when called detached.
 */
function resolveTransportFetch(): TransportFetch {
  return injectedFetch ?? globalThis.fetch;
}

export { configureTransportFetch, isTransportFetchConfigured, resolveTransportFetch };
