/**
 * The subset of the `fetch` contract the transport depends on: a call
 * taking a URL string plus a `RequestInit` and resolving to a
 * `Response`. The global `fetch` satisfies it directly; Expo's
 * `expo/fetch` (whose `FetchResponse implements Response`) satisfies it
 * after a localized cast at the injection site.
 */
type TransportFetch = (input: string, init: RequestInit) => Promise<Response>;

export type { TransportFetch };
