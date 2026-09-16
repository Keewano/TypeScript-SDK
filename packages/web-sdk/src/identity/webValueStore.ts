/**
 * Durability ladder for identity values: localStorage (primary),
 * first-party cookie (`SameSite=Lax; Path=/`, never third-party),
 * in-memory `Map` (last resort for fully locked-down environments).
 * Failures never throw - identity persistence is best-effort by
 * contract.
 */

import type {
  CookieAttributesArgs,
  CookieJarLike,
  CookieNameArgs,
  CookieRungArgs,
  CreateWebValueStoreArgs,
  LadderRung,
  LadderWriteResult,
  ReadCookieValueArgs,
  SetThroughLadderArgs,
  SetValueArgs,
  WebStorageLike,
  WebValueStore,
} from './types/webValueStore';

import { probeGlobal } from '../probeGlobal';

const COOKIE_LIMITS = {
  /**
   * Chrome caps cookie lifetime at 400 days; ask for exactly the cap
   * so the identity cookie lives as long as the platform allows.
   */
  MAX_AGE_SECONDS: 400 * 24 * 60 * 60,
  /**
   * RFC 6265 only guarantees 4096 bytes per cookie; browsers drop
   * larger ones SILENTLY from an assignment that looks like it
   * succeeded. Refuse instead, so the value falls to the next rung.
   */
  MAX_ENCODED_BYTES: 4096,
} as const;

/** `set` degradations repeat on every write of a hot key; warn once, not per write. */
function makeWarnOnce(): (message: string) => void {
  let warned = false;
  return (message: string): void => {
    if (warned) {
      return;
    }
    warned = true;
    console.warn(message);
  };
}

function resolveDefaultCookieJar(): CookieJarLike | null {
  const doc = probeGlobal<{ cookie: string }>({ path: ['document'] });
  if (doc === null) return null;
  return {
    read: (): string => doc.cookie,
    write: (cookie: string): void => {
      doc.cookie = cookie;
    },
  };
}

/**
 * `Secure` keys off the actual URL scheme, not `isSecureContext`:
 * plain-http localhost IS a secure context, but a `Secure` cookie
 * written there is refused by some browsers, which would silently
 * kill the cookie rung exactly where developers test.
 */
function isHttpsPage(): boolean {
  try {
    return (globalThis as { location?: { protocol?: string } }).location?.protocol === 'https:';
  } catch {
    return false;
  }
}

function localStorageRung(storage: WebStorageLike): LadderRung {
  return {
    durable: true,
    get(key: string): string | null {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    set({ key, value }: SetValueArgs): string | null {
      try {
        storage.setItem(key, value);
        /**
         * Read-back is the write verification AND the adoption point:
         * private-mode engines can silently drop the write (fall
         * through to the next rung on `null`), and a concurrent tab's
         * write that landed after ours comes back as the adopted
         * value (last write wins) rather than being clobbered.
         */
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    delete(key: string): void {
      try {
        storage.removeItem(key);
      } catch {
        /** Denied removal; the ladder's delete is best-effort per rung. */
      }
    },
  };
}

/**
 * Name prefix that makes a cookie unforgeable by a sibling host.
 *
 * `document.cookie` carries no attributes, so a `Domain=.example.com`
 * cookie written by any other host under the shared apex is
 * indistinguishable on read from this origin's own host-only record -
 * and it can be served first, which would let a neighbouring site (or
 * stored XSS on one) decide this origin's consent state and install
 * identity. Filtering cannot fix that; only refusing the write can.
 * Browsers reject a `__Host-`-prefixed cookie that carries `Domain`,
 * uses a path other than `/`, or arrives without `Secure`, so on an
 * https page only this origin can create one and only its own record
 * can ever be read back.
 *
 * The prefix demands `Secure`, which an http page cannot satisfy, so
 * the plain name remains on that fallback - a local dev server, where
 * there is no apex to share.
 */
const HOST_COOKIE_PREFIX = '__Host-';

/** The encoded cookie name for a ladder key: hardened on https, plain on the http fallback. */
function cookieName({ key, secure }: CookieNameArgs): string {
  const encoded = encodeURIComponent(key);
  return secure ? `${HOST_COOKIE_PREFIX}${encoded}` : encoded;
}

function cookieAttributes({ secure, maxAgeSeconds }: CookieAttributesArgs): string {
  const base = `Max-Age=${String(maxAgeSeconds)}; Path=/; SameSite=Lax`;
  return secure ? `${base}; Secure` : base;
}

function readCookieValue({ jar, name }: ReadCookieValueArgs): string | null {
  try {
    /** Split on ';' and trim: the space after each separator is not guaranteed by the spec. */
    const entries = jar
      .read()
      .split(';')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const prefix = `${name}=`;
    for (const entry of entries) {
      if (entry.startsWith(prefix)) {
        return decodeURIComponent(entry.substring(prefix.length));
      }
    }
    return null;
  } catch {
    return null;
  }
}

function cookieRung({ jar, secure }: CookieRungArgs): LadderRung {
  return {
    durable: true,
    get(key: string): string | null {
      return readCookieValue({ jar, name: cookieName({ key, secure }) });
    },
    set({ key, value }: SetValueArgs): string | null {
      const name = cookieName({ key, secure });
      const pair = `${name}=${encodeURIComponent(value)}`;
      const cookie = `${pair}; ${cookieAttributes({ secure, maxAgeSeconds: COOKIE_LIMITS.MAX_AGE_SECONDS })}`;
      /**
       * `encodeURIComponent` output and the attribute tail are pure
       * ASCII, so string length equals byte length here.
       */
      if (cookie.length > COOKIE_LIMITS.MAX_ENCODED_BYTES) {
        return null;
      }
      try {
        jar.write(cookie);
      } catch {
        return null;
      }
      /** Same verified-write / adoption contract as the localStorage rung. */
      return readCookieValue({ jar, name });
    },
    delete(key: string): void {
      /** `Max-Age=0` is the browser-standard cookie removal spelling. */
      const expired = `${cookieName({ key, secure })}=; Max-Age=0; Path=/; SameSite=Lax`;
      try {
        jar.write(secure ? `${expired}; Secure` : expired);
      } catch {
        /** Denied removal; the ladder's delete is best-effort per rung. */
      }
    },
  };
}

function memoryRung(): LadderRung {
  const values = new Map<string, string>();
  return {
    durable: false,
    get(key: string): string | null {
      return values.get(key) ?? null;
    },
    set({ key, value }: SetValueArgs): string | null {
      values.set(key, value);
      return value;
    },
    delete(key: string): void {
      values.delete(key);
    },
  };
}

function buildRungs(args: CreateWebValueStoreArgs): LadderRung[] {
  const rungs: LadderRung[] = [];
  const storage =
    args.localStorage === undefined
      ? probeGlobal<WebStorageLike>({ path: ['localStorage'] })
      : args.localStorage;
  if (storage !== null) {
    rungs.push(localStorageRung(storage));
  }
  const jar = args.cookieJar === undefined ? resolveDefaultCookieJar() : args.cookieJar;
  if (jar !== null) {
    const secure = args.secure ?? isHttpsPage();
    rungs.push(cookieRung({ jar, secure }));
  }
  /**
   * The in-memory rung terminates the ladder unconditionally, so
   * `set` always lands somewhere - a fully locked-down environment
   * costs identity continuity across page loads, not a crash.
   */
  rungs.push(memoryRung());
  return rungs;
}

/** Build the identity value store over the durability ladder; see {@link WebValueStore}. */
function createWebValueStore(args: CreateWebValueStoreArgs = {}): WebValueStore {
  const rungs = buildRungs(args);
  const warnOnce = makeWarnOnce();
  const warnStaleOnce = makeWarnOnce();

  /**
   * Write to the highest rung in [0, limit) that verifies; report
   * where it landed. Read-back triage per rung: identical to the
   * written value = verified; different but passing `isValid` = a
   * concurrent writer's record, adopted (last write wins); different
   * and failing `isValid` = a stale value from an engine that
   * silently dropped the write (quota-capped private modes), so the
   * rung failed and the ladder falls through.
   */
  const setThroughLadder = ({
    key,
    value,
    isValid,
    limit,
  }: SetThroughLadderArgs): LadderWriteResult | null => {
    for (const [index, rung] of rungs.entries()) {
      if (index >= limit) break;
      const stored = rung.set({ key, value });
      if (stored === null) {
        /**
         * A failed rung may still HOLD a previous value, and `get`
         * reads top-down - without this delete the stale record
         * shadows the fresh one landing on a lower rung (a revoked
         * consent would resurrect as the pre-revoke state on the
         * next load). Best-effort like every rung operation.
         */
        rung.delete(key);
        continue;
      }
      if (stored === value || isValid === undefined || isValid(stored)) {
        return { stored, rung };
      }
      warnStaleOnce('webValueStore: stale read-back after write; falling through to next rung.');
      rung.delete(key);
    }
    return null;
  };

  return {
    get(key: string): string | null {
      for (const [index, rung] of rungs.entries()) {
        const value = rung.get(key);
        if (value === null) continue;
        if (index > 0) {
          /**
           * Promotion: the value survived only below the top (e.g. in
           * a cookie while localStorage was broken); write it back up
           * so the next visit reads from the primary store instead of
           * churning identity when the lower rung expires.
           */
          setThroughLadder({ key, value, limit: index });
        }
        return value;
      }
      return null;
    },
    set({ key, value, isValid }: SetValueArgs): string {
      const landed = setThroughLadder({
        key,
        value,
        limit: rungs.length,
        ...(isValid === undefined ? {} : { isValid }),
      });
      if (landed === null) {
        /**
         * Unreachable while the in-memory rung terminates the ladder;
         * kept so a future rung refactor cannot regress the
         * never-throws / never-silent contract.
         */
        warnOnce('webValueStore: write failed on every rung; value not persisted.');
        return value;
      }
      if (!landed.rung.durable) {
        warnOnce('webValueStore: no durable web storage; value will not survive this page.');
      }
      return landed.stored;
    },
    delete(key: string): void {
      /**
       * Every rung, not first-hit-wins: a value promoted to multiple
       * rungs over time would otherwise resurrect from a lower rung
       * on the next `get` fall-through - fatal for a GDPR wipe.
       */
      for (const rung of rungs) {
        rung.delete(key);
      }
    },
  };
}

export { createWebValueStore };
