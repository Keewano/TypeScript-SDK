/**
 * Join a server `baseUrl` with an endpoint path while normalizing
 * trailing slashes so the result never contains `//`. Every endpoint
 * path defined in `constants.ts` already starts with one `/`, so the
 * rule is "strip a run of trailing slashes from `baseUrl`, then
 * concatenate".
 *
 * A naive `baseUrl + path` join produces broken URLs whenever the
 * caller passes a `baseUrl` with a trailing slash; centralizing the
 * join here keeps that contract in one place.
 *
 * @example
 * ```ts
 * joinEndpoint({ baseUrl: 'https://api.keewano.com/v1', path: '/in' });
 * // -> 'https://api.keewano.com/v1/in'
 *
 * joinEndpoint({ baseUrl: 'https://api.keewano.com/v1/', path: '/in' });
 * // -> 'https://api.keewano.com/v1/in'
 *
 * joinEndpoint({ baseUrl: 'https://api.keewano.com/v1////', path: '/in' });
 * // -> 'https://api.keewano.com/v1/in'
 * ```
 */

/**
 * Args bag for `joinEndpoint`.
 *
 * baseUrl - Server base URL. Trailing slashes are stripped before
 *   joining. Must contain at least one non-slash character.
 * path - Endpoint path. Must start with `/`.
 */
interface JoinEndpointArgs {
  baseUrl: string;
  path: string;
}

function joinEndpoint({ baseUrl, path }: JoinEndpointArgs): string {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new TypeError('joinEndpoint: empty baseUrl');
  }
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new TypeError('joinEndpoint: path missing leading slash');
  }
  let trimEnd = baseUrl.length;
  while (trimEnd > 0 && baseUrl.codePointAt(trimEnd - 1) === 0x2f /* '/' */) {
    trimEnd -= 1;
  }
  if (trimEnd === 0) {
    throw new TypeError('joinEndpoint: all-slash baseUrl');
  }
  const normalizedBaseUrl = baseUrl.substring(0, trimEnd);
  /**
   * Parse the normalized base URL to surface permanent configuration
   * bugs (`'foo'`, `'http://'`, `'api.test/in'`) at the boundary
   * instead of letting them reach `fetch`, throw, and get collapsed
   * by the caller's `try / catch` into a retryable transport
   * failure. Query or hash on `baseUrl` are rejected too: combining
   * them with an appended path silently produces a wrong URL.
   *
   * Only `http:` and `https:` schemes are accepted. `file:`,
   * `ftp:`, `data:`, `ws:`, and similar are meaningless for an HTTP
   * transport and (with `file:`) carry a real security risk if
   * misconfigured against a runtime that honours the scheme.
   *
   * Embedded credentials (`https://user:pass@host`) are rejected too:
   * `fetch` would attach Basic-Auth material from the URL, and any
   * downstream log line that records the URL would then leak the
   * secret.
   */
  let parsed: URL;
  try {
    parsed = new URL(normalizedBaseUrl);
  } catch {
    throw new TypeError('joinEndpoint: invalid baseUrl');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new TypeError('joinEndpoint: invalid baseUrl');
  }
  /**
   * Build the result from the validated, canonicalized `parsed`
   * object instead of concatenating the raw input. Returning
   * `normalizedBaseUrl + path` would throw away the URL parser's
   * canonicalization (lowercased host, default-port stripping,
   * IDN normalization) and let raw bytes the parser rejected
   * leak past the check.
   *
   * The trailing-slash trim mirrors the explicit loop used above
   * for `baseUrl` rather than a regex - avoids the ReDoS warning
   * for `/\/+$/` and keeps the trim logic identical at both
   * trimming sites.
   */
  let pathnameTrimEnd = parsed.pathname.length;
  while (
    pathnameTrimEnd > 0 &&
    parsed.pathname.codePointAt(pathnameTrimEnd - 1) === 0x2f /* '/' */
  ) {
    pathnameTrimEnd -= 1;
  }
  const basePath = parsed.pathname.substring(0, pathnameTrimEnd);
  parsed.pathname = `${basePath}${path}`;
  return parsed.toString();
}

export type { JoinEndpointArgs };
export { joinEndpoint };
